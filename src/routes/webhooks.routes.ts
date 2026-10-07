import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db, isDbAvailable } from '../infra/db.js';
import { webhooksTable } from '../db/schema.js';
import { webhookDispatcher } from '../modules/webhooks/dispatcher.js';
import { eq, desc } from 'drizzle-orm';
import { authenticateApiKey, requireScope } from '../modules/auth/guard.js';

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // List all registered webhooks
  fastify.get('/webhooks', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Webhooks'],
      summary: 'List all registered webhook listeners'
    }
  }, async () => {
    if (!isDbAvailable) return [];
    return await db.select().from(webhooksTable);
  });

  // Register a new webhook endpoint
  fastify.post('/webhooks', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Webhooks'],
      summary: 'Register a webhook URL with HMAC secret',
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'Destination endpoint URL' },
          secret: { type: 'string', description: 'HMAC signature secret (auto-generated if omitted)' },
          sessionId: { type: 'string', description: 'Optional session filter (omit for all)' },
          events: {
            type: 'array',
            items: { type: 'string' },
            default: ['*'],
            description: 'Events to subscribe to: message.received, message.status, session.status, session.qr, *'
          }
        }
      }
    }
  }, async (req, reply) => {
    const { url, secret, sessionId, events = ['*'] } = req.body as any;
    const id = `wh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const generatedSecret = secret || crypto.randomBytes(24).toString('hex');

    await db.insert(webhooksTable).values({
      id,
      url,
      secret: generatedSecret,
      sessionId: sessionId || null,
      events,
      isActive: true
    });

    return reply.status(201).send({
      id,
      url,
      secret: generatedSecret,
      sessionId,
      events,
      isActive: true
    });
  });

  // Delete webhook
  fastify.delete('/webhooks/:id', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Webhooks'],
      summary: 'Delete registered webhook'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(webhooksTable).where(eq(webhooksTable.id, id));
    return { success: true, message: `Webhook ${id} removed` };
  });

  // Get Webhook Outbox Delivery Logs (for debugging)
  fastify.get('/webhooks/logs', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Get recent webhook delivery outbox attempts and statuses for debugging'
    }
  }, async (req) => {
    const { limit = 50 } = req.query as { limit?: number };
    return await webhookDispatcher.getDeliveryLogs(Number(limit));
  });
}
