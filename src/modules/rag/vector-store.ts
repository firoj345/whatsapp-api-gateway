import fs from 'fs';
import path from 'path';
import { eq, desc } from 'drizzle-orm';
import { db, isDbAvailable } from '../../infra/db.js';
import { knowledgeDocumentsTable, knowledgeChunksTable } from '../../db/schema.js';
import { embeddingService } from './embedding.service.js';
import { logger } from '../../infra/logger.js';

export interface StoredDocument {
  id: string;
  title: string;
  source: string;
  rawText: string;
  chunkCount: number;
  accessLevel: number; // 1=Public, 2=Internal, 3=Confidential, 4=Restricted
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  topic: string;
  content: string;
  embedding: number[];
  tokenCount: number;
  accessLevel: number; // 1=Public, 2=Internal, 3=Confidential, 4=Restricted
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface SearchResult {
  chunk: StoredChunk;
  documentTitle: string;
  similarity: number;
}

export class VectorStore {
  private localStorePath = path.resolve(process.cwd(), 'data', 'rag_store.json');
  private documentsMap = new Map<string, StoredDocument>();
  private chunksMap = new Map<string, StoredChunk>();

  constructor() {
    this.ensureDataDir();
    this.loadFromLocalDisk();
  }

  private ensureDataDir() {
    const dir = path.dirname(this.localStorePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }
  }

  private loadFromLocalDisk() {
    try {
      if (fs.existsSync(this.localStorePath)) {
        const raw = fs.readFileSync(this.localStorePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.documents)) {
          for (const doc of data.documents) {
            this.documentsMap.set(doc.id, {
              ...doc,
              accessLevel: doc.accessLevel ?? 1,
              createdAt: new Date(doc.createdAt),
              updatedAt: new Date(doc.updatedAt)
            });
          }
        }
        if (Array.isArray(data.chunks)) {
          for (const chk of data.chunks) {
            this.chunksMap.set(chk.id, {
              ...chk,
              accessLevel: chk.accessLevel ?? 1,
              createdAt: new Date(chk.createdAt)
            });
          }
        }
        logger.info(
          { documents: this.documentsMap.size, chunks: this.chunksMap.size },
          '📂 Loaded RAG knowledge base from local disk storage'
        );
      }
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Failed reading local rag_store.json');
    }
  }

  private saveToLocalDisk() {
    try {
      this.ensureDataDir();
      const payload = {
        documents: Array.from(this.documentsMap.values()),
        chunks: Array.from(this.chunksMap.values())
      };
      fs.writeFileSync(this.localStorePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'Failed persisting rag_store.json to disk');
    }
  }

