import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient, isRedisConnected } from '../../infra/redis.js';
import { sessionManager } from '../sessions/manager.js';
import { safetyPolicy } from '../safety/safety.policy.js';
import { chatFeedStore, normalizeChatJid } from './chat-feed-store.js';
import { db, isDbAvailable } from '../../infra/db.js';
import { messagesTable } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../../infra/logger.js';
import EventEmitter from 'events';

export interface SendJobData {
  messageId: string;
  sessionId: string;
  to: string;
  type: 'text' | 'image' | 'document' | 'voice' | 'reaction';
  content?: string;
  mediaUrl?: string;
  filename?: string;
  reactionEmoji?: string;
  targetMessageKey?: any;
  idempotencyKey?: string;
}

export class MessageQueueService extends EventEmitter {
  private bullQueue: Queue | null = null;
  private bullWorker: Worker | null = null;
  private memoryQueue: SendJobData[] = [];
  private isProcessingMemory = false;

  constructor() {
    super();
    this.initBullMQ();

    // Automatically resume and flush pending queued answers when WhatsApp socket reconnects
    sessionManager.on('session.connected', async ({ sessionId }) => {
      logger.info({ sessionId }, '⚡ Session connected: resuming pending outbound answers');
      this.processMemoryQueue();
      await this.recoverPendingOutboundMessages(sessionId);
    });
  }

  private initBullMQ() {
    const redis = getRedisClient();
    redis.on('connect', () => {
      try {
        if (!this.bullQueue) {
          this.bullQueue = new Queue('wag-send-messages', {
            connection: redis,
            defaultJobOptions: {
              attempts: 10,
              backoff: {
                type: 'exponential',
                delay: 3000
              },
              removeOnComplete: 1000,
              removeOnFail: 5000
            }
          });

          this.bullWorker = new Worker(
            'wag-send-messages',
            async (job: Job<SendJobData>) => {
              return this.processJob(job.data);
            },
            {
              connection: redis,
              concurrency: 5,
              limiter: {
                max: 30,
                duration: 60000
              }
            }
          );

          this.bullWorker.on('completed', (job) => {
            logger.debug({ jobId: job.id, messageId: job.data.messageId }, 'Send job completed');
          });

          this.bullWorker.on('failed', (job, err) => {
            logger.error({ jobId: job?.id, messageId: job?.data.messageId, err: err.message }, 'Send job failed');
            if (job?.data) {
              this.updateMessageStatus(job.data.messageId, 'failed', err.message);
            }
          });

          logger.info('BullMQ message send worker initialized');
        }
      } catch (err: any) {
        logger.debug({ err: err.message }, 'BullMQ initialization skipped');
      }
    });
  }

  private memoryIdempotency = new Set<string>();

