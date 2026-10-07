import { lidMap } from './lid-map.js';

export interface ChatFeedEntry {
  sessionId: string;
  chatJid: string;
  displayName: string;
  profilePictureUrl?: string | null;
  lastMessage: string | null;
  lastTimestamp: string;
}

export interface WhatsAppContact {
  id?: string;
  jid?: string;
  lid?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  imgUrl?: string | null;
}

export interface ChatMessageEntry {
  id: string;
  sessionId: string;
  chatJid: string;
  senderJid?: string | null;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  mediaUrl?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export type ChatFeedEvent =
  | { type: 'chat'; data: ChatFeedEntry }
  | { type: 'message'; data: ChatMessageEntry };

export function normalizeChatJid(value: string): string {
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : value;
}

class ChatFeedStore {
  private chats = new Map<string, ChatFeedEntry>();
  private messages = new Map<string, ChatMessageEntry>();
  private contacts = new Map<string, WhatsAppContact>();
  private listeners = new Set<(event: ChatFeedEvent) => void>();
  private readonly maxChats = 500;
  private readonly maxMessages = 5000;

  upsert(chat: ChatFeedEntry): void {
    const canonicalJid = lidMap.getCanonicalJid(chat.chatJid);
    const canonicalChat = { ...chat, chatJid: canonicalJid };
    const key = JSON.stringify([chat.sessionId, canonicalJid]);
    const aliases = Array.from(this.chats.entries())
      .filter(([, entry]) =>
        entry.sessionId === chat.sessionId &&
        lidMap.getCanonicalJid(entry.chatJid) === canonicalJid
      );
    const existing = this.chats.get(key) || aliases
      .map(([, entry]) => entry)
      .sort((first, second) => Date.parse(second.lastTimestamp) - Date.parse(first.lastTimestamp))[0];
    const latestChat = existing && Date.parse(existing.lastTimestamp) > Date.parse(chat.lastTimestamp)
      ? existing
      : canonicalChat;

    const contact = this.getContact(chat.sessionId, chat.chatJid);
    const contactName = contact?.name || contact?.notify || contact?.verifiedName;
    const contactPicture = contact?.imgUrl === undefined || contact.imgUrl === 'changed'
      ? undefined
      : contact.imgUrl;
    const resolvedChat = {
      ...existing,
      ...latestChat,
      chatJid: canonicalJid,
      displayName: contactName ||
        (this.isInformativeName(chat.displayName, canonicalJid)
          ? chat.displayName
          : this.isInformativeName(existing?.displayName, canonicalJid)
            ? existing?.displayName
            : chat.displayName || existing?.displayName || chat.chatJid) ||
        chat.chatJid,
      profilePictureUrl: contactPicture !== undefined
        ? contactPicture
        : chat.profilePictureUrl || existing?.profilePictureUrl || null
    };

    for (const [aliasKey] of aliases) {
      if (aliasKey !== key) this.chats.delete(aliasKey);
    }
    this.chats.set(key, resolvedChat);
    this.publish({ type: 'chat', data: resolvedChat });

    while (this.chats.size > this.maxChats) {
      const oldestKey = this.chats.keys().next().value;
      if (oldestKey) this.chats.delete(oldestKey);
    }
  }

  upsertContact(sessionId: string, contact: WhatsAppContact): void {
    const aliases = this.contactAliases(contact);
    if (aliases.length === 0) return;

    const existingContact = aliases
      .map((alias) => this.contacts.get(JSON.stringify([sessionId, alias])))
      .find((value) => value !== undefined);
    const mergedContact = { ...existingContact, ...contact };
    if (contact.imgUrl === undefined || contact.imgUrl === 'changed') {
      mergedContact.imgUrl = existingContact?.imgUrl;
    }

    for (const alias of aliases) {
      const key = JSON.stringify([sessionId, alias]);
      this.contacts.set(key, mergedContact);
    }

    const name = contact.name || contact.notify || contact.verifiedName;
    const profilePictureUrl = contact.imgUrl === undefined || contact.imgUrl === 'changed'
      ? undefined
      : contact.imgUrl;
    const aliasSet = new Set(aliases);
    const matchingChats = Array.from(this.chats.entries())
      .filter(([, chat]) => chat.sessionId === sessionId && aliasSet.has(chat.chatJid));
    for (const [key, chat] of matchingChats) {
      if (chat.sessionId !== sessionId || !aliasSet.has(chat.chatJid)) continue;
      const updated = {
        ...chat,
        displayName: name || chat.displayName,
        profilePictureUrl: profilePictureUrl !== undefined ? profilePictureUrl : chat.profilePictureUrl
      };
      this.chats.delete(key);
      this.upsert(updated);
    }
  }

  getContact(sessionId: string, chatJid: string): WhatsAppContact | undefined {
    return this.contacts.get(JSON.stringify([sessionId, chatJid])) ||
      this.contacts.get(JSON.stringify([sessionId, normalizeChatJid(chatJid)]));
  }

  updateProfilePicture(sessionId: string, chatJid: string, profilePictureUrl: string | null): void {
    const key = JSON.stringify([sessionId, chatJid]);
    const chat = this.chats.get(key);
    if (!chat || chat.profilePictureUrl === profilePictureUrl) return;

    const updated = { ...chat, profilePictureUrl };
    this.chats.set(key, updated);
    this.publish({ type: 'chat', data: updated });
  }

  list(sessionId: string): ChatFeedEntry[] {
    return Array.from(this.chats.values())
      .filter((chat) => chat.sessionId === sessionId)
      .sort((first, second) => Date.parse(second.lastTimestamp) - Date.parse(first.lastTimestamp))
      .slice(0, 50);
  }

  recordMessage(message: ChatMessageEntry): void {
    const canonicalMessage = {
      ...message,
      chatJid: lidMap.getCanonicalJid(message.chatJid)
    };
    const key = JSON.stringify([canonicalMessage.sessionId, canonicalMessage.id]);
    if (this.messages.has(key)) return;
    this.messages.set(key, canonicalMessage);

    while (this.messages.size > this.maxMessages) {
      const oldestKey = this.messages.keys().next().value;
      if (oldestKey) this.messages.delete(oldestKey);
    }

    this.publish({ type: 'message', data: canonicalMessage });
  }

  listMessages(sessionId: string, chatJid: string, limit = 100): ChatMessageEntry[] {
    const canonicalJid = lidMap.getCanonicalJid(chatJid);
    return Array.from(this.messages.values())
      .filter((message) => message.sessionId === sessionId && lidMap.getCanonicalJid(message.chatJid) === canonicalJid)
      .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
      .slice(-limit);
  }

  subscribe(listener: (event: ChatFeedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(event: ChatFeedEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  private contactAliases(contact: WhatsAppContact): string[] {
    return Array.from(new Set([contact.id, contact.jid, contact.lid]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => [value, normalizeChatJid(value)])));
  }

  private isInformativeName(name: string | undefined, chatJid: string): boolean {
    if (!name || name === chatJid) return false;
    return !/^\+?[\d\s()-]+$/.test(name);
  }
}

export const chatFeedStore = new ChatFeedStore();
