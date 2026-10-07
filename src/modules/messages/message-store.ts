import { proto } from '@whiskeysockets/baileys';
import { db, isDbAvailable } from '../../infra/db.js';
import { messagesTable } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../../infra/logger.js';

class RecentMessageStore {
  private cache = new Map<string, proto.IMessage>();
  private readonly maxSize = 1000;

  store(keyId: string, message: proto.IMessage) {
    if (!keyId || !message) return;
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(keyId, message);
  }

  async get(key: { id?: string | null; remoteJid?: string | null }): Promise<proto.IMessage | undefined> {
    const keyId = key.id;
    if (!keyId) return undefined;

    // 1. Check in-memory rolling cache
    if (this.cache.has(keyId)) {
      logger.debug({ keyId }, '🔄 Found message in memory cache for retry request');
      return this.cache.get(keyId);
    }

    // 2. Fallback to database
    if (isDbAvailable) {
      try {
        const rows = await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.id, keyId))
          .limit(1);

        if (rows.length > 0 && rows[0].content) {
          logger.debug({ keyId }, '🔄 Found message in DB for retry request');
          const reconstructed: proto.IMessage = {
            conversation: rows[0].content
          };
          this.cache.set(keyId, reconstructed);
          return reconstructed;
        }
      } catch {}
    }

    return undefined;
  }
}

export const recentMessageStore = new RecentMessageStore();
