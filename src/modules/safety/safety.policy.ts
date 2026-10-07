import { IMessageProvider } from '../messages/provider.interface.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { getRedisClient, isRedisConnected } from '../../infra/redis.js';

export interface SafetyConfig {
  typingSpeedMsPerChar?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  maxPerMinute?: number;
  maxPerHour?: number;
  maxPerDay?: number;
  warmupMode?: boolean;
  warmupDay?: number; // Day 1: 50 msgs, Day 2: 100 msgs, etc.
  blastThreshold?: number; // Max messages allowed in a single broadcast batch
  replyOnlyMode?: boolean; // Only message recipients who previously engaged
}

export class SafetyPolicy {
  // In-memory rate trackers if Redis is not available
  private memoryRateStore = new Map<string, number[]>();
  private circuitBreakers = new Map<string, { consecutiveErrors: number; pausedUntil: number }>();
  private recentMessages = new Map<string, { content: string; timestamp: number }>();

  /**
   * Calculate typing simulation duration based on text length with randomized jitter
   */
  calculateTypingDelay(text: string, speedMsPerChar = env.TYPING_SPEED_MS_PER_CHAR): number {
    const baseDuration = (text?.length || 10) * speedMsPerChar;
    const jitterFactor = 0.8 + Math.random() * 0.4; // ±20% jitter
    const calculated = baseDuration * jitterFactor;
    // Clamp between 1000ms (1s) and 8000ms (8s)
    return Math.floor(Math.min(8000, Math.max(1000, calculated)));
  }

  /**
   * Calculate random pause between messages (e.g., 2000ms - 5000ms)
   */
  calculatePacingDelay(min = env.MIN_DELAY_BETWEEN_MESSAGES_MS, max = env.MAX_DELAY_BETWEEN_MESSAGES_MS): number {
    return Math.floor(min + Math.random() * (max - min));
  }

  /**
   * Check Circuit Breaker for session
   */
  isCircuitBreakerOpen(sessionId: string): boolean {
    const breaker = this.circuitBreakers.get(sessionId);
    if (!breaker) return false;
    if (Date.now() < breaker.pausedUntil) return true;
    // Window passed, reset
    this.circuitBreakers.delete(sessionId);
    return false;
  }

  recordFailure(sessionId: string) {
    const breaker = this.circuitBreakers.get(sessionId) || { consecutiveErrors: 0, pausedUntil: 0 };
    breaker.consecutiveErrors += 1;
    if (breaker.consecutiveErrors >= 5) {
      // Pause session sends for 60 seconds
      breaker.pausedUntil = Date.now() + 60000;
      logger.warn({ sessionId, pausedUntil: breaker.pausedUntil }, '🚨 Circuit Breaker tripped: Session sends paused for 60s');
    }
    this.circuitBreakers.set(sessionId, breaker);
  }

  recordSuccess(sessionId: string) {
    this.circuitBreakers.delete(sessionId);
  }

  /**
   * Enforce rate caps (minute, hour, day, warm-up)
   */
  async checkRateLimits(sessionId: string, recipientJid: string, config?: SafetyConfig): Promise<{ allowed: boolean; reason?: string }> {
    const maxPerMinute = config?.maxPerMinute ?? env.MAX_MESSAGES_PER_MINUTE;
    let maxPerDay = config?.maxPerDay ?? env.MAX_MESSAGES_PER_DAY;

    // Warm-up mode adjustment
    if (config?.warmupMode ?? env.WARMUP_MODE_ENABLED) {
      const day = config?.warmupDay || 1;
      maxPerDay = Math.min(maxPerDay, day * 50); // Day 1: 50, Day 2: 100, etc.
    }

    const now = Date.now();
    const redis = getRedisClient();

    if (isRedisConnected()) {
      try {
        const minKey = `ratelimit:session:${sessionId}:min:${Math.floor(now / 60000)}`;
        const dayKey = `ratelimit:session:${sessionId}:day:${new Date().toISOString().slice(0, 10)}`;
        const recKey = `ratelimit:rec:${sessionId}:${recipientJid}:min:${Math.floor(now / 60000)}`;

        const [minCount, dayCount, recCount] = await Promise.all([
          redis.incr(minKey),
          redis.incr(dayKey),
          redis.incr(recKey)
        ]);

        if (minCount === 1) await redis.expire(minKey, 65);
        if (dayCount === 1) await redis.expire(dayKey, 86400);
        if (recCount === 1) await redis.expire(recKey, 65);

        if (minCount > maxPerMinute) {
          return { allowed: false, reason: `Session rate limit exceeded (${minCount}/${maxPerMinute} per min)` };
        }
        if (dayCount > maxPerDay) {
          return { allowed: false, reason: `Session daily cap reached (${dayCount}/${maxPerDay} msgs/day)` };
        }
        if (recCount > 10) {
          return { allowed: false, reason: `Recipient anti-spam limit reached (${recCount}/10 per min to ${recipientJid})` };
        }

        return { allowed: true };
      } catch (err) {
        logger.debug('Redis rate limit check error, falling back to memory');
      }
    }

    // In-memory rate limiting fallback
    const key = `${sessionId}:${recipientJid}`;
    let timestamps = this.memoryRateStore.get(key) || [];
    timestamps = timestamps.filter(t => now - t < 60000); // Last 60s
    if (timestamps.length >= maxPerMinute) {
      return { allowed: false, reason: `Rate limit exceeded (minute cap: ${maxPerMinute})` };
    }
    timestamps.push(now);
    this.memoryRateStore.set(key, timestamps);

    return { allowed: true };
  }

