import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * ============================================================================
 * BRAVOMART - REDIS CONNECTION CONFIGURATION
 * ============================================================================
 *
 * Primary Use Cases:
 * 1. Session Store — Stores refresh tokens for fast O(1) lookups during authentication.
 * 2. Caching Layer — Cache-aside implementation for product and category catalog queries.
 *
 * Cloud Run & Upstash Redis Handling:
 * Cloud Run freezes container CPU between requests, and Upstash drops idle TLS sockets.
 * TCP KeepAlive + capped backoff ensures sockets recover cleanly on incoming requests.
 */

const isTls = env.REDIS_URL.startsWith('rediss://');

export const redis = new Redis(env.REDIS_URL, {
  // 1. Enable TLS for secure Upstash connections (`rediss://...`)
  tls: isTls ? { rejectUnauthorized: false } : undefined,

  // 2. Wait and retry commands instead of throwing instant "Connection is closed" errors
  maxRetriesPerRequest: null,

  // 3. KeepAlive sends TCP ping frames every 10 seconds to keep the Upstash socket open
  keepAlive: 10000,

  // 4. Disable ready checks to avoid unnecessary commands on initial socket connection
  enableReadyCheck: false,

  // 5. Connect cleanly when ready rather than blocking initial module load
  lazyConnect: false,

  /**
   * Resilient Exponential Backoff Retry Strategy.
   * Backs off up to 15 seconds so transient drops recover quickly without flooding logs.
   */
  retryStrategy(times: number): number {
    const delay = Math.min(times * 250, 15000);
    logger.warn(`Redis disconnected. Reconnecting... (Attempt ${times}, waiting ${delay}ms)`);
    return delay;
  },
});

// Event Listeners for Lifecycle Monitoring
redis.on('connect', () => {
  logger.info('Successfully connected to Redis instance');
});

redis.on('ready', () => {
  logger.info('Redis client is ready to accept commands');
});

redis.on('reconnecting', () => {
  logger.warn('Redis client is attempting to reconnect...');
});

redis.on('error', (error: Error) => {
  logger.error(`Redis connection error: ${error.message}`);
});