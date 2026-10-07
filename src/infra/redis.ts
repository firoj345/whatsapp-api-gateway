import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let redisClient: Redis | null = null;
let isRedisAvailable = false;
let hasLoggedStatus = false;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 2000,
      retryStrategy(times) {
        if (times >= 1) {
          if (!hasLoggedStatus) {
            hasLoggedStatus = true;
            logger.info('ℹ️ Redis offline locally. Gateway operating in standalone in-memory queue & rate-limiting mode.');
          }
          return null; // Stop retrying immediately to keep terminal clean
        }
        return null;
      }
    });

    redisClient.on('connect', () => {
      isRedisAvailable = true;
      hasLoggedStatus = true;
      logger.info('Connected to Redis at %s', env.REDIS_URL);
    });

    redisClient.on('error', () => {
      isRedisAvailable = false;
      if (!hasLoggedStatus) {
        hasLoggedStatus = true;
        logger.info('ℹ️ Redis offline locally. Gateway operating in standalone in-memory queue & rate-limiting mode.');
      }
    });
  }

  return redisClient;
}

export function isRedisConnected(): boolean {
  return isRedisAvailable && redisClient?.status === 'ready';
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => { });
    redisClient = null;
    isRedisAvailable = false;
  }
}
