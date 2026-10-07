import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';

export interface SemanticChunk {
  chunkIndex: number;
  topic: string;
  content: string;
  tokenCount: number;
}

export class SemanticChunker {
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    if (env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Approximate token count (1 token ≈ 4 characters for English text)
   */
  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Semantically chunks text into coherent topic-focused segments.
   * A new chunk is created whenever a new topic, policy, or concept arrives.
   */
  async chunk(text: string, options: { maxTokensPerChunk?: number; minTokensPerChunk?: number } = {}): Promise<SemanticChunk[]> {
    const maxTokens = options.maxTokensPerChunk || 500;
    const minTokens = options.minTokensPerChunk || 40;

    const cleanText = text.trim();
    if (!cleanText) return [];

    logger.info({ totalLength: cleanText.length }, '🧠 Starting semantic chunking pipeline');

    // 1. Try LLM-powered Semantic Boundary Detection if Gemini is configured
    if (this.geminiClient) {
      try {
        const chunks = await this.chunkWithLLM(cleanText, maxTokens);
        if (chunks.length > 0) {
          logger.info({ count: chunks.length }, '✨ Semantic chunking completed via LLM thematic boundary analysis');
          return chunks;
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'LLM semantic chunking failed, falling back to rule-based thematic segmenter');
      }
    }

    // 2. Rule-based Thematic Semantic Segmentation fallback
    return this.chunkThematically(cleanText, maxTokens, minTokens);
  }

  /**
   * High-accuracy semantic chunking using Gemini to evaluate topic boundaries
   */
  private async chunkWithLLM(text: string, maxTokens: number): Promise<SemanticChunk[]> {
    if (!this.geminiClient) return [];

    const model = this.geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are a specialist in Semantic Text Chunking for Retrieval-Augmented Generation (RAG).
Your goal is to divide the provided source document into coherent, high-quality semantic chunks based on meaning.

CRITICAL RULES:
1. Make a NEW chunk whenever a NEW topic, subject, policy, feature, or distinct concept arrives.
2. Group all related sentences of the same topic together so each chunk is self-contained.
3. Assign each chunk a concise, descriptive "topic" title (2 to 5 words).
4. Do not alter, summarize, or skip any source text. Every piece of original information must be preserved in the "content" fields.
5. Keep each chunk within approximately 50 to ${maxTokens} tokens.

Output MUST be a valid JSON array of objects strictly matching this format:
[
  {
    "topic": "Specific Topic Name",
    "content": "Full text of the chunk for this topic..."
  }
]

Source Document:
"""
${text}
"""`;

    const resp = await model.generateContent(prompt);
    const output = resp.response.text();

    const jsonMatch = output.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse JSON array from semantic chunker response');
    }

    const parsed: Array<{ topic: string; content: string }> = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Parsed semantic chunks array is empty');
    }

    return parsed.map((item, index) => ({
      chunkIndex: index,
      topic: item.topic?.trim() || `Topic ${index + 1}`,
      content: item.content?.trim() || '',
      tokenCount: this.estimateTokenCount(item.content || '')
    }));
  }

  /**
   * Algorithmic Thematic Chunker: splits by headers, paragraphs, and vocabulary shift
   */
  private chunkThematically(text: string, maxTokens: number, minTokens: number): Promise<SemanticChunk[]> {
    const rawParagraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const chunks: SemanticChunk[] = [];

    let currentTopic = 'General Overview';
    let currentContent: string[] = [];
    let currentTokens = 0;

    const topicHeaderRegex = /^(?:#+\s*|\b(?:topic|section|rule|policy|product|faq|q:)\b[:\s-]*)(.+)$/i;

    const flushChunk = () => {
      if (currentContent.length === 0) return;
      const joined = currentContent.join('\n\n').trim();
      if (joined.length > 0) {
        chunks.push({
          chunkIndex: chunks.length,
          topic: currentTopic,
          content: joined,
          tokenCount: this.estimateTokenCount(joined)
        });
      }
      currentContent = [];
      currentTokens = 0;
    };

    for (const paragraph of rawParagraphs) {
      const lines = paragraph.split('\n').map((l) => l.trim()).filter(Boolean);
      const firstLine = lines[0] || '';
      const headerMatch = firstLine.match(topicHeaderRegex);
      const isNewTopicHeader = headerMatch && headerMatch[1];
      const pTokens = this.estimateTokenCount(paragraph);

      // Detect semantic boundary:
      // A new chunk is created if:
      // 1. A new topic arrives and previous content exists, OR
      // 2. Token limit is exceeded
      if (isNewTopicHeader && currentContent.length > 0) {
        flushChunk();
        currentTopic = headerMatch[1].replace(/[*#_:]/g, '').trim();
      } else if (isNewTopicHeader && currentContent.length === 0) {
        currentTopic = headerMatch[1].replace(/[*#_:]/g, '').trim();
      } else if (currentTokens + pTokens > maxTokens && currentTokens >= minTokens) {
        flushChunk();
      }

      currentContent.push(paragraph);
      currentTokens += pTokens;
    }

    flushChunk();

    // Fallback if document had no line breaks
    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push({
        chunkIndex: 0,
        topic: 'Document Summary',
        content: text.trim(),
        tokenCount: this.estimateTokenCount(text.trim())
      });
    }

    return Promise.resolve(chunks);
  }
}

export const semanticChunker = new SemanticChunker();
