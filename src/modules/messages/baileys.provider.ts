import { proto, WASocket } from '@whiskeysockets/baileys';
import fs from 'fs';
import { IMessageProvider, MessageOptions, MessageResult, CheckNumberResult } from './provider.interface.js';
import { recentMessageStore } from './message-store.js';
import { lidMap } from './lid-map.js';
import { logger } from '../../infra/logger.js';
import { messageSentCounter } from '../../infra/metrics.js';

export class BaileysMessageProvider implements IMessageProvider {
  readonly providerName = 'baileys' as const;

  constructor(
    readonly sessionId: string,
    private getSocket: () => WASocket | undefined
  ) {}

  private requireSocket(): WASocket {
    const socket = this.getSocket();
    if (!socket) {
      throw new Error(`Session ${this.sessionId} is not connected or socket is unavailable`);
    }
    return socket;
  }

  /**
   * Format phone number to WhatsApp JID with auto-country code normalization
   * and LID routing to prevent Signal ratchet session mismatches
   */
  private formatJid(target: string): string {
    const knownLid = lidMap.getLid(target);
    if (knownLid) {
      return knownLid;
    }

    if (target.includes('@')) {
      return target;
    }
    let cleanNumber = target.replace(/\D/g, '');
    // Auto-normalize 10-digit Indian numbers (starts with 6, 7, 8, 9)
    if (cleanNumber.length === 10 && /^[6-9]/.test(cleanNumber)) {
      cleanNumber = `91${cleanNumber}`;
    }
    return `${cleanNumber}@s.whatsapp.net`;
  }

  async checkNumber(phoneOrJid: string): Promise<CheckNumberResult> {
    const sock = this.requireSocket();
    let clean = phoneOrJid.replace(/[^0-9]/g, '');
    if (clean.length === 10 && /^[6-9]/.test(clean)) {
      clean = `91${clean}`;
    }
    try {
      const results = await sock.onWhatsApp(clean);
      if (results && results.length > 0 && results[0].exists) {
        return { exists: true, jid: results[0].jid };
      }
      return { exists: false };
    } catch (err: any) {
      logger.warn({ err: err.message, phone: phoneOrJid }, 'Failed to check number on WhatsApp');
      return { exists: true, jid: this.formatJid(phoneOrJid) };
    }
  }

  async setPresence(chatJid: string, presence: 'composing' | 'recording' | 'paused' | 'available'): Promise<void> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);
    try {
      await sock.sendPresenceUpdate(presence, jid);
    } catch (err: any) {
      logger.debug({ err: err.message, jid, presence }, 'Presence update error');
    }
  }

  async sendText(chatJid: string, text: string, options?: MessageOptions): Promise<MessageResult> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);

    const sent = await sock.sendMessage(jid, { text });
    const messageId = sent?.key?.id || `msg_${Date.now()}`;
    if (sent?.key?.id && sent?.message) {
      recentMessageStore.store(sent.key.id, sent.message);
    }

    messageSentCounter.inc({ session_id: this.sessionId, type: 'text', status: 'sent' });

    return {
      messageId,
      status: 'sent',
      timestamp: Date.now(),
      provider: 'baileys',
      rawResponse: sent
    };
  }

  async sendImage(chatJid: string, image: Buffer | string, caption?: string, options?: MessageOptions): Promise<MessageResult> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);

    let imageSource: any;
    if (typeof image === 'string') {
      if (image.startsWith('http://') || image.startsWith('https://')) {
        imageSource = { url: image };
      } else if (fs.existsSync(image)) {
        imageSource = fs.readFileSync(image);
      } else {
        imageSource = Buffer.from(image, 'base64');
      }
    } else {
      imageSource = image;
    }

    const payload: any = { image: imageSource, caption };

    const sent = await sock.sendMessage(jid, payload);
    const messageId = sent?.key?.id || `msg_${Date.now()}`;
    if (sent?.key?.id && sent?.message) {
      recentMessageStore.store(sent.key.id, sent.message);
    }

    messageSentCounter.inc({ session_id: this.sessionId, type: 'image', status: 'sent' });

    return {
      messageId,
      status: 'sent',
      timestamp: Date.now(),
      provider: 'baileys',
      rawResponse: sent
    };
  }

  async sendDocument(chatJid: string, doc: Buffer | string, filename: string, mimetype = 'application/pdf', caption?: string, options?: MessageOptions): Promise<MessageResult> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);

    const payload: any = typeof doc === 'string' && doc.startsWith('http')
      ? { document: { url: doc }, fileName: filename, mimetype, caption }
      : { document: Buffer.isBuffer(doc) ? doc : Buffer.from(doc, 'base64'), fileName: filename, mimetype, caption };

    const sent = await sock.sendMessage(jid, payload);
    const messageId = sent?.key?.id || `msg_${Date.now()}`;
    if (sent?.key?.id && sent?.message) {
      recentMessageStore.store(sent.key.id, sent.message);
    }

    messageSentCounter.inc({ session_id: this.sessionId, type: 'document', status: 'sent' });

    return {
      messageId,
      status: 'sent',
      timestamp: Date.now(),
      provider: 'baileys',
      rawResponse: sent
    };
  }

  async sendVoice(chatJid: string, audio: Buffer | string, ptt = true, options?: MessageOptions): Promise<MessageResult> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);

    const payload: any = typeof audio === 'string' && audio.startsWith('http')
      ? { audio: { url: audio }, mimetype: 'audio/ogg; codecs=opus', ptt }
      : { audio: Buffer.isBuffer(audio) ? audio : Buffer.from(audio, 'base64'), mimetype: 'audio/ogg; codecs=opus', ptt };

    const sent = await sock.sendMessage(jid, payload);
    const messageId = sent?.key?.id || `msg_${Date.now()}`;
    if (sent?.key?.id && sent?.message) {
      recentMessageStore.store(sent.key.id, sent.message);
    }

    messageSentCounter.inc({ session_id: this.sessionId, type: 'voice', status: 'sent' });

    return {
      messageId,
      status: 'sent',
      timestamp: Date.now(),
      provider: 'baileys',
      rawResponse: sent
    };
  }

  async sendReaction(chatJid: string, messageKey: any, emoji: string): Promise<MessageResult> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);

    const sent = await sock.sendMessage(jid, {
      react: {
        text: emoji,
        key: messageKey
      }
    });

    const messageId = sent?.key?.id || `react_${Date.now()}`;
    messageSentCounter.inc({ session_id: this.sessionId, type: 'reaction', status: 'sent' });

    return {
      messageId,
      status: 'sent',
      timestamp: Date.now(),
      provider: 'baileys',
      rawResponse: sent
    };
  }

  async markRead(chatJid: string, messageKeys?: any[]): Promise<void> {
    const sock = this.requireSocket();
    const jid = this.formatJid(chatJid);
    if (messageKeys && messageKeys.length > 0) {
      await sock.readMessages(messageKeys);
    } else {
      await sock.chatModify({ markRead: true, lastMessages: [] }, jid);
    }
  }
}
