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
 * Upstash Redis / Cloud Handling:
 * Cloud Redis providers automatically drop idle TLS sockets after period of inactivity.
 * This configuration enables TCP KeepAlive and continuous reconnection strategies to
 * prevent "Connection is closed" errors during user login / API calls.
 */

export const redis = new Redis(env.REDIS_URL, {
  // 1. Enable TLS for secure Upstash connections (`rediss://...`)
  tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,

  // 2. Set maxRetriesPerRequest to null so ioredis waits and retries commands
  // instead of throwing an instant "Connection is closed" exception.
  maxRetriesPerRequest: null,

  // 3. KeepAlive sends TCP ping frames every 10 seconds to keep the Upstash socket open.
  keepAlive: 10000,

  // 4. Disable ready checks to avoid unnecessary commands on initial socket connection.
  enableReadyCheck: false,

  /**
   * Resilient Exponential Backoff Retry Strategy.
   * Instead of stopping after 5 attempts (which leaves the app permanently broken),
   * this strategy continuously retries with a capped max delay of 3 seconds.
   */
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000);
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