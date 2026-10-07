import { db, isDbAvailable } from '../../infra/db.js';
import { messagesTable, botConfigsTable } from '../../db/schema.js';
import { eq, and, desc, asc } from 'drizzle-orm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { imageService } from './image.service.js';
import { ragService } from '../rag/rag.service.js';

export interface ChatMessageContext {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface BotReplyResult {
  shouldReply: boolean;
  replyType?: 'text' | 'image';
  replyText?: string;
  mediaUrl?: string;
  handoff?: boolean;
}

export class AiBotService {
  private geminiClient: GoogleGenerativeAI | null = null;
  private groqClient: Groq | null = null;

  // Track consecutive bot replies per chat to prevent loops
  private consecutiveBotReplies = new Map<string, number>();
  // Track handoff state per chat
  private handoffChats = new Set<string>();

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
    if (env.GROQ_API_KEY) {
      this.groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
    }
  }

  /**
   * Return clean LLM-ready conversation context
   */
  async getChatContext(sessionId: string, chatJid: string, limit = 20): Promise<ChatMessageContext[]> {
    try {
      const rows = await db
        .select()
        .from(messagesTable)
        .where(and(eq(messagesTable.sessionId, sessionId), eq(messagesTable.chatJid, chatJid)))
        .orderBy(desc(messagesTable.createdAt))
        .limit(limit);

      // Reverse to chronological order
      const sorted = rows.reverse();

      return sorted.map((msg) => ({
        role: msg.direction === 'outbound' ? 'assistant' : 'user',
        content: msg.content || '',
        timestamp: msg.createdAt
      }));
    } catch {
      return [];
    }
  }

  /**
   * Process incoming message for Auto-Reply Bot with Loop Guards, Image Generation & Handoff
   */
  async handleIncomingMessage(
    sessionId: string,
    chatJid: string,
    incomingText: string
  ): Promise<BotReplyResult> {
    const chatKey = `${sessionId}:${chatJid}`;

    // 1. Loop Guard: Check human handoff state
    if (this.handoffChats.has(chatKey)) {
      const lowerText = incomingText.toLowerCase().trim();
      if (['bot', 'restart', 'hi', 'hello', 'hey', 'start', 'menu', 'help'].includes(lowerText)) {
        this.handoffChats.delete(chatKey);
        this.consecutiveBotReplies.delete(chatKey);
        logger.info({ sessionId, chatJid }, '🔄 Human handoff cleared by customer resume message');
      } else {
        logger.info({ sessionId, chatJid }, '👤 Chat in human handoff mode; bot standing by');
        return { shouldReply: false, handoff: true };
      }
    }

    // 2. Fetch bot config or use intelligent defaults
    const humanSystemPrompt = `You are a real human replying to messages on WhatsApp. You must completely pretend to be a real human chatting back.
Rules:
- Never say, imply, or admit that you are an AI, bot, assistant, language model, or virtual agent under any circumstance.
- Do NOT use any emojis whatsoever in your responses. Zero emojis.
- Speak naturally, warmly, and directly, like a real person typing a quick message on their phone.
- Keep replies brief and conversational (usually 1 to 3 short sentences).
- Never use robotic openings like "Certainly!", "I'd be glad to help you with that!", "In summary...", or "Feel free to ask...".
- If someone greets you casually ("hey", "hi", "sup", "hello"), reply like a real person ("Hey, how is it going?", "Hi there, what is on your mind?").
- If asked who you are, give a human reply: "I am part of the team handling our WhatsApp chats."
- If you don't know something, answer like a human: "I am not quite sure about that one, but I can check on it for you."
- You cannot generate or send images yourself in text. If someone asks for a picture or image, never pretend you drew or sent it, and never say "Here is the image" unless the automated image system attached one.`;

    let config = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      systemPrompt: humanSystemPrompt,
      handoffKeywords: ['talk to human', 'human agent', 'live agent', 'human support', 'transfer to human', 'real person', 'talk to person'],
      maxConsecutiveReplies: 20,
      isActive: true
    };

    if (isDbAvailable) {
      try {
        const configs = await db
          .select()
          .from(botConfigsTable)
          .where(eq(botConfigsTable.sessionId, sessionId))
          .limit(1);

        if (configs.length > 0) {
          const cfg = configs[0];
          config = {
            provider: cfg.provider || 'gemini',
            model: cfg.model || 'gemini-2.5-flash',
            systemPrompt: cfg.systemPrompt || humanSystemPrompt,
            handoffKeywords: cfg.handoffKeywords || config.handoffKeywords,
            maxConsecutiveReplies: cfg.maxConsecutiveReplies || 20,
            isActive: cfg.isActive ?? true
          };
        }
      } catch {}
    }

    if (!config.isActive) {
      return { shouldReply: false };
    }

    // 3. Loop Guard: Explicit Human Handoff Phrases Check
    const lower = incomingText.toLowerCase();
    const handoffKeywords = config.handoffKeywords;
    if (handoffKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      this.handoffChats.add(chatKey);
      logger.info({ sessionId, chatJid }, '👤 Human handoff triggered by customer phrase');
      return {
        shouldReply: true,
        replyText: "Got it, give me a quick moment and someone from our team will jump in here with you.",
        handoff: true
      };
    }

