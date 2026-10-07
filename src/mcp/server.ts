import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { env } from '../config/env.js';

/**
 * Standard Model Context Protocol (MCP) Server for WhatsApp API Gateway.
 * Uses the official SDK's stdio transport for Cursor and other MCP clients.
 */

const gatewayUrl = (env.MCP_GATEWAY_URL || `http://127.0.0.1:${env.PORT}`).replace(/\/+$/, '');

async function gatewayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.ADMIN_API_KEY) {
    throw new Error('ADMIN_API_KEY is not configured for the MCP server');
  }

  const response = await fetch(`${gatewayUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.ADMIN_API_KEY}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    },
    signal: AbortSignal.timeout(10_000)
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Gateway request failed (${response.status}): ${responseText || response.statusText}`);
  }

  return responseText ? JSON.parse(responseText) as T : undefined as T;
}

export async function handleToolCall(name: string, args: any) {
  switch (name) {
    case 'whatsapp_list_sessions': {
      const active = await gatewayRequest<unknown[]>('/sessions');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(active, null, 2) }]
      };
    }

    case 'whatsapp_list_chats': {
      const chats = await gatewayRequest<unknown[]>(
        `/sessions/${encodeURIComponent(args.sessionId)}/chats`
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(chats, null, 2) }]
      };
    }

    case 'whatsapp_get_recent_messages': {
      const query = new URLSearchParams({ limit: String(args.limit ?? 20) });
      const messages = await gatewayRequest<unknown[]>(
        `/sessions/${encodeURIComponent(args.sessionId)}/chats/${encodeURIComponent(args.chatJid)}/messages?${query}`
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(messages, null, 2) }]
      };
    }

    case 'whatsapp_send_message': {
      const result = await gatewayRequest<unknown>(
        `/sessions/${encodeURIComponent(args.sessionId)}/messages/text`,
        {
          method: 'POST',
          body: JSON.stringify({ to: args.to, text: args.message })
        }
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }]
      };
    }

    case 'erp_query_inventory': {
      const products = await gatewayRequest<Array<{ name: string; sku: string }>>('/erp/products');
      const searchTerm = args.productName.toLocaleLowerCase();
      const matches = products
        .filter((product) =>
          product.name.toLocaleLowerCase().includes(searchTerm) ||
          product.sku.toLocaleLowerCase().includes(searchTerm)
        )
        .slice(0, 10);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(matches, null, 2) }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new McpServer({
  name: 'klizo-whatsapp',
  version: '1.0.0'
});

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

// Only start stdio transport when run directly (npm run mcp)
// When imported as a module by mcp.routes.ts, this block is skipped.
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  await server.connect(new StdioServerTransport());
}
