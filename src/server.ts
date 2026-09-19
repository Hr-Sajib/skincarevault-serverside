import type { Server } from 'node:http';
import { createApp } from '@/app';
import { config } from '@/config';
import { connectDB, disconnectDB } from '@/lib/db';
import { logger } from '@/lib/logger';
import { startStockReleaseJob, stopStockReleaseJob } from '@/jobs/releaseStock';
import { getSettings } from '@/models/settings.model';

let server: Server | null = null;

async function bootstrap(): Promise<void> {
  await connectDB();

  // Creates the settings singleton on a fresh database, so no request ever
  // has to cope with it being absent.
  await getSettings();

  const app = createApp();

  server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.env, api: `${config.apiUrl}/api/v1` },
      'Skincare Vault API is listening',
    );

    if (!config.ssl.isConfigured) {
      logger.warn('SSLCommerz is not configured — only cash on delivery will work.');
    }
    if (!config.cloudinary.isConfigured) {
      logger.warn('Cloudinary is not configured — image uploads will be rejected.');
    }
  });

  startStockReleaseJob();
}

/**
 * Finishes in-flight requests before exiting, so a deploy does not drop an
 * order that was mid-transaction.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  stopStockReleaseJob();

  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
  }

  await disconnectDB();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  // The process state is no longer trustworthy after this, so exit rather
  // than continue serving from it.
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
