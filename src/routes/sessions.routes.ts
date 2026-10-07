import { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { sessionManager } from '../modules/sessions/manager.js';
import { authenticateApiKey, requireScope } from '../modules/auth/guard.js';

export async function sessionRoutes(fastify: FastifyInstance) {
  // Apply API Key auth on all session endpoints
  fastify.addHook('preHandler', authenticateApiKey);

  // List all sessions
  fastify.get('/sessions', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Sessions'],
      summary: 'List all WhatsApp sessions',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              phoneNumber: { type: 'string', nullable: true },
              status: { type: 'string' },
              qrCode: { type: 'string', nullable: true },
              qrDataUrl: { type: 'string', nullable: true },
              reconnectAttempts: { type: 'number' },
              lastEventAt: { type: 'string' },
              createdAt: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const list = sessionManager.getAll().map((s) => s.getInfo());
    return list;
  });

  // Create or start a session
  fastify.post('/sessions', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Sessions'],
      summary: 'Create and start a WhatsApp session',
      body: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id, name } = req.body as { id: string; name?: string };
    const session = await sessionManager.createSession(id, name || id);
    return reply.status(201).send(session.getInfo());
  });

  // Get single session info
  fastify.get('/sessions/:id', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Sessions'],
      summary: 'Get session status and information'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = sessionManager.get(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return session.getInfo();
  });

  // Get QR Code (Supports PNG image, JSON data URL, and SSE stream)
  fastify.get('/sessions/:id/qr', {
    schema: {
      tags: ['Sessions'],
      summary: 'Get current QR code for pairing'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = sessionManager.get(id);

    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const accept = req.headers.accept || '';

    // Handle Server-Sent Events (SSE)
    if (accept.includes('text/event-stream')) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      const sendSse = (data: any) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendSse(session.getInfo());

      const onQr = (data: any) => sendSse({ event: 'qr', ...data });
      const onStatus = (status: any) => sendSse({ event: 'status', status });

      session.on('qr', onQr);
      session.on('status', onStatus);

      req.raw.on('close', () => {
        session.off('qr', onQr);
        session.off('status', onStatus);
      });
      return;
    }

    if (!session.qrCode) {
      if (session.status === 'CONNECTED') {
        return reply.status(200).send({ message: 'Session already connected', status: session.status });
      }
      return reply.status(400).send({ message: 'QR code not yet available, please wait', status: session.status });
    }

    // Return raw PNG image if requested
    if (accept.includes('image/png')) {
      const pngBuffer = await QRCode.toBuffer(session.qrCode, { margin: 2, scale: 6 });
      return reply.type('image/png').send(pngBuffer);
    }

    // Return JSON data URL
    return {
      sessionId: id,
      status: session.status,
      qr: session.qrCode,
      qrDataUrl: session.qrDataUrl
    };
  });

  // Pair with 8-digit phone code
  fastify.post('/sessions/:id/pair-code', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Sessions'],
      summary: 'Request 8-digit pairing code for phone number pairing',
      body: {
        type: 'object',
        required: ['phoneNumber'],
        properties: {
          phoneNumber: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { phoneNumber } = req.body as { phoneNumber: string };

    const session = sessionManager.get(id);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    try {
      const code = await session.pairWithCode(phoneNumber);
      return { sessionId: id, code };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Delete / Logout session
  fastify.delete('/sessions/:id', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['Sessions'],
      summary: 'Logout and delete session'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const success = await sessionManager.removeSession(id);
    if (!success) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return { success: true, message: `Session ${id} logged out and terminated` };
  });
}
