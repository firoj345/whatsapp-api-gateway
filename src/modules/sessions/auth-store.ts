import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { db, isDbAvailable } from '../../infra/db.js';
import { baileysAuthTable } from '../../db/schema.js';
import { encryptData, decryptData } from '../../infra/crypto.js';
import { logger } from '../../infra/logger.js';
import { eq, and, inArray } from 'drizzle-orm';
import { env } from '../../config/env.js';

/**
 * Creates an encrypted authentication state store for Baileys.
 * Primary storage: PostgreSQL (AES-256-GCM encrypted)
 * Secondary fallback: Encrypted local disk storage if DB is not reachable
 */
export async function usePostgresAuthState(sessionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Local fallback directory
  const localDir = path.join(env.SESSION_STORAGE_PATH, sessionId);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  // Load or initialize creds
  let creds: AuthenticationCreds = initAuthCreds();

  if (isDbAvailable) {
    try {
      const credRow = await db
        .select()
        .from(baileysAuthTable)
        .where(and(eq(baileysAuthTable.sessionId, sessionId), eq(baileysAuthTable.dataType, 'creds'), eq(baileysAuthTable.keyId, 'creds')))
        .limit(1);

      if (credRow.length > 0 && credRow[0].encryptedValue) {
        const decrypted = decryptData(credRow[0].encryptedValue);
        creds = JSON.parse(decrypted, BufferJSON.reviver);
      }
    } catch {}
  } else {
    // Read from local encrypted disk directly
    const localCredsPath = path.join(localDir, 'creds.enc');
    if (fs.existsSync(localCredsPath)) {
      try {
        const encrypted = fs.readFileSync(localCredsPath, 'utf8');
        creds = JSON.parse(decryptData(encrypted), BufferJSON.reviver);
      } catch {
        creds = initAuthCreds();
      }
    }
  }

  // Save creds helper
  const saveCreds = async () => {
    const serialized = JSON.stringify(creds, BufferJSON.replacer);
    const encrypted = encryptData(serialized);

    // Save to PostgreSQL if available
    if (isDbAvailable) {
      try {
        await db
          .insert(baileysAuthTable)
          .values({
            id: `${sessionId}:creds:creds`,
            sessionId,
            dataType: 'creds',
            keyId: 'creds',
            encryptedValue: encrypted,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: baileysAuthTable.id,
            set: {
              encryptedValue: encrypted,
              updatedAt: new Date()
            }
          });
      } catch {}
    }

    // Always mirror to encrypted local disk for persistence
    try {
      fs.writeFileSync(path.join(localDir, 'creds.enc'), encrypted, 'utf8');
    } catch {}
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [key: string]: any } = {};
          const missingIds: string[] = [];
          const sanitizeId = (id: string) => id.replace(/\//g, '__').replace(/:/g, '-');

          // 1. Ultra-fast local disk read (0.05ms)
          for (const id of ids) {
            const filePath = path.join(localDir, `${type}-${sanitizeId(id)}.enc`);
            if (fs.existsSync(filePath)) {
              try {
                const enc = fs.readFileSync(filePath, 'utf8');
                let value = JSON.parse(decryptData(enc), BufferJSON.reviver);
                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }
                data[id] = value;
              } catch {
                missingIds.push(id);
              }
            } else {
              missingIds.push(id);
            }
          }

          // 2. Fetch any missing IDs in a SINGLE batch query to DB
          if (missingIds.length > 0 && isDbAvailable) {
            try {
              const rows = await db
                .select()
                .from(baileysAuthTable)
                .where(
                  and(
                    eq(baileysAuthTable.sessionId, sessionId),
                    eq(baileysAuthTable.dataType, type),
                    inArray(baileysAuthTable.keyId, missingIds)
                  )
                );

              for (const row of rows) {
                try {
                  const decrypted = decryptData(row.encryptedValue);
                  let value = JSON.parse(decrypted, BufferJSON.reviver);
                  if (type === 'app-state-sync-key' && value) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                  }
                  data[row.keyId] = value;
                  // Cache back to local disk for future instant access
                  try {
                    fs.writeFileSync(path.join(localDir, `${type}-${sanitizeId(row.keyId)}.enc`), row.encryptedValue, 'utf8');
                  } catch {}
                } catch {}
              }
            } catch {}
          }

          return data;
        },
        set: async (data) => {
          const dataRecord = data as Record<string, any>;
          const tasks: Promise<any>[] = [];
          const sanitizeId = (id: string) => id.replace(/\//g, '__').replace(/:/g, '-');

          for (const category in dataRecord) {
            for (const id in dataRecord[category]) {
              const value = dataRecord[category][id];
              const compositeId = `${sessionId}:${category}:${id}`;
              const filePath = path.join(localDir, `${category}-${sanitizeId(id)}.enc`);

              if (value) {
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                const encrypted = encryptData(serialized);

                // Write to local disk immediately (synchronous, 0.05ms)
                try {
                  fs.writeFileSync(filePath, encrypted, 'utf8');
                } catch {}

                if (isDbAvailable) {
                  tasks.push(
                    db
                      .insert(baileysAuthTable)
                      .values({
                        id: compositeId,
                        sessionId,
                        dataType: category,
                        keyId: id,
                        encryptedValue: encrypted,
                        updatedAt: new Date()
                      })
                      .onConflictDoUpdate({
                        target: baileysAuthTable.id,
                        set: {
                          encryptedValue: encrypted,
                          updatedAt: new Date()
                        }
                      })
                      .catch(() => {})
                  );
                }
              } else {
                // Delete key from local disk
                if (fs.existsSync(filePath)) {
                  try {
                    fs.unlinkSync(filePath);
                  } catch {}
                }

                if (isDbAvailable) {
                  tasks.push(
                    db
                      .delete(baileysAuthTable)
                      .where(eq(baileysAuthTable.id, compositeId))
                      .catch(() => {})
                  );
                }
              }
            }
          }

          // Execute remote DB sync in background so Signal ratchet queue is never blocked
          if (tasks.length > 0) {
            Promise.all(tasks).catch(() => {});
          }
        }
      }
    },
    saveCreds
  };
}

/**
 * Remove all stored authentication data for a logged out session
 */
export async function clearPostgresAuthState(sessionId: string): Promise<void> {
  if (isDbAvailable) {
    try {
      await db.delete(baileysAuthTable).where(eq(baileysAuthTable.sessionId, sessionId));
    } catch {}
  }

  const localDir = path.join(env.SESSION_STORAGE_PATH, sessionId);
  if (fs.existsSync(localDir)) {
    try {
      fs.rmSync(localDir, { recursive: true, force: true });
    } catch {}
  }
}
