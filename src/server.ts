import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { runMigrations } from './db/migrate.js';
import { seedDemoData } from './db/seed.js';
import { sessionManager } from './modules/sessions/manager.js';
import { messageQueue } from './modules/messages/queue.js';
import { closeRedis } from './infra/redis.js';
import { closeDb, checkDbConnection, isDbAvailable } from './infra/db.js';

async function startServer() {
  try {
    logger.info('🚀 Starting WhatsApp API Gateway...');

    // 1. Probe database and run migrations if connected
    await checkDbConnection();
    if (isDbAvailable) {
      await runMigrations();
      await seedDemoData();
    }

    // 2. Build Fastify application
    const app = await buildApp();

    // 3. Start Fastify listening
    await app.listen({
      port: env.PORT,
      host: env.HOST
    });

    logger.info(`✨ Gateway HTTP server running at: ${env.BASE_URL}`);
    logger.info(`📚 Swagger OpenAPI documentation: ${env.BASE_URL}/docs`);
    logger.info(`📊 Prometheus Metrics available at: ${env.BASE_URL}/metrics`);
    logger.info(`🔑 Admin API Key: ${env.ADMIN_API_KEY}`);

    // 4. Recover active sessions
    await sessionManager.bootRecovery();

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Graceful shutdown initiated...');
      try {
        await app.close();
        await sessionManager.shutdown();
        await messageQueue.shutdown();
        await closeRedis();
        await closeDb();
        logger.info('✅ Clean shutdown completed. Goodbye!');
        process.exit(0);
      } catch (err: any) {
        logger.error({ err: err.message }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Prevent process termination on network drops, socket timeouts, or Baileys crypto drops
    process.on('unhandledRejection', (reason: any) => {
      logger.warn({ err: reason?.message || String(reason) }, '⚠️ Handled unhandledRejection (transient network flap or socket disconnect)');
    });

    process.on('uncaughtException', (err: any) => {
      logger.error({ err: err?.message || String(err), stack: err?.stack }, '⚠️ Handled uncaughtException (retaining gateway process for session reconnect)');
    });

  } catch (err: any) {
    logger.fatal({ err }, 'Failed to start gateway application');
    process.exit(1);
  }
}

startServer();
