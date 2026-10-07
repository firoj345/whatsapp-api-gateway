import { FastifyInstance } from 'fastify';
import { db } from '../infra/db.js';
import { erpProductsTable, erpSalesTable, voiceAuditLogsTable, botConfigsTable } from '../db/schema.js';
import { voiceQueryService } from '../modules/voice/voice.service.js';
import { erpCatalog } from '../modules/erp/catalog.js';
import { desc, eq } from 'drizzle-orm';
import { authenticateApiKey, requireScope } from '../modules/auth/guard.js';
import { securityGuard } from '../infra/security-guard.js';

export async function erpRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authenticateApiKey);

  // List inventory products
  fastify.get('/erp/products', {
    schema: {
      tags: ['ERP & Voice'],
      summary: 'List products in ERP inventory'
    }
  }, async () => {
    return await db.select().from(erpProductsTable).limit(50);
  });

  // List recent sales
  fastify.get('/erp/sales', {
    schema: {
      tags: ['ERP & Voice'],
      summary: 'List recent sales records'
    }
  }, async () => {
    return await db.select().from(erpSalesTable).orderBy(desc(erpSalesTable.saleDate)).limit(50);
  });

  // Voice Audit Logs (Section 4.4: "Log the transcript, the query and the answer for auditing")
  fastify.get('/erp/audit-logs', {
    schema: {
      tags: ['ERP & Voice'],
      summary: 'View voice query audit logs (transcript, intent, SQL, latency)'
    }
  }, async () => {
    return await db.select().from(voiceAuditLogsTable).orderBy(desc(voiceAuditLogsTable.createdAt)).limit(50);
  });

  // Test ERP Query via text (for dashboard or external demo)
  fastify.post('/erp/query', {
    schema: {
      tags: ['ERP & Voice'],
      summary: 'Run a natural language or tool query against the ERP database',
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'E.g. "How many MacBook units are in stock?" or "What was today\'s total sales?"' }
        }
      }
    }
  }, async (req, reply) => {
    const { query } = req.body as { query: string };

    // 1. Detect command injection, script injection, or destructive queries
    const threat = securityGuard.detectThreat(query);
    if (threat.isThreat) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Malicious query rejected. Code execution, shell commands, and script tags are strictly prohibited.'
      });
    }

    // 2. Sanitize user input
    const cleanQuery = securityGuard.sanitizeText(query, 200);
    const { toolName, parameters } = await voiceQueryService.parseIntent(cleanQuery);

    // 3. Strict tool whitelist (guards against prototype pollution and arbitrary execution)
    const ALLOWED_ERP_TOOLS = new Set(['get_stock', 'get_sales_total', 'get_top_products']);
    const safeToolKey = ALLOWED_ERP_TOOLS.has(toolName) ? toolName : 'get_stock';
    const tool = erpCatalog[safeToolKey];
    const result = await tool.execute(parameters);

    return {
      query: cleanQuery,
      detectedIntent: safeToolKey,
      parameters,
      result: result.message,
      querySql: result.querySql,
      data: result.data
    };
  });

const memoryBotConfigs = new Map<string, any>();

  // Configure Auto-Reply AI Bot
  fastify.post('/bot/config', {
    preHandler: [requireScope('sessions:manage')],
    schema: {
      tags: ['AI & Chatbot'],
      summary: 'Configure auto-reply bot for a session',
      body: {
        type: 'object',
        required: ['sessionId', 'systemPrompt'],
        properties: {
          sessionId: { type: 'string' },
          systemPrompt: { type: 'string' },
          provider: { type: 'string', default: 'gemini' },
          model: { type: 'string', default: 'gemini-2.5-flash' },
          maxConsecutiveReplies: { type: 'number', default: 5 },
          isActive: { type: 'boolean', default: true }
        }
      }
    }
  }, async (req, reply) => {
    const body = req.body as any;
    const id = `bot_${body.sessionId}`;

    const configObj = {
      id,
      sessionId: body.sessionId,
      systemPrompt: body.systemPrompt,
      provider: body.provider || 'gemini',
      model: body.model || 'gemini-2.5-flash',
      maxConsecutiveReplies: body.maxConsecutiveReplies || 5,
      isActive: body.isActive ?? true
    };

    memoryBotConfigs.set(body.sessionId, configObj);

    try {
      await db
        .insert(botConfigsTable)
        .values(configObj)
        .onConflictDoUpdate({
          target: botConfigsTable.id,
          set: {
            systemPrompt: body.systemPrompt,
            provider: body.provider || 'gemini',
            model: body.model || 'gemini-2.5-flash',
            maxConsecutiveReplies: body.maxConsecutiveReplies || 5,
            isActive: body.isActive ?? true
          }
        });
    } catch {}

    return reply.status(200).send({ success: true, message: 'Bot configuration saved', config: configObj });
  });

  // Get Bot Config
  fastify.get('/bot/config/:sessionId', {
    schema: {
      tags: ['AI & Chatbot'],
      summary: 'Get auto-reply bot configuration for session'
    }
  }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    try {
      const rows = await db.select().from(botConfigsTable).where(eq(botConfigsTable.sessionId, sessionId)).limit(1);
      if (rows.length > 0) return rows[0];
    } catch {}

    const mem = memoryBotConfigs.get(sessionId);
    if (mem) return mem;

    return { isActive: false, message: 'No bot configured for this session' };
  });
}
