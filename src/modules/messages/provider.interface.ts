/**
 * Abstract MessageProvider interface.
 * Allows seamless hot-swapping between:
 * 1. Baileys (Unofficial Web Socket protocol - supports QR, multi-account, free)
 * 2. WhatsApp Business Cloud API (Official Meta Graph API - requires Meta approval, ban-safe)
 */

export interface MessageOptions {
  idempotencyKey?: string;
  quotedMessageId?: string;
  simulateTyping?: boolean;
}

export interface MessageResult {
  messageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  timestamp: number;
  provider: 'baileys' | 'cloud_api';
  rawResponse?: any;
}

export interface CheckNumberResult {
  exists: boolean;
  jid?: string;
  formattedNumber?: string;
}

export interface IMessageProvider {
  readonly providerName: 'baileys' | 'cloud_api';
  readonly sessionId: string;

  /**
   * Check if a phone number exists on WhatsApp before sending.
   * Prevents spam flags from messaging non-existent accounts.
   */
  checkNumber(phoneOrJid: string): Promise<CheckNumberResult>;

  /**
   * Set presence (e.g., composing, recording, paused)
   */
  setPresence(chatJid: string, presence: 'composing' | 'recording' | 'paused' | 'available'): Promise<void>;

  /**
   * Send plain text message
   */
  sendText(chatJid: string, text: string, options?: MessageOptions): Promise<MessageResult>;

  /**
   * Send image message with optional caption (Buffer or remote URL)
   */
  sendImage(chatJid: string, image: Buffer | string, caption?: string, options?: MessageOptions): Promise<MessageResult>;

  /**
   * Send document / PDF message
   */
  sendDocument(chatJid: string, doc: Buffer | string, filename: string, mimetype?: string, caption?: string, options?: MessageOptions): Promise<MessageResult>;

  /**
   * Send voice note / PTT (Push-To-Talk) audio
   */
  sendVoice(chatJid: string, audio: Buffer | string, ptt?: boolean, options?: MessageOptions): Promise<MessageResult>;

  /**
   * Send reaction emoji to an existing message
   */
  sendReaction(chatJid: string, messageKey: any, emoji: string): Promise<MessageResult>;

  /**
   * Mark chat messages as read
   */
  markRead(chatJid: string, messageKeys?: any[]): Promise<void>;
}
