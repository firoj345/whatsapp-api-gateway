import { downloadMediaMessage, proto } from '@whiskeysockets/baileys';
import { db, isDbAvailable } from '../../infra/db.js';
import { messagesTable } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { sessionManager } from '../sessions/manager.js';
import { webhookDispatcher } from '../webhooks/dispatcher.js';
import { voiceQueryService } from '../voice/voice.service.js';
import { aiBotService } from '../ai/bot.service.js';
import { messageQueue } from './queue.js';
import { recentMessageStore } from './message-store.js';
import { chatFeedStore, WhatsAppContact } from './chat-feed-store.js';
import { logger } from '../../infra/logger.js';
import { messageReceivedCounter } from '../../infra/metrics.js';
import { r2Storage } from '../../infra/r2.js';

import { lidMap } from './lid-map.js';

class DeduplicationCache {
  private set = new Set<string>();
  private readonly maxSize = 5000;

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.size >= this.maxSize) {
      const first = this.set.values().next().value;
      if (first) this.set.delete(first);
    }
    this.set.add(id);
  }
}

const processedMessageIds = new DeduplicationCache();
const profilePictureLookups = new Map<string, number>();

function getMessageTimestampSec(msg: any): number {
  if (typeof msg.messageTimestamp === 'number') return msg.messageTimestamp;
  if (msg.messageTimestamp?.low !== undefined) return msg.messageTimestamp.low;
  return 0;
}

export function setupInboundHandler() {
  const updateContacts = (sessionId: string, contacts: WhatsAppContact[]) => {
    for (const contact of contacts) {
      if (contact.lid && contact.jid) lidMap.register(contact.lid, contact.jid);
      else if (contact.id?.endsWith('@lid') && contact.jid) lidMap.register(contact.id, contact.jid);
      chatFeedStore.upsertContact(sessionId, contact);
    }
  };

  sessionManager.on('session.contacts.upsert', ({ sessionId, contacts }) => {
    updateContacts(sessionId, contacts);
  });
  sessionManager.on('session.contacts.update', ({ sessionId, contacts }) => {
    updateContacts(sessionId, contacts);
  });

  // Listen to both live notify and offline reconnect append messages
  sessionManager.on('session.messages.upsert', async ({ sessionId, messages, type }) => {
    await processIncomingMessages(sessionId, messages, type === 'notify' ? 'notify' : 'append');
  });

  // Listen to history sync on reconnect for any missed offline messages
  sessionManager.on('session.messaging-history.set', async ({ sessionId, messages }) => {
    if (Array.isArray(messages) && messages.length > 0) {
      logger.info({ sessionId, count: messages.length }, '📜 Scanning history sync on reconnect for offline messages');
      await processIncomingMessages(sessionId, messages, 'history');
    }
  });

  // Track delivery status updates (sent, delivered, read)
  sessionManager.on('session.messages.update', async ({ sessionId, updates }) => {
    if (!Array.isArray(updates)) return;
    for (const update of updates) {
      if (!update.key?.id) continue;
      const statusMap: Record<number, string> = {
        1: 'sent',
        2: 'sent',
        3: 'delivered',
        4: 'read',
        5: 'read'
      };

      const newStatus = update.update?.status ? statusMap[update.update.status] : undefined;
      if (newStatus) {
        if (isDbAvailable) {
          try {
            await db
              .update(messagesTable)
              .set({ status: newStatus, updatedAt: new Date() })
              .where(eq(messagesTable.id, update.key.id));
          } catch {}
        }

        await webhookDispatcher.dispatch({
          event: 'message.status',
          sessionId,
          data: {
            messageId: update.key.id,
            status: newStatus
          },
          timestamp: Date.now()
        });
      }
    }
  });

  // Forward session lifecycle to webhooks
  sessionManager.on('session.status', ({ sessionId, status }) => {
    webhookDispatcher.dispatch({
      event: 'session.status',
      sessionId,
      data: { status },
      timestamp: Date.now()
    });
  });

  sessionManager.on('session.qr', ({ sessionId, qr }) => {
    webhookDispatcher.dispatch({
      event: 'session.qr',
      sessionId,
      data: { qr },
      timestamp: Date.now()
    });
  });

  logger.info('Inbound message event handlers initialized');
}

