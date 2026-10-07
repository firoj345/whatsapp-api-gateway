import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import * as schema from '../db/schema.js';
import { logger } from './logger.js';

let queryClient: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
export let isDbAvailable = false;

export function getDb() {
  if (!dbInstance) {
    try {
      const isSsl = env.DATABASE_URL.includes('sslmode=require') || env.DATABASE_URL.includes('neon.tech');
      queryClient = postgres(env.DATABASE_URL, {
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: isSsl ? 'require' : undefined,
        onnotice: () => {}
      });
      dbInstance = drizzle(queryClient, { schema });
    } catch (err: any) {
      isDbAvailable = false;
    }
  }
  return dbInstance!;
}

export async function checkDbConnection(): Promise<boolean> {
  if (!queryClient) {
    getDb();
  }
  try {
    if (queryClient) {
      await queryClient`SELECT 1;`;
      isDbAvailable = true;
      logger.info('📦 Connected to PostgreSQL database');
      return true;
    }
  } catch {
    isDbAvailable = false;
    logger.info('ℹ️ PostgreSQL offline locally. Gateway operating with encrypted local disk storage & memory state.');
  }
  return false;
}

export async function closeDb() {
  if (queryClient) {
    await queryClient.end().catch(() => {});
    queryClient = null;
    dbInstance = null;
    isDbAvailable = false;
  }
}

export const db = getDb();
