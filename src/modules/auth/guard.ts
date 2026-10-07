import { FastifyRequest, FastifyReply } from 'fastify';
import { authService, AuthenticatedUser } from './auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Fastify preHandler hook to authenticate requests via Bearer API Key
 */
export async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers['authorization'];
  const queryKey = (request.query as any)?.api_key;

  let rawKey = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.substring(7).trim();
  } else if (queryKey) {
    rawKey = String(queryKey).trim();
  }

  if (!rawKey) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing API key. Provide via Authorization header: Bearer <key> or ?api_key=<key>'
    });
  }

  const user = await authService.validateKey(rawKey);
  if (!user) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid, expired, or revoked API key'
    });
  }

  request.user = user;
}

/**
 * Require specific scope (e.g. 'messages:send', 'sessions:manage')
 */
export function requireScope(scope: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });
    }
    if (user.isAdmin || user.scopes.includes('*') || user.scopes.includes(scope)) {
      return;
    }
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: `Missing required scope: ${scope}`
    });
  };
}

/**
 * Guard chat-level permission on a specific session and JID
 */
export function requireChatAccess(action: 'read' | 'send') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' });

    const params = request.params as any;
    const body = request.body as any;

    const sessionId = params?.id || params?.sessionId || body?.sessionId;
    const chatJid = params?.jid || body?.to || body?.chatJid;

    if (!sessionId || !chatJid) {
      return; // Route doesn't target a specific chat
    }

    const hasAccess = await authService.checkChatPermission(user, sessionId, chatJid, action);
    if (!hasAccess) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `API Key does not have permission to ${action} chat ${chatJid} on session ${sessionId}`
      });
    }
  };
}