export function requestProfilePicture(sessionId: string, chatJid: string, lookupJid = chatJid): void {
  const contact = chatFeedStore.getContact(sessionId, chatJid);
  if (contact?.imgUrl !== undefined && contact.imgUrl !== 'changed') return;

  const socket = sessionManager.get(sessionId)?.getSocket();
  if (!socket) return;

  const lookupKey = `${sessionId}:${chatJid}`;
  const lastLookup = profilePictureLookups.get(lookupKey) || 0;
  if (Date.now() - lastLookup <= 60 * 60 * 1000) return;

  profilePictureLookups.set(lookupKey, Date.now());
  if (profilePictureLookups.size > 1000) {
    const oldestLookup = profilePictureLookups.keys().next().value;
    if (oldestLookup) profilePictureLookups.delete(oldestLookup);
  }

  void socket.profilePictureUrl(lookupJid, 'preview', 10_000)
    .then((url) => {
      if (url) chatFeedStore.updateProfilePicture(sessionId, chatJid, url);
    })
    .catch((err: Error) => {
      logger.debug({ sessionId, chatJid, err: err.message }, 'Could not load WhatsApp profile picture');
    });
}

async function processIncomingMessages(sessionId: string, messages: any[], source: 'notify' | 'append' | 'history') {
  if (!Array.isArray(messages) || messages.length === 0) return;

  const session = sessionManager.get(sessionId);
  if (!session) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const MAX_OFFLINE_AGE_SEC = 24 * 60 * 60; // 24-hour catch-up window for messages sent during network drops

  for (const msg of messages) {
    if (!msg || !msg.message) continue;

    // Ignore broadcast stories or outgoing messages from self
    if (msg.key?.fromMe || msg.key?.remoteJid === 'status@broadcast') continue;

    let m = msg.message;

    // Unwrap wrappers
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

    // Skip internal WhatsApp protocol/encryption stubs
    if (
      m.protocolMessage ||
      m.senderKeyDistributionMessage ||
      m.deviceSentMessage ||
      m.fastRatchetKeyDistributionMessage ||
      m.reactionMessage
    ) {
      continue;
    }

    const remoteJid = msg.key.remoteJid!;
    const senderPn = (msg.key as any).senderPn;

    if (remoteJid.endsWith('@lid') && senderPn) {
      lidMap.register(remoteJid, senderPn);
    }

    const chatJid = lidMap.getCanonicalJid(remoteJid, senderPn);
    const senderJid = senderPn || msg.key.participant || chatJid;
    if (chatJid.endsWith('@lid') && senderPn) {
      chatFeedStore.upsertContact(sessionId, { id: chatJid, jid: senderPn });
    }
    const messageId = msg.key.id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 1. Fast in-memory deduplication check
    if (processedMessageIds.has(messageId)) {
      continue;
    }

    // 2. Check offline message age to ignore ancient historical chats while catching up
    const msgTimestampSec = getMessageTimestampSec(msg);
    if ((source === 'append' || source === 'history') && msgTimestampSec > 0) {
      const ageSec = nowSec - msgTimestampSec;
      if (ageSec > MAX_OFFLINE_AGE_SEC) {
        logger.debug({ sessionId, messageId, ageSec }, '⏭️ Skipping old historical backlog from sync');
        continue;
      }
    }

    // 3. Database deduplication check
    if (isDbAvailable) {
      try {
        const existing = await db
          .select({ id: messagesTable.id })
          .from(messagesTable)
          .where(eq(messagesTable.id, messageId))
          .limit(1);

        if (existing.length > 0) {
          processedMessageIds.add(messageId);
          continue;
        }
      } catch {}
    }

    processedMessageIds.add(messageId);
    recentMessageStore.store(messageId, m);

    // Extract message content
    let textContent = '';
    let msgType = 'text';
    let isVoice = false;
    let mediaUrl: string | undefined;
    let preloadedAudioBuffer: Buffer | null = null;

    if (m.conversation) {
      textContent = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      textContent = m.extendedTextMessage.text;
    } else if (m.imageMessage) {
      msgType = 'image';
      textContent = m.imageMessage.caption || '';
      try {
        const imageBuffer = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: logger as any, reuploadRequest: session.getSocket()?.updateMediaMessage as any }
        )) as Buffer;
        if (imageBuffer && imageBuffer.length > 0) {
          mediaUrl = await r2Storage.uploadMedia({
            buffer: imageBuffer,
            filename: `img_${messageId}.jpg`,
            mimeType: m.imageMessage.mimetype || 'image/jpeg',
            folder: 'customer-images'
          });
        }
      } catch (imgErr: any) {
        logger.warn({ messageId, err: imgErr?.message }, 'Failed to download inbound image for R2 storage');
      }
    } else if (m.audioMessage) {
      msgType = 'voice';
      isVoice = true;
      try {
        preloadedAudioBuffer = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: logger as any, reuploadRequest: session.getSocket()?.updateMediaMessage as any }
        )) as Buffer;
        if (preloadedAudioBuffer && preloadedAudioBuffer.length > 0) {
          mediaUrl = await r2Storage.uploadMedia({
            buffer: preloadedAudioBuffer,
            filename: `voice_${messageId}.ogg`,
            mimeType: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
            folder: 'customer-voice'
          });
        }
      } catch (audioErr: any) {
        logger.warn({ messageId, err: audioErr?.message }, 'Failed to download inbound voice note for R2 storage');
      }
    } else if (m.documentMessage) {
      msgType = 'document';
      textContent = m.documentMessage.fileName || 'document';
    } else if (m.videoMessage) {
      msgType = 'video';
      textContent = m.videoMessage.caption || '';
    }

    // Ignore empty non-media messages
    if (!textContent && !isVoice && msgType === 'text') {
      continue;
    }

    const previewSnippet = textContent
      ? (msgType === 'image' ? `📷 ${textContent}` : textContent)
      : (msgType === 'image' ? '📷 Photo' : (msgType === 'voice' ? '🎙️ Voice note' : (msgType === 'document' ? `📄 ${textContent || 'Document'}` : null)));

    const senderPhone = senderPn?.split('@')[0] || (senderJid.includes('@s.whatsapp.net') ? senderJid.split('@')[0] : undefined);
    const messageTimestampSec = getMessageTimestampSec(msg);
    chatFeedStore.upsert({
      sessionId,
      chatJid,
      displayName: senderPhone ? (msg.pushName ? `${msg.pushName} (+${senderPhone})` : `+${senderPhone}`) : chatJid,
      lastMessage: previewSnippet,
      lastTimestamp: new Date(messageTimestampSec > 0 ? messageTimestampSec * 1000 : Date.now()).toISOString()
    });
    const contact = chatFeedStore.getContact(sessionId, chatJid);
    if (contact?.imgUrl === undefined || contact.imgUrl === 'changed') {
      requestProfilePicture(sessionId, chatJid, senderPn || chatJid);
    }
    chatFeedStore.recordMessage({
      id: messageId,
      sessionId,
      chatJid,
      senderJid,
      direction: 'inbound',
      type: msgType,
      content: textContent || null,
      mediaUrl: mediaUrl || null,
      status: 'delivered',
      createdAt: new Date(messageTimestampSec > 0 ? messageTimestampSec * 1000 : Date.now()).toISOString()
    });

    if (source === 'append' || source === 'history') {
      logger.info(
        { sessionId, messageId, chatJid, senderJid, source, textContent: textContent.slice(0, 40) },
        '📶 Picked up offline customer message received during network drop'
      );
    }

    messageReceivedCounter.inc({ session_id: sessionId, type: msgType });

    // Save to database
    if (isDbAvailable) {
      try {
        await db.insert(messagesTable).values({
          id: messageId,
          sessionId,
          chatJid,
          senderJid,
          direction: 'inbound',
          type: msgType,
          content: textContent || null,
          mediaUrl: mediaUrl || null,
          status: 'delivered',
          metadata: {
            pushName: msg.pushName,
            senderPn: senderPn ? senderPn.split('@')[0] : undefined,
            recoveredAfterNetworkDrop: source !== 'notify'
          },
          updatedAt: new Date()
        });
      } catch (err: any) {
        logger.debug({ err: err?.message || String(err) }, 'Failed to persist inbound message');
      }
    }

    // Mark message read with natural delay (500 - 1500 ms)
    setTimeout(async () => {
      try {
        await session.provider.markRead(chatJid, [msg.key]);
      } catch {}
    }, 500 + Math.random() * 1000);

    // Dispatch Webhook
    await webhookDispatcher.dispatch({
      event: 'message.received',
      sessionId,
      data: {
        messageId,
        from: senderJid,
        chatJid,
        type: msgType,
        content: textContent,
        mediaUrl: mediaUrl || undefined,
        pushName: msg.pushName,
        timestamp: msg.messageTimestamp,
        recoveredAfterNetworkDrop: source !== 'notify'
      },
      timestamp: Date.now()
    });

    // 1. Voice-to-Database / ERP Pipeline
    if (isVoice && msg.message?.audioMessage) {
      handleVoiceQuery(sessionId, chatJid, senderJid, msg, session, preloadedAudioBuffer, mediaUrl, messageId);
      continue;
    }

    // 2. AI Auto-Reply Bot Pipeline -> queues answer into messageQueue
    if (textContent && !isVoice) {
      handleAiBotReply(sessionId, chatJid, textContent);
    }
  }
}

