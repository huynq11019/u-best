// T011 - Application entrypoint: Fastify server + Browser Pool initialization
import Fastify from 'fastify';
import { config } from './config/index.js';
import { logger } from './config/logger.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { loadBuiltInAdapters, listAdapters, getAdapter } from './services/adapterRegistry.js';
import { initPool, drainAllPools, getPoolStats } from './services/browserPool.js';
import { webhookRoutes } from './webhooks/routes.js';
import { executionRoutes } from './webhooks/executionRoutes.js';
import { apiRoutes } from './api/routes.js';

const app = Fastify({
  loggerInstance: logger,
  disableRequestLogging: false,
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');
  try {
    await app.close();
    await drainAllPools();
    await disconnectRedis();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function start() {
  // 1. Connect Redis
  try {
    await connectRedis();
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis unavailable — dedup/locking disabled (dev mode)');
  }

  // 2. Load bookmaker adapters
  await loadBuiltInAdapters();

  // 3. Warm up browser pools for all registered adapters
  const adapterKeys = listAdapters();
  await Promise.allSettled(
    adapterKeys.map(async (key) => {
      try {
        const adapter = getAdapter(key);
        await initPool(key, adapter);
      } catch (err) {
        logger.warn({ bookmakerKey: key, err: err.message }, 'Pool warm-up failed — adapter will be skipped');
      }
    })
  );

  // 4. Register routes
  await app.register(webhookRoutes, { prefix: '/webhooks' });
  await app.register(executionRoutes, { prefix: '/auto-order' });
  await app.register(apiRoutes, { prefix: '/api' });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    adapters: listAdapters(),
    ts: new Date().toISOString(),
  }));

  // Adapters detailed health check
  app.get('/health/adapters', async () => {
    const registeredKeys = listAdapters();
    const stats = getPoolStats();
    
    const adapterDetails = registeredKeys.map((key) => {
      const adapter = getAdapter(key);
      return {
        bookmakerKey: key,
        adapterClass: adapter.constructor.name,
        poolStatus: stats[key] || { status: 'not_initialized' },
      };
    });

    return {
      status: 'ok',
      totalRegistered: registeredKeys.length,
      adapters: adapterDetails,
      ts: new Date().toISOString(),
    };
  });

  // 5. Start listening
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port }, 'surebet_executor listening');
}

start().catch((err) => {
  logger.error({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});
