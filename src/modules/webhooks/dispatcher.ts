import crypto from 'crypto';
import { db, isDbAvailable } from '../../infra/db.js';
import { webhooksTable, webhookDeliveriesTable } from '../../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '../../infra/logger.js';
import { webhookDeliveryCounter } from '../../infra/metrics.js';

export interface WebhookEventPayload {
  event: 'message.received' | 'message.status' | 'session.status' | 'session.qr';
  sessionId: string;
  data: any;
  timestamp: number;
}

export class WebhookDispatcher {
  private isProcessing = false;
  private queueInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Poll/process deliveries every 3 seconds
    this.queueInterval = setInterval(() => this.processOutbox(), 3000);
  }

  /**
   * Compute HMAC-SHA256 signature for payload
   */
  computeSignature(payloadString: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    return `sha256=${hmac.update(payloadString).digest('hex')}`;
  }

  /**
   * Dispatch an event to all matching registered webhooks using the Outbox pattern
   */
  async dispatch(event: WebhookEventPayload): Promise<void> {
    if (!isDbAvailable) return;
    try {
      // Find active webhooks for this session or global webhooks (sessionId is null)
      const registeredWebhooks = await db
        .select()
        .from(webhooksTable)
        .where(eq(webhooksTable.isActive, true));

      const matching = registeredWebhooks.filter(
        (wh) =>
          (!wh.sessionId || wh.sessionId === event.sessionId) &&
          (wh.events.includes('*') || wh.events.includes(event.event))
      );

      for (const wh of matching) {
        const deliveryId = `del_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const payloadString = JSON.stringify(event);
        const signature = this.computeSignature(payloadString, wh.secret);

        // Store into outbox table first
        await db.insert(webhookDeliveriesTable).values({
          id: deliveryId,
          webhookId: wh.id,
          event: event.event,
          payload: event,
          signature,
          status: 'pending',
          attempts: 0,
          maxAttempts: 8,
          nextRetryAt: new Date()
        });

        logger.debug({ deliveryId, webhookUrl: wh.url, event: event.event }, 'Webhook queued in outbox');
      }

      // Trigger immediate flush
      this.processOutbox();
    } catch {}
  }

  /**
   * Outbox worker: delivers pending webhook events with exponential backoff
   */
  async processOutbox(): Promise<void> {
    if (!isDbAvailable || this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();
      const pendingDeliveries = await db
        .select()
        .from(webhookDeliveriesTable)
        .where(eq(webhookDeliveriesTable.status, 'pending'))
        .limit(20);

      const due = pendingDeliveries.filter((d) => !d.nextRetryAt || new Date(d.nextRetryAt) <= now);

      for (const delivery of due) {
        await this.deliverSingle(delivery);
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, 'Outbox processing cycle completed with warning');
    } finally {
      this.isProcessing = false;
    }
  }

  private async deliverSingle(delivery: typeof webhookDeliveriesTable.$inferSelect) {
    const wh = await db
      .select()
      .from(webhooksTable)
      .where(eq(webhooksTable.id, delivery.webhookId))
      .limit(1);

    if (wh.length === 0) {
      await db
        .update(webhookDeliveriesTable)
        .set({ status: 'failed', lastError: 'Webhook target configuration deleted' })
        .where(eq(webhookDeliveriesTable.id, delivery.id));
      return;
    }

    const targetUrl = wh[0].url;
    const bodyString = JSON.stringify(delivery.payload);
    const attempts = delivery.attempts + 1;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': delivery.signature,
          'X-Event': delivery.event,
          'X-Delivery-Id': delivery.id,
          'User-Agent': 'WhatsApp-Gateway-Webhook/1.0'
        },
        body: bodyString,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        await db
          .update(webhookDeliveriesTable)
          .set({
            status: 'success',
            attempts,
            responseStatus: response.status,
            updatedAt: new Date()
          })
          .where(eq(webhookDeliveriesTable.id, delivery.id));

        webhookDeliveryCounter.inc({ event: delivery.event, status: 'success' });
        logger.info({ deliveryId: delivery.id, targetUrl, status: response.status }, 'Webhook delivered successfully');
      } else {
        throw new Error(`HTTP status ${response.status}: ${response.statusText}`);
      }
    } catch (err: any) {
      const isDeadLetter = attempts >= delivery.maxAttempts;
      // Exponential backoff: 2s -> 4s -> 8s -> 16s -> 32s ...
      const backoffSec = Math.min(3600, Math.pow(2, attempts));
      const nextRetry = new Date(Date.now() + backoffSec * 1000);

      await db
        .update(webhookDeliveriesTable)
        .set({
          status: isDeadLetter ? 'failed' : 'pending',
          attempts,
          lastError: err.message || 'Unknown network error',
          nextRetryAt: isDeadLetter ? null : nextRetry,
          updatedAt: new Date()
        })
        .where(eq(webhookDeliveriesTable.id, delivery.id));

      webhookDeliveryCounter.inc({ event: delivery.event, status: isDeadLetter ? 'dead_letter' : 'retrying' });
      logger.warn(
        { deliveryId: delivery.id, attempts, isDeadLetter, err: err.message },
        'Webhook delivery attempt failed'
      );
    }
  }

  /**
   * Get recent delivery logs for debugging
   */
  async getDeliveryLogs(limit = 50) {
    try {
      return await db
        .select()
        .from(webhookDeliveriesTable)
        .orderBy(desc(webhookDeliveriesTable.createdAt))
        .limit(limit);
    } catch {
      return [];
    }
  }

  stop() {
    if (this.queueInterval) clearInterval(this.queueInterval);
  }
}

export const webhookDispatcher = new WebhookDispatcher();