  /**
   * Duplicate / Content Hygiene Check
   */
  checkContentHygiene(sessionId: string, text: string): { isDuplicate: boolean } {
    const recent = this.recentMessages.get(sessionId);
    const now = Date.now();
    if (recent && recent.content === text && (now - recent.timestamp < 3000)) {
      return { isDuplicate: true };
    }
    this.recentMessages.set(sessionId, { content: text, timestamp: now });
    return { isDuplicate: false };
  }

  /**
   * Execute human-like sending behavior with typing simulation and natural pause
   */
  async executeSendWithSafety<T>(
    provider: IMessageProvider,
    recipientJid: string,
    messageType: 'text' | 'image' | 'voice' | 'document' | 'reaction',
    contentOrText: string,
    sendAction: () => Promise<T>,
    config?: SafetyConfig
  ): Promise<T> {
    const sessionId = provider.sessionId;

    // 1. Check Circuit Breaker
    if (this.isCircuitBreakerOpen(sessionId)) {
      throw new Error(`Circuit breaker active for session ${sessionId}. Sending temporarily suspended.`);
    }

    // 2. Validate WhatsApp number presence (skip for groups and WhatsApp Linked Identities @lid)
    if (!recipientJid.includes('@g.us') && !recipientJid.includes('@lid')) {
      const existsResult = await provider.checkNumber(recipientJid);
      if (!existsResult.exists) {
        throw new Error(`Recipient ${recipientJid} is not registered on WhatsApp. Blocked to prevent account flag.`);
      }
    }

    // 3. Rate Limit Check
    const rateCheck = await this.checkRateLimits(sessionId, recipientJid, config);
    if (!rateCheck.allowed) {
      throw new Error(`Anti-Ban Pacing: ${rateCheck.reason}`);
    }

    // 4. Content hygiene
    if (messageType === 'text') {
      const hygiene = this.checkContentHygiene(sessionId, contentOrText);
      if (hygiene.isDuplicate) {
        logger.warn({ sessionId, recipientJid }, 'Duplicate text detected within 3s window');
      }
    }

    // 5. Typing Simulation
    try {
      if (messageType === 'voice') {
        await provider.setPresence(recipientJid, 'recording');
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        await provider.setPresence(recipientJid, 'composing');
        const typingDelay = this.calculateTypingDelay(contentOrText, config?.typingSpeedMsPerChar);
        logger.debug({ recipientJid, typingDelay }, 'Simulating human typing delay');
        await new Promise((r) => setTimeout(r, typingDelay));
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, 'Failed to simulate presence, proceeding with send');
    }

    // 6. Execute message send
    try {
      const result = await sendAction();
      this.recordSuccess(sessionId);

      // Stop composing
      await provider.setPresence(recipientJid, 'paused').catch(() => {});

      // 7. Apply random pacing gap for outgoing queue worker
      const pacingGap = this.calculatePacingDelay(config?.minDelayMs, config?.maxDelayMs);
      await new Promise((r) => setTimeout(r, pacingGap));

      return result;
    } catch (err: any) {
      this.recordFailure(sessionId);
      throw err;
    }
  }
}

export const safetyPolicy = new SafetyPolicy();
