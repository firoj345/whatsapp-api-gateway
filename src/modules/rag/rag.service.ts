import crypto from 'crypto';
import { semanticChunker, SemanticChunk } from './semantic-chunker.js';
import { embeddingService } from './embedding.service.js';
import { vectorStore, StoredDocument, StoredChunk, SearchResult } from './vector-store.js';
import { accessClassifier, AccessLevel } from './access-classifier.js';
import { logger } from '../../infra/logger.js';

export interface IngestDocumentInput {
  title: string;
  source?: string;
  text: string;
  accessLevel?: number; // 1=Public, 2=Internal, 3=Confidential, 4=Restricted
  metadata?: Record<string, any>;
  maxTokensPerChunk?: number;
}

export class RagService {
  /**
   * Complete RAG Ingestion Pipeline:
   * 1. Semantic Chunking: Divides text by thematic topic boundaries (a new chunk for every new topic).
   * 2. Permission & Sensitivity Classification: Scans each chunk for credentials, PII, financial, or internal secrets.
   * 3. Vector Embedding: Generates float vector embeddings for each chunk via text-embedding-004.
   * 4. Vector Storage: Stores embeddings, access levels, and metadata in vector database.
   */
  async ingestDocument(input: IngestDocumentInput): Promise<{
    document: StoredDocument;
    chunks: StoredChunk[];
  }> {
    const title = input.title?.trim() || 'Untitled Knowledge Document';
    const source = input.source?.trim() || 'manual';
    const text = input.text?.trim() || '';
    const baseAccessLevel = accessClassifier.parseLevel(input.accessLevel, AccessLevel.PUBLIC);

    if (!text) {
      throw new Error('Document content cannot be empty');
    }

    const documentId = `doc_${crypto.randomUUID()}`;
    logger.info({ documentId, title, baseAccessLevel, textLength: text.length }, '🚀 Starting RAG Document Ingestion Pipeline');

    // Step 1: Semantic Chunking (Meaning-driven topic boundaries)
    const semanticChunks: SemanticChunk[] = await semanticChunker.chunk(text, {
      maxTokensPerChunk: input.maxTokensPerChunk || 450,
      minTokensPerChunk: 35
    });

    if (semanticChunks.length === 0) {
      throw new Error('Semantic chunker produced zero chunks for the provided text');
    }

    logger.info(
      { documentId, chunkCount: semanticChunks.length },
      '🧩 Semantic chunking completed. Classifying sensitivity and generating embeddings...'
    );

    // Step 2: Vector Embedding Generation
    const chunkTexts = semanticChunks.map((c) => `Topic: ${c.topic}\nContent: ${c.content}`);
    const embeddings = await embeddingService.embedBatch(chunkTexts, 3);

    // Step 3: Classify Access Level & Sensitivity for each chunk
    const now = new Date();
    const storedChunks: StoredChunk[] = semanticChunks.map((chunk, idx) => {
      // Analyze chunk content for sensitive information (credentials, PII, financial, code, etc.)
      const classification = accessClassifier.classify(chunk.content, baseAccessLevel);

      return {
        id: `chk_${crypto.randomUUID()}`,
        documentId,
        chunkIndex: chunk.chunkIndex,
        topic: chunk.topic,
        content: chunk.content,
        embedding: embeddings[idx] || new Array(embeddingService.dimensions).fill(0),
        tokenCount: chunk.tokenCount,
        accessLevel: classification.accessLevel,
        metadata: {
          accessLevelName: classification.accessLevelName,
          sensitivityFlags: classification.sensitivityFlags,
          detectedReasons: classification.detectedReasons,
          ...(input.metadata || {})
        },
        createdAt: now
      };
    });

    // Effective document access level is maximum of base level or any child chunk's elevated level
    const maxChunkLevel = Math.max(baseAccessLevel, ...storedChunks.map((c) => c.accessLevel));

    const document: StoredDocument = {
      id: documentId,
      title,
      source,
      rawText: text,
      chunkCount: semanticChunks.length,
      accessLevel: maxChunkLevel,
      metadata: {
        accessLevelName: accessClassifier.getLevelName(maxChunkLevel),
        baseAccessLevel,
        ...(input.metadata || {})
      },
      createdAt: now,
      updatedAt: now
    };

    // Step 4: Persist in Vector Store
    await vectorStore.saveDocumentWithChunks(document, storedChunks);

    logger.info(
      { documentId, title, docAccessLevel: maxChunkLevel, chunksSaved: storedChunks.length },
      '✅ RAG Document and permission-classified chunks indexed in Vector DB'
    );

    return { document, chunks: storedChunks };
  }

  /**
   * Permission-Aware Vector Semantic Search:
   * Embeds incoming user query and retrieves top semantic matches having accessLevel <= userAccessLevel.
   * If a chunk has higher access level (e.g. confidential, credentials, HR, .env),
   * it will NEVER reach the results or the model.
   */
  async search(
    query: string,
    options: { topK?: number; minSimilarity?: number; userAccessLevel?: number } = {}
  ): Promise<SearchResult[]> {
    const cleanQuery = query?.trim();
    if (!cleanQuery) return [];

    const queryEmbedding = await embeddingService.embedText(cleanQuery);
    return vectorStore.search(queryEmbedding, options);
  }

  /**
   * Builds an enriched context block from relevant knowledge chunks for bot prompting.
   * STRICT ACCESS GATE: Chunks with accessLevel > userAccessLevel are filtered out.
   */
  async getAugmentedContext(
    userMessage: string,
    options: { topK?: number; minSimilarity?: number; userAccessLevel?: number } = {}
  ): Promise<{ contextText: string; matchedChunks: SearchResult[] }> {
    const userAccessLevel = options.userAccessLevel ?? AccessLevel.PUBLIC; // WhatsApp customers default to Public (1)

    const results = await this.search(userMessage, {
      topK: options.topK ?? 3,
      minSimilarity: options.minSimilarity ?? 0.55,
      userAccessLevel
    });

    if (results.length === 0) {
      return { contextText: '', matchedChunks: [] };
    }

    const contextParts = results.map((r, i) => {
      const levelName = accessClassifier.getLevelName(r.chunk.accessLevel);
      return `[Knowledge Source ${i + 1} - ${r.documentTitle} | Topic: ${r.chunk.topic} | Access: ${levelName} | Confidence: ${Math.round(r.similarity * 100)}%]\n${r.chunk.content}`;
    });

    const contextText = contextParts.join('\n\n');
    return { contextText, matchedChunks: results };
  }

  /**
   * Document Management
   */
  async listDocuments(): Promise<StoredDocument[]> {
    return vectorStore.listDocuments();
  }

  async getDocument(id: string): Promise<StoredDocument | null> {
    return vectorStore.getDocument(id);
  }

  async getDocumentChunks(documentId: string): Promise<StoredChunk[]> {
    return vectorStore.getDocumentChunks(documentId);
  }

  async deleteDocument(id: string): Promise<boolean> {
    return vectorStore.deleteDocument(id);
  }
}

export const ragService = new RagService();
