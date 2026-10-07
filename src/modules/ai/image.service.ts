import fs from 'fs';
import path from 'path';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { r2Storage } from '../../infra/r2.js';

export interface ImageGenResult {
  imageUrl: string;
  model: string;
  prompt: string;
  localPath?: string;
  base64Data?: string;
}

export class ImageService {
  /**
   * Command prefixes that trigger image generation
   */
  private triggerPrefixes = [
    '/image',
    '/img',
    '/draw',
    '/paint',
    '/generate',
    '!image',
    '!draw',
    '#image'
  ];

  /**
   * Flexible regex patterns for natural conversational phrasing
   */
  private naturalPatterns = [
    /(?:generate|create|make|draw|paint|render)\s+(?:an?\s+)?(?:image|photo|picture|pic|painting|portrait|wallpaper)\s+(?:of|showing|about|with|for)\s+(.+)/i,
    /(?:draw|paint|sketch)\s+(?:me\s+)?(?:an?\s+)?(.+)/i,
    /(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:send|give)\s+(?:me\s+)?(?:an?\s+)?(?:image|photo|picture|pic)\s+(?:of|showing|with|for)\s+(.+)/i,
    /(?:i\s+want|i\s+need)\s+(?:an?\s+)?(?:image|photo|picture)\s+(?:of|showing|with|for)\s+(.+)/i,
    /^(?:an?\s+)?(?:image|photo|picture)\s+(?:of|showing)\s+(.+)/i
  ];

  /**
   * Detects whether an incoming message is an image request,
   * cleaning conversational fillers (e.g. "hey", "can you", "please").
   */
  detectImageRequest(text: string): { isImageRequest: boolean; prompt: string } {
    if (!text || typeof text !== 'string') {
      return { isImageRequest: false, prompt: '' };
    }

    let trimmed = text.trim();

    // 1. Check explicit prefixes
    for (const prefix of this.triggerPrefixes) {
      if (trimmed.toLowerCase().startsWith(prefix)) {
        const prompt = trimmed.slice(prefix.length).replace(/^[:\s]+/, '').trim();
        if (prompt.length > 0) {
          return { isImageRequest: true, prompt: this.cleanPrompt(prompt) };
        }
      }
    }

    // 2. Normalize conversational fillers at start (e.g. "hey", "hello", "bro")
    const normalized = trimmed.replace(/^(?:hey|hi|hello|yo|bro|buddy|bot|please|ok|okay)[\s,]+/i, '');

    // 3. Match against flexible natural language patterns
    for (const pattern of this.naturalPatterns) {
      const match = normalized.match(pattern);
      if (match && match[1] && match[1].trim().length > 2) {
        return { isImageRequest: true, prompt: this.cleanPrompt(match[1].trim()) };
      }
    }

    return { isImageRequest: false, prompt: '' };
  }

  private cleanPrompt(prompt: string): string {
    return prompt
      .replace(/[\r\n]+/g, ' ')
      .replace(/(?:please|thanks|thank\s+you)[.?!]*$/i, '')
      .replace(/[.?!]+$/, '')
      .trim();
  }

  /**
   * Generates an image using multi-provider resilience:
   * 1. Hugging Face Serverless Inference (FLUX.1-schnell / SDXL) if HUGGINGFACE_API_KEY is configured.
   * 2. Pollinations.ai with POLLINATIONS_API_KEY (Bearer token).
   * 3. Pollinations.ai anonymous fallback.
   */
  async generateImage(prompt: string): Promise<ImageGenResult> {
    const cleanPrompt = this.cleanPrompt(prompt);
    logger.info({ prompt: cleanPrompt }, '🎨 Starting AI image generation pipeline');

    // Attempt 1: Hugging Face Serverless Inference (Free, high-fidelity)
    if (env.HUGGINGFACE_API_KEY) {
      try {
        const hfResult = await this.generateViaHuggingFace(cleanPrompt);
        if (hfResult) return hfResult;
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Hugging Face image generation failed, trying Pollinations');
      }
    }

    // Attempt 2: Pollinations.ai with optional API key
    try {
      return await this.generateViaPollinations(cleanPrompt);
    } catch (pollErr: any) {
      logger.error({ err: pollErr?.message }, 'Pollinations image generation failed');
      throw new Error(
        `AI image generation requires a free API key. Add POLLINATIONS_API_KEY (from enter.pollinations.ai) or HUGGINGFACE_API_KEY (from huggingface.co/settings/tokens) to your .env file.`
      );
    }
  }

  /**
   * Generate via Hugging Face Serverless Inference
   */
  private async generateViaHuggingFace(prompt: string): Promise<ImageGenResult> {
    const model = 'black-forest-labs/FLUX.1-schnell';
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: prompt })
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 403 && errText.includes('Inference Providers')) {
        throw new Error(
          `Your Hugging Face token is missing inference permissions. Go to https://huggingface.co/settings/tokens, click your token, and check the permission: "Make calls to the serverless Inference API".`
        );
      }
      throw new Error(`Hugging Face API returned HTTP ${res.status}: ${errText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const savedPath = this.saveBufferToDisk(buffer);
    const base64Data = buffer.toString('base64');

    // Upload to Cloudflare R2 (with local disk fallback)
    const uploadedUrl = await r2Storage.uploadMedia({
      buffer,
      filename: `flux_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      folder: 'ai-images'
    });

    logger.info({ prompt, sizeBytes: buffer.length, uploadedUrl }, '✨ AI image generated via Hugging Face FLUX.1');
    return {
      imageUrl: uploadedUrl || `data:image/jpeg;base64,${base64Data}`,
      model: 'HuggingFace FLUX.1-schnell',
      prompt,
      localPath: savedPath,
      base64Data
    };
  }

  /**
   * Generate via Pollinations.ai
   */
  private async generateViaPollinations(prompt: string): Promise<ImageGenResult> {
    const seed = Math.floor(Math.random() * 1000000);
    const encoded = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=800&height=800&nologo=true&seed=${seed}`;

    const headers: Record<string, string> = {
      'User-Agent': 'WhatsApp-API-Gateway/1.0'
    };

    if (env.POLLINATIONS_API_KEY) {
      headers['Authorization'] = `Bearer ${env.POLLINATIONS_API_KEY}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Pollinations HTTP ${res.status}: ${errBody}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      throw new Error('Image response is empty or invalid');
    }

    const savedPath = this.saveBufferToDisk(buffer);
    const base64Data = buffer.toString('base64');

    // Upload to Cloudflare R2 (with local disk fallback)
    const uploadedUrl = await r2Storage.uploadMedia({
      buffer,
      filename: `poll_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      folder: 'ai-images'
    });

    return {
      imageUrl: uploadedUrl || url,
      model: 'Pollinations.ai',
      prompt,
      localPath: savedPath,
      base64Data
    };
  }

  private saveBufferToDisk(buffer: Buffer): string | undefined {
    try {
      const mediaDir = env.MEDIA_STORAGE_PATH || './data/media';
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }
      const filename = `gen_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`;
      const filePath = path.join(mediaDir, filename);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch {
      return undefined;
    }
  }
}

export const imageService = new ImageService();