  /**
   * Insert or update a document and its semantic chunks
   */
  async saveDocumentWithChunks(
    document: StoredDocument,
    chunks: StoredChunk[]
  ): Promise<void> {
    // 1. Update in-memory map
    this.documentsMap.set(document.id, document);
    for (const chunk of chunks) {
      this.chunksMap.set(chunk.id, chunk);
    }
    this.saveToLocalDisk();

    // 2. Persist to Postgres if available
    if (isDbAvailable) {
      try {
        await db
          .insert(knowledgeDocumentsTable)
          .values({
            id: document.id,
            title: document.title,
            source: document.source,
            rawText: document.rawText,
            chunkCount: chunks.length,
            accessLevel: document.accessLevel ?? 1,
            metadata: document.metadata || {},
            createdAt: document.createdAt,
            updatedAt: document.updatedAt
          })
          .onConflictDoUpdate({
            target: knowledgeDocumentsTable.id,
            set: {
              title: document.title,
              source: document.source,
              rawText: document.rawText,
              chunkCount: chunks.length,
              accessLevel: document.accessLevel ?? 1,
              metadata: document.metadata || {},
              updatedAt: new Date()
            }
          });

        // Remove old chunks if any
        await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, document.id));

        // Insert new chunks in batch
        if (chunks.length > 0) {
          await db.insert(knowledgeChunksTable).values(
            chunks.map((c) => ({
              id: c.id,
              documentId: c.documentId,
              chunkIndex: c.chunkIndex,
              topic: c.topic,
              content: c.content,
              embedding: c.embedding,
              tokenCount: c.tokenCount,
              accessLevel: c.accessLevel ?? document.accessLevel ?? 1,
              metadata: c.metadata || {},
              createdAt: c.createdAt
            }))
          );
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed writing document & chunks to PostgreSQL, stored locally');
      }
    }
  }

  /**
   * List all documents
   */
  async listDocuments(): Promise<StoredDocument[]> {
    if (isDbAvailable) {
      try {
        const rows = await db
          .select()
          .from(knowledgeDocumentsTable)
          .orderBy(desc(knowledgeDocumentsTable.createdAt));
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          source: r.source,
          rawText: r.rawText,
          chunkCount: r.chunkCount,
          accessLevel: r.accessLevel ?? 1,
          metadata: (r.metadata as Record<string, any>) || {},
          createdAt: r.createdAt,
          updatedAt: r.updatedAt
        }));
      } catch {}
    }

    return Array.from(this.documentsMap.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Get document by ID
   */
  async getDocument(id: string): Promise<StoredDocument | null> {
    if (isDbAvailable) {
      try {
        const rows = await db
          .select()
          .from(knowledgeDocumentsTable)
          .where(eq(knowledgeDocumentsTable.id, id))
          .limit(1);
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            title: r.title,
            source: r.source,
            rawText: r.rawText,
            chunkCount: r.chunkCount,
            accessLevel: r.accessLevel ?? 1,
            metadata: (r.metadata as Record<string, any>) || {},
            createdAt: r.createdAt,
            updatedAt: r.updatedAt
          };
        }
      } catch {}
    }
    return this.documentsMap.get(id) || null;
  }

  /**
   * Get chunks for a specific document
   */
  async getDocumentChunks(documentId: string): Promise<StoredChunk[]> {
    if (isDbAvailable) {
      try {
        const rows = await db
          .select()
          .from(knowledgeChunksTable)
          .where(eq(knowledgeChunksTable.documentId, documentId));
        if (rows.length > 0) {
          return rows
            .map((r) => ({
              id: r.id,
              documentId: r.documentId,
              chunkIndex: r.chunkIndex,
              topic: r.topic,
              content: r.content,
              embedding: (r.embedding as number[]) || [],
              tokenCount: r.tokenCount,
              accessLevel: r.accessLevel ?? 1,
              metadata: (r.metadata as Record<string, any>) || {},
              createdAt: r.createdAt
            }))
            .sort((a, b) => a.chunkIndex - b.chunkIndex);
        }
      } catch {}
    }

    return Array.from(this.chunksMap.values())
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  /**
   * Delete a document and its associated chunks
   */
  async deleteDocument(documentId: string): Promise<boolean> {
    this.documentsMap.delete(documentId);
    for (const [chunkId, chunk] of this.chunksMap.entries()) {
      if (chunk.documentId === documentId) {
        this.chunksMap.delete(chunkId);
      }
    }
    this.saveToLocalDisk();

    if (isDbAvailable) {
      try {
        await db.delete(knowledgeChunksTable).where(eq(knowledgeChunksTable.documentId, documentId));
        await db.delete(knowledgeDocumentsTable).where(eq(knowledgeDocumentsTable.id, documentId));
      } catch (err: any) {
        logger.warn({ err: err?.message, documentId }, 'Error deleting document from PostgreSQL');
      }
    }

    return true;
  }

  /**
   * Permission-Aware Vector Similarity Search:
   * Calculates cosine similarity between query embedding and chunk embeddings.
   * STRICT FILTER: Only chunks with chunk.accessLevel <= userAccessLevel are retrieved.
   * If a chunk has higher access level (e.g. confidential, secret credentials, HR, internal strategy),
   * it is strictly blocked and excluded so it NEVER reaches the LLM prompt.
   */
  async search(
    queryEmbedding: number[],
    options: { topK?: number; minSimilarity?: number; userAccessLevel?: number } = {}
  ): Promise<SearchResult[]> {
    const topK = options.topK ?? 4;
    const minSimilarity = options.minSimilarity ?? 0.45;
    const userAccessLevel = options.userAccessLevel ?? 1; // Default to Level 1 (Public)

    // Retrieve all chunks from cache/memory
    let chunks = Array.from(this.chunksMap.values());

    if (chunks.length === 0 && isDbAvailable) {
      try {
        const rows = await db.select().from(knowledgeChunksTable);
        chunks = rows.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          chunkIndex: r.chunkIndex,
          topic: r.topic,
          content: r.content,
          embedding: (r.embedding as number[]) || [],
          tokenCount: r.tokenCount,
          accessLevel: r.accessLevel ?? 1,
          metadata: (r.metadata as Record<string, any>) || {},
          createdAt: r.createdAt
        }));
        // Repopulate memory cache
        for (const c of chunks) this.chunksMap.set(c.id, c);
      } catch {}
    }

    const scoredResults: SearchResult[] = [];
    let blockedByAclCount = 0;

    for (const chunk of chunks) {
      // 1. Strict Permission Filter: chunk.accessLevel <= userAccessLevel
      const chunkLevel = chunk.accessLevel ?? 1;
      if (chunkLevel > userAccessLevel) {
        blockedByAclCount++;
        continue; // Blocked! Sensitive/confidential chunk will never be included in search results
      }

      if (!chunk.embedding || chunk.embedding.length === 0) continue;
      const similarity = embeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity >= minSimilarity) {
        const doc = this.documentsMap.get(chunk.documentId);
        scoredResults.push({
          chunk,
          documentTitle: doc?.title || 'Knowledge Base',
          similarity
        });
      }
    }

    if (blockedByAclCount > 0) {
      logger.debug(
        { userAccessLevel, blockedCount: blockedByAclCount },
        '🛡️ Permission-Aware Search: Filtered out confidential chunks exceeding user access level'
      );
    }

    // Sort descending by similarity
    scoredResults.sort((a, b) => b.similarity - a.similarity);

    return scoredResults.slice(0, topK);
  }
}

export const vectorStore = new VectorStore();
