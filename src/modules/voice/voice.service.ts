import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { env } from '../../config/env.js';
import { erpCatalog } from '../erp/catalog.js';
import { db } from '../../infra/db.js';
import { voiceAuditLogsTable } from '../../db/schema.js';
import { logger } from '../../infra/logger.js';
import { voiceQueryDurationHistogram } from '../../infra/metrics.js';
import { imageService } from '../ai/image.service.js';
import { aiBotService } from '../ai/bot.service.js';
import { securityGuard } from '../../infra/security-guard.js';
import crypto from 'crypto';

export interface VoiceProcessResult {
  type: 'text' | 'image';
  content: string;
  mediaUrl?: string;
  transcript: string;
}

export class VoiceQueryService {
  private geminiClient: GoogleGenerativeAI | null = null;
  private groqClient: Groq | null = null;

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
    if (env.GROQ_API_KEY) {
      this.groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
    }
  }

  /**
   * Transcribe audio buffer using Groq Whisper (free) or faster-whisper sidecar or Gemini
   */
  async transcribeAudio(audioBuffer: Buffer, mimetype = 'audio/ogg'): Promise<string> {
    // 1. Try Groq Whisper API (free 7000 audio seconds/day)
    if (this.groqClient) {
      try {
        const file = new File([new Uint8Array(audioBuffer)], 'voice.ogg', { type: mimetype });
        const transcription = await this.groqClient.audio.transcriptions.create({
          file: file as any,
          model: 'whisper-large-v3'
        });
        if (transcription?.text) {
          logger.info({ transcript: transcription.text }, 'Transcribed via Groq Whisper');
          return transcription.text.trim();
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Groq Whisper transcription failed, attempting fallback');
      }
    }

    // 2. Try self-hosted faster-whisper sidecar
    if (env.WHISPER_URL) {
      try {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimetype });
        formData.append('file', blob, 'voice.ogg');
        formData.append('model', 'small');

        const res = await fetch(env.WHISPER_URL, {
          method: 'POST',
          body: formData
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data?.text) {
            return data.text.trim();
          }
        }
      } catch (err: any) {
        logger.debug({ err: err.message }, 'faster-whisper sidecar not reachable');
      }
    }

    // 3. Try Gemini Free Multimodal Audio
    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: mimetype,
              data: audioBuffer.toString('base64')
            }
          },
          'Transcribe the exact spoken words in this audio. Return only the transcript, nothing else.'
        ]);
        const text = result.response.text();
        if (text) return text.trim();
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Gemini audio transcription failed');
      }
    }

    throw new Error('No available STT provider (configure GEMINI_API_KEY, GROQ_API_KEY, or faster-whisper sidecar)');
  }

  /**
   * Parse transcript into an ERP tool call with strict security sanitization
   */
  async parseIntent(transcript: string): Promise<{ toolName: string; parameters: any }> {
    // 1. Security check: detect any attempt at command execution or script injection
    const threat = securityGuard.detectThreat(transcript);
    if (threat.isThreat) {
      logger.warn({ reason: threat.reason, snippet: transcript.slice(0, 50) }, '🚨 Malicious pattern intercepted in voice query');
      return { toolName: 'get_stock', parameters: { item: 'security_blocked' } };
    }

    // 2. Sanitize transcript
    const sanitizedTranscript = securityGuard.sanitizeText(transcript, 150);
    const lower = sanitizedTranscript.toLowerCase();

    // Fast-path rule matching for common phrases
    if (lower.includes('sales') || lower.includes('revenue') || lower.includes('sold today')) {
      let range = 'today';
      if (lower.includes('yesterday')) range = 'yesterday';
      else if (lower.includes('week')) range = 'this_week';
      else if (lower.includes('month')) range = 'this_month';
      else if (lower.includes('all time') || lower.includes('total')) range = 'all';
      return { toolName: 'get_sales_total', parameters: { date_range: range } };
    }

    if (lower.includes('top') && (lower.includes('product') || lower.includes('item') || lower.includes('best'))) {
      return { toolName: 'get_top_products', parameters: { limit: 3 } };
    }

    if (lower.includes('stock') || lower.includes('many') || lower.includes('inventory') || lower.includes('price')) {
      // Extract item name safely
      let item = sanitizedTranscript
        .replace(/\b(how many|units of|units|items of|items|do we have|in stock|stock|what is the price of|price of|check|are|is|the|we|do|have|in|left)\b/gi, '')
        .replace(/[?.,!]/g, '')
        .trim();
      item = securityGuard.sanitizeSearchTerm(item, 50);
      if (!item) item = 'MacBook';
      return { toolName: 'get_stock', parameters: { item } };
    }

    // Fallback to Gemini if configured with strict security instructions
    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: 'gemini-2.5-flash',
          systemInstruction: 'You are a read-only ERP query classifier. You NEVER generate or execute code, shell commands, scripts, or arbitrary SQL. You only map user inquiries to one of the 3 allowed tools.'
        });
        const prompt = `Available read-only tools:
1. get_stock(item: string)
2. get_sales_total(date_range: "today" | "yesterday" | "this_week" | "this_month" | "all")
3. get_top_products(limit: number)

User inquiry: "${sanitizedTranscript}"
Return strictly valid JSON: {"toolName": "...", "parameters": {...}}`;

        const resp = await model.generateContent(prompt);
        const text = resp.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const allowedTools = ['get_stock', 'get_sales_total', 'get_top_products'];
          if (allowedTools.includes(parsed.toolName)) {
            // Sanitize parameters returned by LLM
            if (parsed.toolName === 'get_stock') {
              parsed.parameters = { item: securityGuard.sanitizeSearchTerm(parsed.parameters?.item || '', 50) };
            } else if (parsed.toolName === 'get_top_products') {
              parsed.parameters = { limit: securityGuard.clampLimit(parsed.parameters?.limit, 1, 10, 3) };
            }
            return parsed;
          }
        }
      } catch {}
    }

    // Default to sanitized stock search
    const safeItem = securityGuard.sanitizeSearchTerm(sanitizedTranscript, 50) || 'MacBook';
    return { toolName: 'get_stock', parameters: { item: safeItem } };
  }

  /**
   * Full pipeline: Audio Buffer -> Transcribe -> Intent (Image Gen / ERP / AI Chat) -> Dispatch
   */
  async processVoiceNote(params: {
    sessionId: string;
    chatJid: string;
    senderJid: string;
    audioBuffer: Buffer;
    audioUrl?: string;
  }): Promise<VoiceProcessResult> {
    const startTime = Date.now();
    const timer = voiceQueryDurationHistogram.startTimer();

    try {
      // 1. STT
      const transcript = await this.transcribeAudio(params.audioBuffer);
      logger.info({ senderJid: params.senderJid, transcript }, '🎙️ Voice query transcribed');

      if (!transcript || transcript.trim().length === 0) {
        timer();
        return {
          type: 'text',
          content: "Sorry, I could not quite catch that audio. Could you try sending it again or typing it out?",
          transcript: ''
        };
      }

      // 2. Check if voice requested an image generation
      const imgCheck = imageService.detectImageRequest(transcript);
      if (imgCheck.isImageRequest) {
        logger.info({ senderJid: params.senderJid, prompt: imgCheck.prompt }, 'Voice note requested AI image generation');
        const img = await imageService.generateImage(imgCheck.prompt);
        const replyText = `Here is the image for "${imgCheck.prompt}". Let me know what you think.`;

        // Audit log
        try {
          await db.insert(voiceAuditLogsTable).values({
            id: `val_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            sessionId: params.sessionId,
            senderJid: params.senderJid,
            audioUrl: params.audioUrl,
            transcript,
            detectedIntent: 'image_generation',
            parameters: { prompt: imgCheck.prompt },
            answer: replyText,
            latencyMs: Date.now() - startTime
          });
        } catch {}

        timer();
        return {
          type: 'image',
          content: replyText,
          mediaUrl: img.localPath || img.imageUrl,
          transcript
        };
      }

      // 3. Intent Parsing: check for ERP queries
      const lower = transcript.toLowerCase();
      const isErpQuery = ['sales', 'revenue', 'sold', 'stock', 'inventory', 'price', 'top product', 'best item'].some((k) => lower.includes(k));

      if (isErpQuery) {
        const { toolName, parameters } = await this.parseIntent(transcript);
        const tool = erpCatalog[toolName] || erpCatalog.get_stock;
        const result = await tool.execute(parameters);
        const latencyMs = Date.now() - startTime;
        const replyText = result.message.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '').trim();

        try {
          await db.insert(voiceAuditLogsTable).values({
            id: `val_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            sessionId: params.sessionId,
            senderJid: params.senderJid,
            audioUrl: params.audioUrl,
            transcript,
            detectedIntent: toolName,
            parameters,
            querySql: result.querySql,
            answer: replyText,
            latencyMs
          });
        } catch (err: any) {
          logger.debug({ err: err.message }, 'Failed to write voice audit log');
        }

        timer();
        return {
          type: 'text',
          content: replyText,
          transcript
        };
      }

      // 4. Conversational Voice Query -> AI Bot
      const botResult = await aiBotService.handleIncomingMessage(params.sessionId, params.chatJid, transcript);
      const latencyMs = Date.now() - startTime;
      let replyText = botResult.replyText || "Hey, got your voice note. What can I help you with today?";
      replyText = replyText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '').trim();

      try {
        await db.insert(voiceAuditLogsTable).values({
          id: `val_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          sessionId: params.sessionId,
          senderJid: params.senderJid,
          audioUrl: params.audioUrl,
          transcript,
          detectedIntent: 'ai_chat',
          parameters: { query: transcript },
          answer: replyText,
          latencyMs
        });
      } catch {}

      timer();
      return {
        type: botResult.replyType || 'text',
        content: replyText,
        mediaUrl: botResult.mediaUrl,
        transcript
      };
    } catch (err: any) {
      timer();
      logger.error({ err: err.message }, 'Error in voice processing pipeline');
      return {
        type: 'text',
        content: `⚠️ Sorry, I could not process your voice query: ${err.message}`,
        transcript: ''
      };
    }
  }
}

export const voiceQueryService = new VoiceQueryService();
