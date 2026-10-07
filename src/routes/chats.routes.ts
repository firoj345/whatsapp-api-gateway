import { FastifyInstance } from 'fastify';
import { db, isDbAvailable } from '../infra/db.js';
import { messagesTable } from '../db/schema.js';
import { eq, and, desc, inArray, or, sql } from 'drizzle-orm';
import { authenticateApiKey, requireScope, requireChatAccess } from '../modules/auth/guard.js';
import { authService } from '../modules/auth/auth.service.js';
import { aiBotService } from '../modules/ai/bot.service.js';
import { ChatFeedEntry, ChatFeedEvent, chatFeedStore, normalizeChatJid } from '../modules/messages/chat-feed-store.js';
import { requestProfilePicture } from '../modules/messages/inbound.handler.js';
import { lidMap } from '../modules/messages/lid-map.js';

type AllowedChatJids = string[] | '*';

function chatIsAllowed(allowed: AllowedChatJids, chatJid: string, canonicalJid = lidMap.getCanonicalJid(chatJid)): boolean {
  return allowed === '*' || allowed.some((allowedJid) =>
    allowedJid === chatJid || lidMap.getCanonicalJid(allowedJid) === canonicalJid
  );
}

function requestMissingProfilePictures(sessionId: string, chats: ChatFeedEntry[]): void {
  for (const chat of chats.slice(0, 10)) {
    if (!chat.profilePictureUrl) requestProfilePicture(sessionId, chat.chatJid);
  }
}

