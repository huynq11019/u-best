// T005 - Redis client singleton
import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from './logger.js';

let _client = null;

export function getRedisClient() {
  if (_client) return _client;

  _client = new Redis(config.redisUrl, {
    lazyConnect: true,
    retryStrategy(times) {
      if (times >= 5) {
        logger.error({ times }, 'Redis max retries reached, giving up');
        return null;
      }
      const delay = Math.min(times * 200, 2000);
      logger.warn({ times, delay }, 'Redis reconnect attempt');
      return delay;
    },
    reconnectOnError(err) {
      logger.error({ err: err.message }, 'Redis connection error');
      return true;
    },
  });

  _client.on('connect', () => logger.info('Redis connected'));
  _client.on('ready', () => logger.info('Redis ready'));
  _client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  _client.on('close', () => logger.warn('Redis connection closed'));

  return _client;
}

export async function connectRedis() {
  const client = getRedisClient();
  await client.connect();
  return client;
}

export async function disconnectRedis() {
  if (_client) {
    await _client.quit();
    _client = null;
    logger.info('Redis disconnected');
  }
}
