import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { metricsRegistry } from './infra/metrics.js';
import { isRedisConnected } from './infra/redis.js';

import { sessionRoutes } from './routes/sessions.routes.js';
import { messageRoutes } from './routes/messages.routes.js';
import { chatRoutes } from './routes/chats.routes.js';
import { webhookRoutes } from './routes/webhooks.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { erpRoutes } from './routes/erp.routes.js';
import { ragRoutes } from './routes/rag.routes.js';
import { setupInboundHandler } from './modules/messages/inbound.handler.js';
import { mcpRoutes } from './routes/mcp.routes.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    bodyLimit: 25 * 1024 * 1024 // 25MB for file & image ingestion
  });

  // Allow empty body when Content-Type is application/json (e.g. for DELETE requests)
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
    if (!body || body.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
  });

  // Rate Limiting
  await fastify.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute'
  });

  // OpenAPI / Swagger Documentation
  const swaggerServers = [
    { url: '/', description: 'Current Origin (Live Gateway / Auto-detected)' },
    ...(process.env.RENDER_EXTERNAL_URL
      ? [{ url: process.env.RENDER_EXTERNAL_URL, description: 'Production Gateway (Render)' }]
      : []),
    ...(env.BASE_URL && env.BASE_URL !== '/' && !env.BASE_URL.includes('localhost')
      ? [{ url: env.BASE_URL, description: 'Configured Base URL' }]
      : []),
    { url: 'http://localhost:3000', description: 'Local Development' }
  ];

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'WhatsApp API Gateway',
        description:
          'High-speed, self-hosted WhatsApp API Gateway featuring Multi-Session, Anti-Ban Pacing, Webhooks, Voice-to-ERP queries, and MCP integration.',
        version: '1.0.0'
      },
      servers: swaggerServers,
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key (wag_live_...)'
          }
        }
      },
      security: [{ BearerAuth: [] }]
    }
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    },
    staticCSP: false
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      redis: isRedisConnected() ? 'connected' : 'standalone/memory',
      timestamp: new Date().toISOString()
    };
  });

  // Prometheus Metrics endpoint
  fastify.get('/metrics', async (req, reply) => {
    reply.header('Content-Type', metricsRegistry.contentType);
    return await metricsRegistry.metrics();
  });

  // Register API modules
  await fastify.register(sessionRoutes);
  await fastify.register(messageRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(authRoutes);
  await fastify.register(erpRoutes);
  await fastify.register(ragRoutes);
  await fastify.register(mcpRoutes);

  // Serve local media storage fallback if directory exists
  const mediaStoragePath = path.resolve(env.MEDIA_STORAGE_PATH || './data/media');
  if (!fs.existsSync(mediaStoragePath)) {
    try { fs.mkdirSync(mediaStoragePath, { recursive: true }); } catch {}
  }
  await fastify.register(fastifyStatic, {
    root: mediaStoragePath,
    prefix: '/media/',
    decorateReply: false
  });

  // Serve Dashboard Web UI if dist exists
  const webDistPath = path.resolve('web/dist');
  if (fs.existsSync(webDistPath)) {
    await fastify.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/'
    });
  }

  // Initialize inbound event listeners
  setupInboundHandler();

  return fastify;
}
