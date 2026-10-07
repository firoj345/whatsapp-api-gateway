import { SessionHandle, SessionInfo } from './session.js';
import { db, isDbAvailable } from '../../infra/db.js';
import { sessionsTable } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../../infra/logger.js';
import EventEmitter from 'events';

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, SessionHandle>();
  private isShuttingDown = false;

  constructor() {
    super();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): SessionHandle | undefined {
    return this.sessions.get(id);
  }

  getAll(): SessionHandle[] {
    return Array.from(this.sessions.values());
  }

  async createSession(id: string, name: string): Promise<SessionHandle> {
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (existing.status !== 'CONNECTED' && existing.status !== 'QR_PENDING') {
        await existing.start();
      }
      return existing;
    }

    // Persist in DB if online
    if (isDbAvailable) {
      try {
        await db
          .insert(sessionsTable)
          .values({
            id,
            name,
            status: 'INITIALIZING',
            shouldBeRunning: true,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: sessionsTable.id,
            set: {
              name,
              shouldBeRunning: true,
              updatedAt: new Date()
            }
          });
      } catch {}
    }

    const session = new SessionHandle(id, name);
    this.sessions.set(id, session);

    // Forward internal events
    session.on('qr', (data) => this.emit('session.qr', { sessionId: id, ...data }));
    session.on('status', (status) => this.emit('session.status', { sessionId: id, status }));
    session.on('connected', (data) => this.emit('session.connected', { sessionId: id, ...data }));
    session.on('messages.upsert', (data) => this.emit('session.messages.upsert', { sessionId: id, ...data }));
    session.on('messages.update', (updates) => this.emit('session.messages.update', { sessionId: id, updates: Array.isArray(updates) ? updates : [updates] }));
    session.on('messaging-history.set', (data) => this.emit('session.messaging-history.set', { sessionId: id, ...data }));
    session.on('contacts.upsert', (contacts) => this.emit('session.contacts.upsert', { sessionId: id, contacts }));
    session.on('contacts.update', (contacts) => this.emit('session.contacts.update', { sessionId: id, contacts }));

    await session.start();
    return session;
  }

  async removeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    await session.stop();
    this.sessions.delete(id);

    try {
      await db.update(sessionsTable).set({ shouldBeRunning: false, status: 'LOGGED_OUT' }).where(eq(sessionsTable.id, id));
    } catch {}

    return true;
  }

  /**
   * Boot Recovery: on startup, load all sessions marked should_be_running
   * and reconnect them with a small stagger so they don't all connect at once.
   */
  async bootRecovery(): Promise<void> {
    if (!isDbAvailable) {
      const storageDir = './data/sessions';
      try {
        const fs = await import('fs');
        const path = await import('path');
        if (fs.existsSync(storageDir)) {
          const dirs = fs.readdirSync(storageDir).filter((f) => fs.statSync(path.join(storageDir, f)).isDirectory());
          for (const dir of dirs) {
            logger.info({ sessionId: dir }, 'Recovering local WhatsApp session from storage');
            await this.createSession(dir, dir);
          }
        }
      } catch {}
      return;
    }

    try {
      logger.info('🔄 Running Session Boot Recovery...');
      const savedSessions = await db.select().from(sessionsTable).where(eq(sessionsTable.shouldBeRunning, true));

      logger.info({ count: savedSessions.length }, 'Found active sessions to recover');

      for (let i = 0; i < savedSessions.length; i++) {
        const row = savedSessions[i];
        // Stagger session reconnections by 1.5 seconds each
        setTimeout(async () => {
          if (this.isShuttingDown) return;
          logger.info({ sessionId: row.id, name: row.name }, 'Recovering WhatsApp session');
          await this.createSession(row.id, row.name);
        }, i * 1500);
      }
    } catch {}
  }

  /**
   * Graceful shutdown: flushes queues and closes all sockets
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Shutting down all WhatsApp sessions gracefully...');
    const closePromises = Array.from(this.sessions.values()).map((s) => s.stop());
    await Promise.all(closePromises);
    this.sessions.clear();
    logger.info('All WhatsApp sessions stopped');
  }
}

export const sessionManager = new SessionManager();
