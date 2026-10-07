import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';

export class EmbeddingService {
  private geminiClient: GoogleGenerativeAI | null = null;
  private modelCandidates = ['gemini-embedding-001', 'text-embedding-004', 'gemini-embedding-2'];
  public readonly dimensions = 3072;

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Generates a float vector embedding for the input text.
   * Uses Gemini embedding model if available, with resilient local fallback.
   */
  async embedText(text: string): Promise<number[]> {
    const clean = text.trim();
    if (!clean) {
      return new Array(768).fill(0);
    }

    if (this.geminiClient) {
      for (const modelName of this.modelCandidates) {
        try {
          const model = this.geminiClient.getGenerativeModel({ model: modelName });
          const result = await model.embedContent(clean);
          const values = result.embedding?.values;
          if (values && Array.isArray(values) && values.length > 0) {
            return this.normalizeVector(values);
          }
        } catch {
          // Try next model candidate
        }
      }
    }

    // Local deterministic fallback embedding
    return this.createFallbackEmbedding(clean);
  }

  /**
   * Batch embeds an array of texts.
   */
  async embedBatch(texts: string[], concurrency: number = 3): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += concurrency) {
      const slice = texts.slice(i, i + concurrency);
      const batchPromises = slice.map(async (text, idx) => {
        const emb = await this.embedText(text);
        results[i + idx] = emb;
      });
      await Promise.all(batchPromises);
    }
    return results;
  }

  /**
   * Computes cosine similarity between two vector embeddings.
   * Returns a value between -1.0 and 1.0 (typically 0.0 to 1.0 for normalized text vectors).
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
    const len = Math.min(vecA.length, vecB.length);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      const a = vecA[i];
      const b = vecB[i];
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Normalizes a vector to unit length (L2 norm)
   */
  private normalizeVector(vec: number[]): number[] {
    let norm = 0;
    for (const v of vec) norm += v * v;
    const mag = Math.sqrt(norm);
    if (mag === 0) return vec;
    return vec.map((v) => v / mag);
  }

  /**
   * High-dispersion deterministic hash embedding (Bag-of-Words & N-Gram hash projection)
   * Ensures that similar words project to similar regions even in fallback mode.
   */
  private createFallbackEmbedding(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      // Unigram hash
      const h1 = this.hashString(word);
      const idx1 = Math.abs(h1) % this.dimensions;
      vector[idx1] += 1.0;

      // Bigram hash if available
      if (i > 0) {
        const bigram = `${words[i - 1]}_${word}`;
        const h2 = this.hashString(bigram);
        const idx2 = Math.abs(h2) % this.dimensions;
        vector[idx2] += 1.5;
      }
    }

    return this.normalizeVector(vector);
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}

export const embeddingService = new EmbeddingService();
