import { db } from '../../infra/db.js';
import { apiKeysTable, keyChatPermissionsTable } from '../../db/schema.js';
import { hashApiKey, generateApiKey } from '../../infra/crypto.js';
import { env } from '../../config/env.js';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';

export interface AuthenticatedUser {
  keyId: string;
  name: string;
  isAdmin: boolean;
  scopes: string[];
  sessionIds: string[];
}

export class AuthService {
  private memoryKeys = new Map<string, any>();
  private memoryPermissions: any[] = [];

  /**
   * Validate API key from Authorization header
   */
  async validateKey(rawKey: string): Promise<AuthenticatedUser | null> {
    if (!rawKey) return null;

    // Check if it's the root admin key
    if (rawKey === env.ADMIN_API_KEY) {
      return {
        keyId: 'root-admin',
        name: 'Root Administrator',
        isAdmin: true,
        scopes: ['*'],
        sessionIds: ['*']
      };
    }

    const hashed = hashApiKey(rawKey);

    // Check memory store
    const memKey = this.memoryKeys.get(hashed);
    if (memKey && !memKey.revokedAt) {
      const scopes = memKey.scopes || [];
      return {
        keyId: memKey.id,
        name: memKey.name,
        isAdmin: scopes.includes('*'),
        scopes,
        sessionIds: memKey.sessionIds || []
      };
    }

    try {
      const records = await db
        .select()
        .from(apiKeysTable)
        .where(and(eq(apiKeysTable.keyHash, hashed), isNull(apiKeysTable.revokedAt)))
        .limit(1);

      if (records.length === 0) return null;

      const record = records[0];

      // Check expiration
      if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
        return null;
      }

      const scopes = record.scopes || [];
      const isAdmin = scopes.includes('*');

      return {
        keyId: record.id,
        name: record.name,
        isAdmin,
        scopes,
        sessionIds: record.sessionIds || []
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if an authenticated key has permission to read or send to a chat JID
   */
  async checkChatPermission(
    user: AuthenticatedUser,
    sessionId: string,
    chatJid: string,
    action: 'read' | 'send'
  ): Promise<boolean> {
    if (user.isAdmin) return true;

    // Check session access
    if (!user.sessionIds.includes('*') && !user.sessionIds.includes(sessionId)) {
      return false;
    }

    // Check scope
    const requiredScope = action === 'send' ? 'messages:send' : 'messages:read';
    if (!user.scopes.includes('*') && !user.scopes.includes(requiredScope)) {
      return false;
    }

    try {
      const dbPermissions = await db
        .select()
        .from(keyChatPermissionsTable)
        .where(
          and(
            eq(keyChatPermissionsTable.keyId, user.keyId),
            eq(keyChatPermissionsTable.sessionId, sessionId)
          )
        ).catch(() => []);

      const memPermissions = this.memoryPermissions.filter(
        (p) => p.keyId === user.keyId && p.sessionId === sessionId
      );

      const permissions = dbPermissions.length > 0 ? dbPermissions : memPermissions;

      if (permissions.length === 0) {
        // If no explicit chat restrictions are configured, allow access if session is assigned
        return true;
      }

      for (const perm of permissions) {
        const matchesJid = perm.chatJidPattern === '*' || perm.chatJidPattern === chatJid;
        if (matchesJid) {
          if (action === 'send' && perm.canSend) return true;
          if (action === 'read' && perm.canRead) return true;
        }
      }

      return false;
    } catch {
      return true;
    }
  }

  /**
   * Filter chat JIDs for querying at the data layer
   */
  async getAllowedChatJids(user: AuthenticatedUser, sessionId: string): Promise<string[] | '*'> {
    if (user.isAdmin) return '*';

    try {
      const permissions = await db
        .select()
        .from(keyChatPermissionsTable)
        .where(
          and(
            eq(keyChatPermissionsTable.keyId, user.keyId),
            eq(keyChatPermissionsTable.sessionId, sessionId)
          )
        );

      if (permissions.length === 0) return '*';
      if (permissions.some((p) => p.chatJidPattern === '*' && p.canRead)) return '*';

      return permissions.filter((p) => p.canRead).map((p) => p.chatJidPattern);
    } catch {
      return [];
    }
  }

  /**
   * Create a new API key
   */
  async createKey(params: {
    name: string;
    scopes: string[];
    sessionIds?: string[];
    rateLimitRpm?: number;
    expiresAt?: Date;
  }) {
    const { rawKey, prefix, keyHash } = generateApiKey();
    const id = `key_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const keyObj = {
      id,
      name: params.name,
      prefix,
      keyHash,
      scopes: params.scopes,
      sessionIds: params.sessionIds || ['*'],
      rateLimitRpm: params.rateLimitRpm || 60,
      expiresAt: params.expiresAt
    };

    this.memoryKeys.set(keyHash, keyObj);

    try {
      await db.insert(apiKeysTable).values(keyObj);
    } catch {}

    return {
      id,
      name: params.name,
      apiKey: rawKey, // Only returned once!
      prefix,
      scopes: params.scopes
    };
  }

  /**
   * Revoke an API key
   */
  async revokeKey(id: string) {
    for (const [hash, k] of this.memoryKeys.entries()) {
      if (k.id === id) {
        this.memoryKeys.delete(hash);
      }
    }
    try {
      await db.delete(keyChatPermissionsTable).where(eq(keyChatPermissionsTable.keyId, id));
      await db.delete(apiKeysTable).where(eq(apiKeysTable.id, id));
    } catch {
      try {
        await db.update(apiKeysTable).set({ revokedAt: new Date() }).where(eq(apiKeysTable.id, id));
      } catch {}
    }
  }

  /**
   * Assign chat permission to key
   */
  async setChatPermission(params: {
    keyId: string;
    sessionId: string;
    chatJidPattern: string;
    canRead: boolean;
    canSend: boolean;
  }) {
    const id = `perm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const permObj = {
      id,
      keyId: params.keyId,
      sessionId: params.sessionId,
      chatJidPattern: params.chatJidPattern,
      canRead: params.canRead,
      canSend: params.canSend
    };
    this.memoryPermissions.push(permObj);

    try {
      await db.insert(keyChatPermissionsTable).values(permObj);
    } catch {}
  }
}

export const authService = new AuthService();
