import makeWASocket, {
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { Boom } from '@hapi/boom';
import { usePostgresAuthState, clearPostgresAuthState } from './auth-store.js';
import { BaileysMessageProvider } from '../messages/baileys.provider.js';
import { IMessageProvider } from '../messages/provider.interface.js';
import { recentMessageStore } from '../messages/message-store.js';
import { logger } from '../../infra/logger.js';
import { sessionStatusGauge, reconnectCounter } from '../../infra/metrics.js';
import { db, isDbAvailable } from '../../infra/db.js';
import { sessionsTable } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import EventEmitter from 'events';

export type SessionState = 'INITIALIZING' | 'QR_PENDING' | 'CONNECTED' | 'RECONNECTING' | 'LOGGED_OUT';

export interface SessionInfo {
  id: string;
  name: string;
  phoneNumber?: string | null;
  status: SessionState;
  qrCode?: string | null;
  qrDataUrl?: string | null;
  reconnectAttempts: number;
  lastEventAt: Date;
  createdAt: Date;
}

export class SessionHandle extends EventEmitter {
  public status: SessionState = 'INITIALIZING';
  public qrCode: string | null = null;
  public qrDataUrl: string | null = null;
  public phoneNumber: string | null = null;
  public reconnectAttempts = 0;
  public lastEventTimestamp = Date.now();
  public shouldBeRunning = true;

  private sock: WASocket | null = null;
  public provider: IMessageProvider;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private watchdogInterval: NodeJS.Timeout | null = null;

  constructor(
    public readonly id: string,
    public readonly name: string
  ) {
    super();
    this.provider = new BaileysMessageProvider(this.id, () => this.sock || undefined);
    this.startWatchdog();
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async start(): Promise<void> {
    try {
      this.setStatus('INITIALIZING');
      this.shouldBeRunning = true;

      // Clean up previous socket if any to prevent duplicate listeners or memory leaks during reconnect
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('messages.upsert');
          this.sock.ev.removeAllListeners('messages.update');
          this.sock.ev.removeAllListeners('messaging-history.set');
          this.sock.ev.removeAllListeners('contacts.upsert');
          this.sock.ev.removeAllListeners('contacts.update');
          this.sock.end(undefined);
        } catch {}
        this.sock = null;
      }

      const { state, saveCreds } = await usePostgresAuthState(this.id);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as any }));

      logger.info({ sessionId: this.id, version }, 'Starting Baileys WhatsApp socket');

      const signalLogger = logger.child({ module: 'baileys', session: this.id }, { level: 'warn' });
      const retryStore = new Map<string, any>();
      const msgRetryCounterCache = {
        get: <T>(key: string): T | undefined => retryStore.get(key),
        set: <T>(key: string, value: T): void => { retryStore.set(key, value); },
        del: (key: string): void => { retryStore.delete(key); },
        flushAll: (): void => { retryStore.clear(); }
      };

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, signalLogger as any)
        },
        browser: Browsers.windows('Desktop'),
        printQRInTerminal: false,
        logger: signalLogger as any,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        msgRetryCounterCache: msgRetryCounterCache as any,
        getMessage: async (key) => recentMessageStore.get(key)
      });

      // Creds update handler
      this.sock.ev.on('creds.update', saveCreds);

      // Connection update handler
      this.sock.ev.on('connection.update', async (update) => {
        this.lastEventTimestamp = Date.now();
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          } catch {
            this.qrDataUrl = null;
          }
          this.setStatus('QR_PENDING');
          this.emit('qr', { qr, qrDataUrl: this.qrDataUrl });
        }

        if (connection === 'open') {
          this.qrCode = null;
          this.qrDataUrl = null;
          this.phoneNumber = this.sock?.user?.id?.split(':')[0] || null;
          this.setStatus('CONNECTED');
          this.emit('connected', { phoneNumber: this.phoneNumber });

          // Reset reconnect attempts after 30s stable connection
          if (this.stableTimer) clearTimeout(this.stableTimer);
          this.stableTimer = setTimeout(() => {
            if (this.status === 'CONNECTED') {
              this.reconnectAttempts = 0;
              logger.info({ sessionId: this.id }, 'Session connection stabilized, reset retry counter');
            }
          }, 30000);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          logger.warn({ sessionId: this.id, statusCode, isLoggedOut }, 'WhatsApp socket closed');

          if (isLoggedOut) {
            this.setStatus('LOGGED_OUT');
            this.shouldBeRunning = false;
            await clearPostgresAuthState(this.id);
            this.emit('logged_out');
          } else if (this.shouldBeRunning) {
            this.handleReconnect(statusCode);
          }
        }
      });

      // Bind incoming messages & updates
      this.sock.ev.on('messages.upsert', (data) => {
        try {
          this.lastEventTimestamp = Date.now();
          this.emit('messages.upsert', data);
        } catch (err: any) {
          logger.warn({ sessionId: this.id, err: err?.message }, 'Error dispatching messages.upsert');
        }
      });

      this.sock.ev.on('messages.update', (updates) => {
        try {
          this.lastEventTimestamp = Date.now();
          this.emit('messages.update', updates);
        } catch (err: any) {
          logger.warn({ sessionId: this.id, err: err?.message }, 'Error dispatching messages.update');
        }
      });

      // Catch-up history set on reconnect
      this.sock.ev.on('messaging-history.set', (data) => {
        try {
          this.lastEventTimestamp = Date.now();
          this.emit('messaging-history.set', data);
        } catch (err: any) {
          logger.warn({ sessionId: this.id, err: err?.message }, 'Error dispatching messaging-history.set');
        }
      });

      this.sock.ev.on('contacts.upsert', (contacts) => {
        this.emit('contacts.upsert', contacts);
      });

      this.sock.ev.on('contacts.update', (contacts) => {
        this.emit('contacts.update', contacts);
      });

    } catch (err: any) {
      logger.error({ sessionId: this.id, err: err.message }, 'Failed to start session');
      this.handleReconnect();
    }
  }

  private setStatus(newStatus: SessionState) {
    this.status = newStatus;
    sessionStatusGauge.set({ session_id: this.id, status: newStatus }, newStatus === 'CONNECTED' ? 1 : 0);
    this.emit('status', newStatus);

    // Update status in DB if online
    if (isDbAvailable) {
      db.update(sessionsTable)
        .set({
          status: newStatus,
          phoneNumber: this.phoneNumber,
          shouldBeRunning: this.shouldBeRunning,
          updatedAt: new Date()
        })
        .where(eq(sessionsTable.id, this.id))
        .catch(() => {});
    }
  }

  /**
   * Exponential backoff with jitter for automatic reconnects:
   * 1s -> 2s -> 4s ... capped at 60s
   */
  private handleReconnect(statusCode?: number) {
    if (!this.shouldBeRunning || this.status === 'LOGGED_OUT') return;

    this.setStatus('RECONNECTING');
    this.reconnectAttempts += 1;
    reconnectCounter.inc({ session_id: this.id, reason: statusCode ? `${statusCode}` : 'unknown' });

    const baseDelay = Math.min(60000, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)));
    const jitter = Math.floor(Math.random() * 1000);
    const delay = baseDelay + jitter;

    logger.info({ sessionId: this.id, attempt: this.reconnectAttempts, delayMs: delay }, 'Scheduling reconnect');

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      if (this.shouldBeRunning) {
        await this.start();
      }
    }, delay);
  }

  /**
   * Watchdog: checks if socket claims to be open but received no events for 5 minutes
   * Sends a lightweight presence ping to keep the socket warm without dropping the connection.
   */
  private startWatchdog() {
    this.watchdogInterval = setInterval(async () => {
      if (this.status === 'CONNECTED' && this.sock) {
        const idleMs = Date.now() - this.lastEventTimestamp;
        if (idleMs > 5 * 60 * 1000) {
          try {
            await this.sock.sendPresenceUpdate('available');
            this.lastEventTimestamp = Date.now();
            logger.debug({ sessionId: this.id }, '🐕 Watchdog keep-alive presence ping sent');
          } catch (err: any) {
            logger.warn({ sessionId: this.id, err: err.message }, '🐕 Watchdog ping failed, recycling connection');
            try {
              this.sock.end(new Error('Watchdog timeout'));
            } catch {}
            this.handleReconnect(DisconnectReason.timedOut);
          }
        }
      }
    }, 60000);
  }

  async pairWithCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error('Socket not initialized');
    }
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const code = await this.sock.requestPairingCode(cleanNumber);
    return code;
  }

  async stop(): Promise<void> {
    this.shouldBeRunning = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }
    this.setStatus('LOGGED_OUT');
  }

  getInfo(): SessionInfo {
    return {
      id: this.id,
      name: this.name,
      phoneNumber: this.phoneNumber,
      status: this.status,
      qrCode: this.qrCode,
      qrDataUrl: this.qrDataUrl,
      reconnectAttempts: this.reconnectAttempts,
      lastEventAt: new Date(this.lastEventTimestamp),
      createdAt: new Date()
    };
  }
}
