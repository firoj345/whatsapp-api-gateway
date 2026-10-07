import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { handleToolCall } from '../mcp/server.js';

/**
 * HTTP MCP Route — exposes the MCP server over HTTP (Streamable HTTP + SSE fallback).
 *
 * Users connect to this endpoint from their mcp_config.json:
 *   {
 *     "mcpServers": {
 *       "klizo-whatsapp": {
 *         "url": "https://your-gateway.com/mcp",
 *         "headers": { "Authorization": "Bearer <ADMIN_API_KEY>" }
 *       }
 *     }
 *   }
 */

// In-memory SSE session store (per-process)
const sseSessions = new Map<string, SSEServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'klizo-whatsapp', version: '1.0.0' });

  server.registerTool(
    'whatsapp_list_sessions',
    {
      description: 'List all WhatsApp sessions registered on this gateway with their connection status',
      inputSchema: {}
    },
    () => handleToolCall('whatsapp_list_sessions', {})
  );

  server.registerTool(
    'whatsapp_list_chats',
    {
      description: 'Get list of active chats for a WhatsApp session',
      inputSchema: { sessionId: z.string().min(1).describe('Session identifier') }
    },
    (args) => handleToolCall('whatsapp_list_chats', args)
  );

  server.registerTool(
    'whatsapp_get_recent_messages',
    {
      description: 'Get recent conversation messages for a chat',
      inputSchema: {
        sessionId: z.string().min(1).describe('Session identifier'),
        chatJid: z.string().min(1).describe('WhatsApp JID or phone number'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of messages to retrieve (default 20)')
      }
    },
    (args) => handleToolCall('whatsapp_get_recent_messages', args)
  );

  server.registerTool(
    'whatsapp_send_message',
    {
      description: 'Send a text message to a WhatsApp number or group via the gateway',
      inputSchema: {
        sessionId: z.string().min(1).describe('Session identifier'),
        to: z.string().min(1).describe('Recipient phone number or JID'),
        message: z.string().min(1).describe('Text message to send')
      }
    },
    (args) => handleToolCall('whatsapp_send_message', args)
  );

  server.registerTool(
    'erp_query_inventory',
    {
      description: 'Query ERP stock and pricing for products by product name or SKU',
      inputSchema: { productName: z.string().min(1).describe('Product or SKU search term') }
    },
    (args) => handleToolCall('erp_query_inventory', args)
  );

  return server;
}

/**
 * Middleware: verify Authorization: Bearer <ADMIN_API_KEY>
 */
function authGuard(req: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = req.headers['authorization'] ?? '';
  const queryKey = (req.query as Record<string, string>)['apiKey'] ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || queryKey.trim();

  if (!env.ADMIN_API_KEY || token !== env.ADMIN_API_KEY) {
    reply.code(401).send({ error: 'Unauthorized: invalid or missing API key' });
    return false;
  }
  return true;
}

export async function mcpRoutes(fastify: FastifyInstance) {
  // ─── Streamable HTTP Transport (Modern MCP clients) ────────────────────────
  fastify.post('/mcp', async (req, reply) => {
    if (!authGuard(req, reply)) return;

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // stateless — new server per request
    });

    reply.hijack(); // take control of raw response
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err: any) {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
      }
      reply.raw.end(JSON.stringify({ error: err.message }));
    }
  });

  // ─── SSE Transport (Legacy MCP clients: Cursor, older Claude Desktop) ──────
  fastify.get('/mcp/sse', async (req, reply) => {
    if (!authGuard(req, reply)) return;

    reply.hijack();
    const transport = new SSEServerTransport('/mcp/sse/message', reply.raw);
    sseSessions.set(transport.sessionId, transport);

    req.raw.on('close', () => {
      sseSessions.delete(transport.sessionId);
    });

    const server = createMcpServer();
    await server.connect(transport);
    await transport.start();
  });

  fastify.post('/mcp/sse/message', async (req, reply) => {
    if (!authGuard(req, reply)) return;

    const sessionId = (req.query as Record<string, string>)['sessionId'];
    const transport = sseSessions.get(sessionId);

    if (!transport) {
      return reply.code(404).send({ error: `SSE session not found: ${sessionId}` });
    }

    reply.hijack();
    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });
}