async function listSessionChats(sessionId: string, allowed: AllowedChatJids): Promise<ChatFeedEntry[]> {
  if (Array.isArray(allowed) && allowed.length === 0) return [];
  if (!isDbAvailable) {
    const chats = chatFeedStore.list(sessionId)
      .filter((chat) => chatIsAllowed(allowed, chat.chatJid))
      .map((chat) => {
        const contact = chatFeedStore.getContact(sessionId, chat.chatJid);
        return {
          ...chat,
          displayName: contact?.name || contact?.notify || contact?.verifiedName || chat.displayName,
          profilePictureUrl: contact?.imgUrl !== undefined && contact.imgUrl !== 'changed'
            ? contact.imgUrl
            : chat.profilePictureUrl
        };
      });
    requestMissingProfilePictures(sessionId, chats);
    return chats;
  }

  const rows = await db
    .select({
      chatJid: messagesTable.chatJid,
      senderJid: messagesTable.senderJid,
      metadata: messagesTable.metadata,
      lastMessage: messagesTable.content,
      lastTimestamp: messagesTable.createdAt
    })
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(50);

  const seen = new Set<string>();
  const chats: ChatFeedEntry[] = [];
  for (const row of rows) {
    const metadata = row.metadata as any;
    const canonicalJid = lidMap.getCanonicalJid(row.chatJid, metadata?.senderPn);
    if (!chatIsAllowed(allowed, row.chatJid, canonicalJid)) continue;
    if (seen.has(canonicalJid)) continue;
    seen.add(canonicalJid);
    const phone = metadata?.senderPn || (row.senderJid?.includes('@s.whatsapp.net') ? row.senderJid.split('@')[0] : null);
    const contact = chatFeedStore.getContact(sessionId, canonicalJid) || chatFeedStore.getContact(sessionId, row.chatJid);
    const name = contact?.name || contact?.notify || contact?.verifiedName || metadata?.pushName;
    const chat: ChatFeedEntry = {
      sessionId,
      chatJid: canonicalJid,
      displayName: phone ? (name ? `${name} (+${phone})` : `+${phone}`) : row.chatJid,
      profilePictureUrl: contact?.imgUrl !== undefined && contact.imgUrl !== 'changed'
        ? contact.imgUrl
        : chatFeedStore.list(sessionId).find((chat) => chat.chatJid === canonicalJid)?.profilePictureUrl,
      lastMessage: row.lastMessage,
      lastTimestamp: row.lastTimestamp instanceof Date ? row.lastTimestamp.toISOString() : String(row.lastTimestamp)
    };
    chatFeedStore.upsert(chat);
    chats.push(chatFeedStore.list(sessionId).find((entry) => entry.chatJid === canonicalJid) || chat);
  }
  requestMissingProfilePictures(sessionId, chats);
  return chats;
}

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // List recent active chats for a session (filtered by API key permissions)
  fastify.get('/sessions/:id/chats', {
    preHandler: [requireScope('messages:read')],
    schema: {
      tags: ['Chats'],
      summary: 'Get all active chats for a session'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.user!;
    const allowed = await authService.getAllowedChatJids(user, id);
    return listSessionChats(id, allowed);
  });

  fastify.get('/sessions/:id/chats/stream', {
    preHandler: [requireScope('messages:read')],
    schema: {
      tags: ['Chats'],
      summary: 'Stream chat updates for a session'
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = req.user!;
    const allowed = await authService.getAllowedChatJids(user, id);
    if (Array.isArray(allowed) && allowed.length === 0) {
      return reply.status(403).send({ error: 'No chat read access for this session' });
    }

    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.flushHeaders();

    const writeEvent = (event: string, data: unknown) => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    let snapshotReady = false;
    const pendingEvents: ChatFeedEvent[] = [];
    const unsubscribe = chatFeedStore.subscribe((event) => {
      const entry = event.data;
      if (entry.sessionId !== id || !chatIsAllowed(allowed, entry.chatJid)) return;
      if (snapshotReady) writeEvent(event.type, entry);
      else pendingEvents.push(event);
    });

    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n');
    }, 15000);
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    response.on('close', cleanup);

    try {
      writeEvent('snapshot', await listSessionChats(id, allowed));
      snapshotReady = true;
      for (const event of pendingEvents) writeEvent(event.type, event.data);
    } catch {
      cleanup();
      response.destroy();
    }
    return reply;
  });

  // Get messages for a specific chat
  fastify.get('/sessions/:id/chats/:jid/messages', {
    preHandler: [requireScope('messages:read'), requireChatAccess('read')],
    schema: {
      tags: ['Chats'],
      summary: 'Get message history for a specific chat'
    }
  }, async (req, reply) => {
    const { id, jid } = req.params as { id: string; jid: string };
    const { limit = 100 } = req.query as { limit?: number };
    const allowed = await authService.getAllowedChatJids(req.user!, id);
    const canonicalJid = lidMap.getCanonicalJid(normalizeChatJid(jid));
    if (!chatIsAllowed(allowed, jid, canonicalJid)) return [];
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    if (!isDbAvailable) return chatFeedStore.listMessages(id, jid, boundedLimit);
    const normalizedJid = normalizeChatJid(jid);
    const chatJids = Array.from(new Set([
      jid,
      normalizedJid,
      canonicalJid,
      canonicalJid.endsWith('@s.whatsapp.net') ? canonicalJid.slice(0, -'@s.whatsapp.net'.length) : canonicalJid,
      lidMap.getLid(canonicalJid)
    ]));
    const phoneDigits = canonicalJid.endsWith('@s.whatsapp.net')
      ? canonicalJid.slice(0, -'@s.whatsapp.net'.length)
      : undefined;

    const rows = await db
      .select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.sessionId, id),
        phoneDigits
          ? or(
              inArray(messagesTable.chatJid, chatJids.filter((chatJid): chatJid is string => Boolean(chatJid))),
              sql`${messagesTable.metadata}->>'senderPn' = ${phoneDigits}`
            )
          : inArray(messagesTable.chatJid, chatJids.filter((chatJid): chatJid is string => Boolean(chatJid)))
      ))
      .orderBy(desc(messagesTable.createdAt))
      .limit(boundedLimit);

    return rows.reverse().map((row) => ({ ...row, chatJid: jid }));
  });

  // Get clean LLM conversation context
  fastify.get('/sessions/:id/chats/:jid/context', {
    preHandler: [requireScope('messages:read'), requireChatAccess('read')],
    schema: {
      tags: ['AI & Chatbot'],
      summary: 'Get LLM-ready conversation context (role: user|assistant)'
    }
  }, async (req, reply) => {
    const { id, jid } = req.params as { id: string; jid: string };
    const { limit = 20 } = req.query as { limit?: number };

    const context = await aiBotService.getChatContext(id, jid, Number(limit));
    return {
      sessionId: id,
      chatJid: jid,
      messages: context
    };
  });
}