    // 4. Loop Guard: Consecutive Bot Replies Cap
    const currentConsecutive = this.consecutiveBotReplies.get(chatKey) || 0;
    if (currentConsecutive >= config.maxConsecutiveReplies) {
      logger.warn({ sessionId, chatJid, consecutive: currentConsecutive }, '🛑 Loop Guard: Consecutive bot replies cap reached');
      return { shouldReply: false };
    }

    logger.info({ sessionId, chatJid, incomingText }, '🤖 AI Bot processing incoming message');

    // 5. Image Generation Intent Check
    const imgCheck = imageService.detectImageRequest(incomingText);
    if (imgCheck.isImageRequest) {
      try {
        logger.info({ sessionId, chatJid, prompt: imgCheck.prompt }, '🎨 Processing AI image generation request');
        const imgResult = await imageService.generateImage(imgCheck.prompt);
        this.consecutiveBotReplies.set(chatKey, currentConsecutive + 1);
        return {
          shouldReply: true,
          replyType: 'image',
          mediaUrl: imgResult.imageUrl || imgResult.localPath,
          replyText: `Here is the image for "${imgResult.prompt}". Let me know what you think.`
        };
      } catch (err: any) {
        logger.error({ prompt: imgCheck.prompt, err: err?.message }, 'AI image generation error');
        return {
          shouldReply: true,
          replyType: 'text',
          replyText: `I had some trouble creating that image right now. Could you try describing it a bit differently?`
        };
      }
    }

    // 6. Get conversation history
    const context = await this.getChatContext(sessionId, chatJid, 10);

    // 7. Permission-Aware RAG Knowledge Base Retrieval
    // External WhatsApp customers only receive Level 1 (PUBLIC) knowledge chunks.
    // Confidential & restricted data (API keys, passwords, PII, source code, HR) are filtered out before prompting.
    let augmentedSystemPrompt = config.systemPrompt;
    try {
      const userAccessLevel = (config as any).userAccessLevel ?? 1; // Default to Level 1 (Public)
      const rag = await ragService.getAugmentedContext(incomingText, {
        topK: 3,
        minSimilarity: 0.50,
        userAccessLevel
      });
      if (rag.contextText) {
        logger.info({ sessionId, chatJid, userAccessLevel, matchCount: rag.matchedChunks.length }, '📚 Retrieved authorized RAG knowledge chunks');
        augmentedSystemPrompt += `\n\n--- INTERNAL KNOWLEDGE BASE CONTEXT ---\n${rag.contextText}\n--- END CONTEXT ---\nUse the relevant knowledge above when answering, but remember to stay in your natural human persona (no emojis, speak like a real human).`;
      }
    } catch (ragErr: any) {
      logger.warn({ err: ragErr?.message }, 'RAG context retrieval skipped due to error');
    }

    // 8. Generate AI Reply
    let replyText = '';
    const systemPrompt = augmentedSystemPrompt;

    // Try Gemini Free Tier
    if (config.provider === 'gemini' && this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: config.model || 'gemini-2.5-flash',
          systemInstruction: systemPrompt
        });

        // Ensure history starts with 'user' for Gemini API requirements
        let history = context.slice(0, -1).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        const firstUserIdx = history.findIndex((h) => h.role === 'user');
        if (firstUserIdx > 0) {
          history = history.slice(firstUserIdx);
        } else if (firstUserIdx === -1) {
          history = [];
        }

        const chat = model.startChat({ history });

        const result = await chat.sendMessage(incomingText);
        replyText = result.response.text();
        logger.info({ sessionId, chatJid, replyLength: replyText.length }, '🤖 Gemini generated reply successfully');
      } catch (err: any) {
        logger.warn({ err: err?.message || String(err) }, 'Gemini bot generation failed, trying Groq fallback');
      }
    }

    // Try Groq Free Tier
    if (!replyText && this.groqClient) {
      try {
        const messages: any[] = [{ role: 'system', content: systemPrompt }];
        context.forEach((m) => messages.push({ role: m.role, content: m.content }));
        messages.push({ role: 'user', content: incomingText });

        const completion = await this.groqClient.chat.completions.create({
          model: 'openai/gpt-oss-120b',
          messages
        });

        replyText = completion.choices[0]?.message?.content || '';
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Groq bot generation failed');
      }
    }

    // Fallback human-like response if no external API key configured
    if (!replyText) {
      const lowerText = incomingText.toLowerCase().trim();
      if (['hi', 'hello', 'hey', 'start'].some(g => lowerText.startsWith(g))) {
        replyText = "Hey there, good to hear from you. How can I help you today?";
      } else if (lowerText.includes('how are you')) {
        replyText = "I am doing well, thanks for asking. How are things with you?";
      } else if (lowerText.includes('thank')) {
        replyText = "Anytime, let me know if you need anything else.";
      } else {
        replyText = `Hey, got your message: "${incomingText}". What can I do for you?`;
      }
    }

    // Strip any stray emojis that LLM might output to ensure 100% compliance with no emojis rule
    replyText = replyText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '').trim();

    // Increment consecutive replies
    this.consecutiveBotReplies.set(chatKey, currentConsecutive + 1);

    return {
      shouldReply: true,
      replyText: replyText
    };
  }

  /**
   * Reset consecutive counter or reset handoff
   */
  resetHandoff(sessionId: string, chatJid: string) {
    const chatKey = `${sessionId}:${chatJid}`;
    this.handoffChats.delete(chatKey);
    this.consecutiveBotReplies.delete(chatKey);
  }
}

export const aiBotService = new AiBotService();
