import { FastifyInstance } from 'fastify';
import { ragService } from '../modules/rag/rag.service.js';
import { documentParser } from '../modules/rag/document-parser.js';
import { authenticateApiKey } from '../modules/auth/guard.js';

export async function ragRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // List all knowledge documents
  fastify.get('/rag/documents', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'List all documents in the RAG knowledge base'
    }
  }, async () => {
    const docs = await ragService.listDocuments();
    return docs;
  });

  // Extract text from Document or Image file
  fastify.post('/rag/extract', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'Extract readable text and topic structure from images, PDFs, Word docs, and text files',
      body: {
        type: 'object',
        required: ['fileBase64', 'filename'],
        properties: {
          fileBase64: { type: 'string', description: 'Base64 encoded file data' },
          filename: { type: 'string' },
          mimeType: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { fileBase64, filename, mimeType } = req.body as {
      fileBase64: string;
      filename: string;
      mimeType?: string;
    };

    if (!fileBase64) {
      return reply.status(400).send({ error: 'fileBase64 is required' });
    }

    try {
      const extracted = await documentParser.extractTextFromFile({
        base64Data: fileBase64,
        filename: filename || 'file',
        mimeType
      });

      return {
        success: true,
        filename,
        detectedTitle: extracted.detectedTitle,
        text: extracted.text,
        tokenEstimate: Math.ceil(extracted.text.length / 4)
      };
    } catch (err: any) {
      return reply.status(500).send({
        error: 'File extraction failed',
        message: err?.message || String(err)
      });
    }
  });

  // Ingest / Feed new document, image, or text into RAG pipeline
  fastify.post('/rag/documents', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'Feed data (raw text, image OCR, or document PDF/Word) into RAG pipeline with permission access levels',
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          source: { type: 'string', default: 'manual' },
          text: { type: 'string' },
          accessLevel: { type: 'number', default: 1, description: '1=Public, 2=Internal, 3=Confidential, 4=Restricted' },
          fileBase64: { type: 'string' },
          filename: { type: 'string' },
          mimeType: { type: 'string' },
          maxTokensPerChunk: { type: 'number', default: 450 }
        }
      }
    }
  }, async (req, reply) => {
    const { title, source, text, accessLevel, fileBase64, filename, mimeType, maxTokensPerChunk } = req.body as {
      title?: string;
      source?: string;
      text?: string;
      accessLevel?: number;
      fileBase64?: string;
      filename?: string;
      mimeType?: string;
      maxTokensPerChunk?: number;
    };

    let contentToIngest = text?.trim() || '';
    let finalTitle = title?.trim() || '';
    let finalSource = source || 'manual';

    try {
      // If a file was uploaded (Document or Image)
      if (fileBase64) {
        const extracted = await documentParser.extractTextFromFile({
          base64Data: fileBase64,
          filename: filename || 'Uploaded Document',
          mimeType
        });
        contentToIngest = extracted.text;
        if (!finalTitle) finalTitle = extracted.detectedTitle;
        if (!source || source === 'manual') {
          if (mimeType?.startsWith('image/')) finalSource = 'image';
          else if (filename?.endsWith('.pdf')) finalSource = 'pdf';
          else if (filename?.endsWith('.docx')) finalSource = 'word';
        }
      }

      if (!contentToIngest) {
        return reply.status(400).send({ error: 'No readable text content provided or extracted from file' });
      }

      const result = await ragService.ingestDocument({
        title: finalTitle || 'Untitled Knowledge Document',
        source: finalSource,
        text: contentToIngest,
        accessLevel: accessLevel ?? 1,
        maxTokensPerChunk: maxTokensPerChunk || 450
      });

      return reply.status(201).send({
        success: true,
        document: result.document,
        chunkCount: result.chunks.length,
        chunks: result.chunks.map((c) => ({
          id: c.id,
          chunkIndex: c.chunkIndex,
          topic: c.topic,
          content: c.content,
          accessLevel: c.accessLevel,
          tokenCount: c.tokenCount,
          metadata: c.metadata
        }))
      });
    } catch (err: any) {
      return reply.status(500).send({
        error: 'RAG ingestion failed',
        message: err?.message || String(err)
      });
    }
  });

  // Get chunks for a specific document
  fastify.get('/rag/documents/:id/chunks', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'Inspect semantic chunks, access levels, and topics for a document',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await ragService.getDocument(id);
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }
    const chunks = await ragService.getDocumentChunks(id);
    return {
      document: doc,
      chunks: chunks.map((c) => ({
        id: c.id,
        chunkIndex: c.chunkIndex,
        topic: c.topic,
        content: c.content,
        accessLevel: c.accessLevel,
        tokenCount: c.tokenCount,
        hasEmbedding: Array.isArray(c.embedding) && c.embedding.length > 0,
        embeddingLength: c.embedding?.length || 0,
        metadata: c.metadata,
        createdAt: c.createdAt
      }))
    };
  });

  // Delete document
  fastify.delete('/rag/documents/:id', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'Delete document and its vector embeddings',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      }
    }
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await ragService.deleteDocument(id);
    return { success: true, deletedId: id };
  });

  // Query / Test Semantic Search with Permission-Aware Filtering
  fastify.post('/rag/query', {
    schema: {
      tags: ['RAG Pipeline'],
      summary: 'Perform vector similarity search against knowledge base with permission-level filtering',
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query or customer question' },
          topK: { type: 'number', default: 3 },
          minSimilarity: { type: 'number', default: 0.45 },
          userAccessLevel: {
            type: 'number',
            default: 1,
            description: 'User access level: 1=Public, 2=Internal, 3=Confidential, 4=Restricted'
          }
        }
      }
    }
  }, async (req, reply) => {
    const { query, topK, minSimilarity, userAccessLevel } = req.body as {
      query: string;
      topK?: number;
      minSimilarity?: number;
      userAccessLevel?: number;
    };

    if (!query || !query.trim()) {
      return reply.status(400).send({ error: 'Query cannot be empty' });
    }

    const effectiveAccessLevel = userAccessLevel !== undefined ? Number(userAccessLevel) : 1;

    try {
      const results = await ragService.search(query.trim(), {
        topK: topK || 3,
        minSimilarity: minSimilarity ?? 0.45,
        userAccessLevel: effectiveAccessLevel
      });

      return {
        query: query.trim(),
        userAccessLevel: effectiveAccessLevel,
        matchCount: results.length,
        results: results.map((r) => ({
          documentTitle: r.documentTitle,
          topic: r.chunk.topic,
          content: r.chunk.content,
          accessLevel: r.chunk.accessLevel,
          similarity: Number(r.similarity.toFixed(4)),
          tokenCount: r.chunk.tokenCount,
          metadata: r.chunk.metadata
        }))
      };
    } catch (err: any) {
      return reply.status(500).send({
        error: 'Vector search failed',
        message: err?.message || String(err)
      });
    }
  });
}
