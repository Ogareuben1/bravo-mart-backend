import dotenv from 'dotenv';
dotenv.config(); // Loads local .env in development; Cloud Run injects env vars directly

import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();

  // Cloud Run injects PORT (default 8080) and requires binding to 0.0.0.0
  const port = Number(process.env.PORT) || env.PORT || 8080;
  const host = '0.0.0.0';

  const server = app.listen(port, host, () => {
    logger.info(`BravoMart API listening on http://${host}:${port} (${env.NODE_ENV})`);
  });

  let isShuttingDown = false;

  const shutdown = (signal: string): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Cloud Run allows 10s after SIGTERM before SIGKILL; force exit at 8s if cleanup hangs
    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 8000);
    forceExitTimer.unref();

    server.close(() => {
      void (async () => {
        try {
          await disconnectDatabase();
          if (redis && typeof redis.disconnect === 'function') {
            redis.disconnect();
          }
          logger.info('Database and Redis disconnected. Exiting.');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown cleanup', err);
          process.exit(1);
        }
      })();
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});