  async enqueue(data: SendJobData): Promise<void> {
    // Check idempotency in memory & DB
    if (data.idempotencyKey) {
      if (this.memoryIdempotency.has(data.idempotencyKey)) {
        logger.info({ idempotencyKey: data.idempotencyKey }, 'Duplicate request blocked by Idempotency-Key');
        return;
      }
      this.memoryIdempotency.add(data.idempotencyKey);

      try {
        const existing = await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.idempotencyKey, data.idempotencyKey))
          .limit(1);

        if (existing.length > 0 && existing[0].status !== 'failed') {
          logger.info({ idempotencyKey: data.idempotencyKey }, 'Duplicate request blocked by Idempotency-Key');
          return;
        }
      } catch {}
    }

    // Insert into database with status = 'queued' if DB is connected
    if (isDbAvailable) {
      try {
        await db.insert(messagesTable).values({
          id: data.messageId,
          sessionId: data.sessionId,
          chatJid: normalizeChatJid(data.to),
          direction: 'outbound',
          type: data.type,
          content: data.content,
          mediaUrl: data.mediaUrl,
          status: 'queued',
          idempotencyKey: data.idempotencyKey,
          updatedAt: new Date()
        });
      } catch (err: any) {
        logger.debug({ err: err?.message || String(err) }, 'DB insert for queued message failed');
      }
    }

    if (isRedisConnected() && this.bullQueue) {
      await this.bullQueue.add('send', data, {
        jobId: data.messageId
      });
    } else {
      // Local fallback queue
      this.memoryQueue.push(data);
      this.processMemoryQueue();
    }
  }

  private async processMemoryQueue() {
    if (this.isProcessingMemory || this.memoryQueue.length === 0) return;
    this.isProcessingMemory = true;

    while (this.memoryQueue.length > 0) {
      const jobData = this.memoryQueue[0];
      const session = sessionManager.get(jobData.sessionId);

      // If session is currently reconnecting or initializing, hold outbound answer in queue until connection restores
      if (session && (session.status === 'RECONNECTING' || session.status === 'INITIALIZING')) {
        logger.info({ messageId: jobData.messageId, sessionId: jobData.sessionId, status: session.status }, '⏳ Session is reconnecting; holding outbound answer in queue');
        break;
      }

      this.memoryQueue.shift();

      try {
        await this.processJob(jobData);
      } catch (err: any) {
        // If send failed because of network drop mid-flight or session disconnect, preserve in queue for reconnect
        if (session && session.shouldBeRunning && (
          err.message.includes('not connected') ||
          err.message.includes('Socket closed') ||
          err.message.includes('Connection Closed') ||
          err.message.includes('timed out')
        )) {
          logger.warn({ messageId: jobData.messageId, err: err.message }, '🔄 Outbound send failed due to network drop; re-queuing for reconnection');
          this.memoryQueue.unshift(jobData);
          break;
        }

        logger.error({ messageId: jobData.messageId, err: err.message }, 'Memory queue job failed');
        await this.updateMessageStatus(jobData.messageId, 'failed', err.message);
      }
    }

    this.isProcessingMemory = false;
  }

  async recoverPendingOutboundMessages(sessionId: string) {
    if (!isDbAvailable) return;
    try {
      const pending = await db
        .select()
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.sessionId, sessionId),
            eq(messagesTable.direction, 'outbound'),
            eq(messagesTable.status, 'queued')
          )
        )
        .limit(50);

      if (pending.length > 0) {
        logger.info({ sessionId, count: pending.length }, '📤 Resuming queued outbound answers after network recovery');
        for (const msg of pending) {
          if (this.bullQueue && isRedisConnected()) {
            await this.bullQueue.add('send', {
              messageId: msg.id,
              sessionId: msg.sessionId,
              to: msg.chatJid,
              type: msg.type as any,
              content: msg.content || undefined,
              mediaUrl: msg.mediaUrl || undefined
            }, { jobId: msg.id });
          } else {
            if (!this.memoryQueue.some(j => j.messageId === msg.id)) {
              this.memoryQueue.push({
                messageId: msg.id,
                sessionId: msg.sessionId,
                to: msg.chatJid,
                type: msg.type as any,
                content: msg.content || undefined,
                mediaUrl: msg.mediaUrl || undefined
              });
            }
          }
        }
        this.processMemoryQueue();
      }
    } catch (err: any) {
      logger.debug({ err: err?.message }, 'Failed to recover pending outbound messages');
    }
  }

  private async processJob(data: SendJobData) {
    const session = sessionManager.get(data.sessionId);
    if (!session || session.status !== 'CONNECTED') {
      throw new Error(`Session ${data.sessionId} is not connected (current: ${session?.status || 'UNKNOWN'})`);
    }

    const provider = session.provider;
    let sendAction: () => Promise<any>;

    if (data.type === 'text') {
      sendAction = () => provider.sendText(data.to, data.content || '');
    } else if (data.type === 'image') {
      sendAction = () => provider.sendImage(data.to, data.mediaUrl || '', data.content);
    } else if (data.type === 'document') {
      sendAction = () => provider.sendDocument(data.to, data.mediaUrl || '', data.filename || 'document.pdf', 'application/pdf', data.content);
    } else if (data.type === 'voice') {
      sendAction = () => provider.sendVoice(data.to, data.mediaUrl || '', true);
    } else if (data.type === 'reaction') {
      sendAction = () => provider.sendReaction(data.to, data.targetMessageKey, data.reactionEmoji || '👍');
    } else {
      throw new Error(`Unsupported message type: ${data.type}`);
    }

    // Execute through Anti-Ban Safety Policy with typing simulation and rate pacing
    const result = await safetyPolicy.executeSendWithSafety(
      provider,
      data.to,
      data.type,
      data.content || '',
      sendAction
    );

    // Update status to sent
    await this.updateMessageStatus(data.messageId, 'sent');
    const createdAt = new Date().toISOString();
    const chatJid = normalizeChatJid(data.to);
    chatFeedStore.upsert({
      sessionId: data.sessionId,
      chatJid,
      displayName: data.to,
      lastMessage: data.content || (data.type === 'reaction' ? data.reactionEmoji || null : null),
      lastTimestamp: createdAt
    });
    chatFeedStore.recordMessage({
      id: data.messageId,
      sessionId: data.sessionId,
      chatJid,
      direction: 'outbound',
      type: data.type,
      content: data.content || (data.type === 'reaction' ? data.reactionEmoji || null : null),
      mediaUrl: data.mediaUrl,
      status: 'sent',
      createdAt
    });
    this.emit('message.sent', { messageId: data.messageId, sessionId: data.sessionId, result });
    return result;
  }

  private async updateMessageStatus(messageId: string, status: string, errorMessage?: string) {
    if (!isDbAvailable) return;
    try {
      await db
        .update(messagesTable)
        .set({
          status,
          errorMessage,
          updatedAt: new Date()
        })
        .where(eq(messagesTable.id, messageId));
    } catch (err: any) {
      logger.debug({ err: err?.message || String(err) }, 'Failed to update message status in DB');
    }
  }

  async shutdown() {
    if (this.bullWorker) await this.bullWorker.close();
    if (this.bullQueue) await this.bullQueue.close();
  }
}

export const messageQueue = new MessageQueueService();