async function handleVoiceQuery(
  sessionId: string,
  chatJid: string,
  senderJid: string,
  msg: any,
  session: any,
  preloadedBuffer?: Buffer | null,
  mediaUrl?: string | null,
  inboundMessageId?: string
) {
  try {
    logger.info({ sessionId, chatJid }, '🎙️ Processing incoming voice note (STT Pipeline)');
    const audioBuffer = preloadedBuffer || (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: logger as any, reuploadRequest: session.getSocket()?.updateMediaMessage as any }
    )) as Buffer;

    const result = await voiceQueryService.processVoiceNote({
      sessionId,
      chatJid,
      senderJid,
      audioBuffer,
      audioUrl: mediaUrl || undefined
    });

    // Update inbound message in DB and chat feed with transcription if available
    if (result.transcript && inboundMessageId) {
      if (isDbAvailable) {
        try {
          await db
            .update(messagesTable)
            .set({ content: result.transcript })
            .where(eq(messagesTable.id, inboundMessageId));
        } catch {}
      }
    }

    if (result.type === 'image' && result.mediaUrl) {
      logger.info({ sessionId, chatJid, mediaUrl: result.mediaUrl }, '🎨 AI Voice dispatching generated image to queue');
      await messageQueue.enqueue({
        messageId: `voice_img_${Date.now()}`,
        sessionId,
        to: chatJid,
        type: 'image',
        mediaUrl: result.mediaUrl,
        content: result.content
      });
    } else {
      await messageQueue.enqueue({
        messageId: `voice_reply_${Date.now()}`,
        sessionId,
        to: chatJid,
        type: 'text',
        content: result.content
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to process voice note');
  }
}

async function handleAiBotReply(sessionId: string, chatJid: string, text: string) {
  try {
    logger.info({ sessionId, chatJid, text }, '🤖 AI Bot evaluating incoming customer message');
    const botResult = await aiBotService.handleIncomingMessage(sessionId, chatJid, text);
    if (botResult.shouldReply) {
      if (botResult.replyType === 'image' && botResult.mediaUrl) {
        logger.info({ sessionId, chatJid, mediaUrl: botResult.mediaUrl }, '🎨 AI Bot dispatching generated image to queue');
        await messageQueue.enqueue({
          messageId: `bot_img_${Date.now()}`,
          sessionId,
          to: chatJid,
          type: 'image',
          mediaUrl: botResult.mediaUrl,
          content: botResult.replyText
        });
      } else if (botResult.replyText) {
        logger.info({ sessionId, chatJid, replyLength: botResult.replyText.length }, '🤖 AI Bot dispatching auto-reply to queue');
        await messageQueue.enqueue({
          messageId: `bot_reply_${Date.now()}`,
          sessionId,
          to: chatJid,
          type: 'text',
          content: botResult.replyText
        });
      }
    } else {
      logger.info({ sessionId, chatJid, shouldReply: botResult.shouldReply }, '🤖 AI Bot skipped reply (inactive or cap reached)');
    }
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, 'AI bot processing error');
  }
}
