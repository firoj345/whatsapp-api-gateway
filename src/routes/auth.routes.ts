import { FastifyInstance } from 'fastify';
import { authService } from '../modules/auth/auth.service.js';
import { db } from '../infra/db.js';
import { apiKeysTable, keyChatPermissionsTable } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authenticateApiKey, requireScope } from '../modules/auth/guard.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // List all API keys
  fastify.get('/auth/keys', {
    preHandler: [requireScope('*')],
    schema: {
      tags: ['Authentication & ACL'],
      summary: 'List all created API keys (keys are hashed, only prefix shown)'
    }
  }, async () => {
    return await db
      .select({
        id: apiKeysTable.id,
        name: apiKeysTable.name,
        prefix: apiKeysTable.prefix,
        scopes: apiKeysTable.scopes,
        sessionIds: apiKeysTable.sessionIds,
        rateLimitRpm: apiKeysTable.rateLimitRpm,
        createdAt: apiKeysTable.createdAt,
        expiresAt: apiKeysTable.expiresAt,
        revokedAt: apiKeysTable.revokedAt
      })
      .from(apiKeysTable)
      .orderBy(desc(apiKeysTable.createdAt));
  });

  // Create a new API key
  fastify.post('/auth/keys', {
    preHandler: [requireScope('*')],
    schema: {
      tags: ['Authentication & ACL'],
      summary: 'Create a new API key (shown once, saved as SHA-256)',
      body: {
        type: 'object',
        required: ['name', 'scopes'],
        properties: {
          name: { type: 'string', description: 'Friendly name for the service or bot' },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Permissions: messages:send, messages:read, sessions:manage, *'
          },
          sessionIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed session IDs or ["*"] for all'
          },
          rateLimitRpm: { type: 'number', default: 60 }
        }
      }
    }
  }, async (req, reply) => {
    const body = req.body as any;
    const result = await authService.createKey(body);
    return reply.status(201).send(result);
  });

  // Revoke an API key
  fastify.delete('/auth/keys/:id', {
    schema: {
      tags: ['Authentication & ACL'],
      summary: 'Revoke an API key'
    }
  }, async (req, reply) => {
    const user = req.user;
    const { id } = req.params as { id: string };

    const isAuthorized =
      user?.isAdmin ||
      user?.scopes.includes('*') ||
      user?.scopes.includes('keys:manage') ||
      user?.keyId === id;

    if (!isAuthorized) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Admin permissions required to revoke this key'
      });
    }

    await authService.revokeKey(id);
    return { success: true, message: `API Key ${id} has been revoked` };
  });

  // Assign Chat-Level ACL Permission to a key
  fastify.post('/auth/keys/:id/permissions', {
    preHandler: [requireScope('*')],
    schema: {
      tags: ['Authentication & ACL'],
      summary: 'Add chat-level restriction for an API key',
      body: {
        type: 'object',
        required: ['sessionId', 'chatJidPattern'],
        properties: {
          sessionId: { type: 'string' },
          chatJidPattern: { type: 'string', description: 'E.g. 1234567890@s.whatsapp.net or *' },
          canRead: { type: 'boolean', default: true },
          canSend: { type: 'boolean', default: true }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { sessionId, chatJidPattern, canRead = true, canSend = true } = req.body as any;

    await authService.setChatPermission({
      keyId: id,
      sessionId,
      chatJidPattern,
      canRead,
      canSend
    });

    return reply.status(201).send({
      success: true,
      message: `Permission for chat ${chatJidPattern} configured for key ${id}`
    });
  });

  // List permissions for a key
  fastify.get('/auth/keys/:id/permissions', {
    preHandler: [requireScope('*')],
    schema: {
      tags: ['Authentication & ACL'],
      summary: 'List chat ACL permissions assigned to an API key'
    }
  }, async (req) => {
    const { id } = req.params as { id: string };
    return await db
      .select()
      .from(keyChatPermissionsTable)
      .where(eq(keyChatPermissionsTable.keyId, id));
  });
}
