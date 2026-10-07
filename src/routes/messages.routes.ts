import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { messageQueue } from '../modules/messages/queue.js';
import { db, isDbAvailable } from '../infra/db.js';
import { messagesTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticateApiKey, requireScope, requireChatAccess } from '../modules/auth/guard.js';

export async function messageRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // Send Text Message
  fastify.post('/sessions/:id/messages/text', {
    preHandler: [requireScope('messages:send'), requireChatAccess('send')],
    schema: {
      tags: ['Messages'],
      summary: 'Send text message (Async 202 Accepted)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      body: {
        type: 'object',
        required: ['to', 'text'],
        properties: {
          to: { type: 'string', description: 'Recipient phone number or group JID' },
          text: { type: 'string', description: 'Message body content' }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            messageId: { type: 'string' },
            status: { type: 'string' },
            sessionId: { type: 'string' },
            to: { type: 'string' }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { to, text } = req.body as { to: string; text: string };
    const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

    const messageId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await messageQueue.enqueue({
      messageId,
      sessionId: id,
      to,
      type: 'text',
      content: text,
      idempotencyKey
    });

    return reply.status(202).send({
      messageId,
      status: 'queued',
      sessionId: id,
      to
    });
  });

  // Send Image Message
  fastify.post('/sessions/:id/messages/image', {
    preHandler: [requireScope('messages:send'), requireChatAccess('send')],
    schema: {
      tags: ['Messages'],
      summary: 'Send image message via URL or Base64',
      body: {
        type: 'object',
        required: ['to', 'image'],
        properties: {
          to: { type: 'string' },
          image: { type: 'string', description: 'Public HTTP URL or base64 data string' },
          caption: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { to, image, caption } = req.body as { to: string; image: string; caption?: string };
    const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

    const messageId = `msg_img_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await messageQueue.enqueue({
      messageId,
      sessionId: id,
      to,
      type: 'image',
      mediaUrl: image,
      content: caption,
      idempotencyKey
    });

    return reply.status(202).send({
      messageId,
      status: 'queued',
      sessionId: id,
      to
    });
  });

  // Send Document / PDF
  fastify.post('/sessions/:id/messages/document', {
    preHandler: [requireScope('messages:send'), requireChatAccess('send')],
    schema: {
      tags: ['Messages'],
      summary: 'Send document / PDF file',
      body: {
        type: 'object',
        required: ['to', 'document'],
        properties: {
          to: { type: 'string' },
          document: { type: 'string', description: 'Public URL or base64' },
          filename: { type: 'string', default: 'document.pdf' },
          caption: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { to, document, filename, caption } = req.body as any;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

    const messageId = `msg_doc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await messageQueue.enqueue({
      messageId,
      sessionId: id,
      to,
      type: 'document',
      mediaUrl: document,
      filename: filename || 'document.pdf',
      content: caption,
      idempotencyKey
    });

    return reply.status(202).send({
      messageId,
      status: 'queued',
      sessionId: id,
      to
    });
  });

  // Send Voice Note / PTT
  fastify.post('/sessions/:id/messages/voice', {
    preHandler: [requireScope('messages:send'), requireChatAccess('send')],
    schema: {
      tags: ['Messages'],
      summary: 'Send voice note (Push-To-Talk)',
      body: {
        type: 'object',
        required: ['to', 'audio'],
        properties: {
          to: { type: 'string' },
          audio: { type: 'string', description: 'Audio URL or base64' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { to, audio } = req.body as any;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || undefined;

    const messageId = `msg_voc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await messageQueue.enqueue({
      messageId,
      sessionId: id,
      to,
      type: 'voice',
      mediaUrl: audio,
      idempotencyKey
    });

    return reply.status(202).send({
      messageId,
      status: 'queued',
      sessionId: id,
      to
    });
  });

  // Send Reaction
  fastify.post('/sessions/:id/messages/reaction', {
    preHandler: [requireScope('messages:send'), requireChatAccess('send')],
    schema: {
      tags: ['Messages'],
      summary: 'Send reaction emoji to a message',
      body: {
        type: 'object',
        required: ['to', 'messageKey', 'emoji'],
        properties: {
          to: { type: 'string' },
          messageKey: { type: 'object' },
          emoji: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { to, messageKey, emoji } = req.body as any;

    const messageId = `msg_rea_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    await messageQueue.enqueue({
      messageId,
      sessionId: id,
      to,
      type: 'reaction',
      targetMessageKey: messageKey,
      reactionEmoji: emoji
    });

    return reply.status(202).send({
      messageId,
      status: 'queued',
      sessionId: id,
      to
    });
  });

  // Get message status
  fastify.get('/messages/:id', {
    schema: {
      tags: ['Messages'],
      summary: 'Check status of an asynchronous message'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isDbAvailable) {
      return { id, status: 'processed', note: 'Standalone memory mode: DB persistence is disabled' };
    }
    const rows = await db.select().from(messagesTable).where(eq(messagesTable.id, id)).limit(1);

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    return rows[0];
  });
}
