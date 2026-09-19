import mongoose from 'mongoose';
import { config } from '@/config';
import { logger } from '@/lib/logger';

mongoose.set('strictQuery', true);

let transactionsSupported = false;

/**
 * True when the connected deployment is a replica set or sharded cluster.
 *
 * Order placement needs a multi-document transaction, which standalone
 * mongod does not support. Atlas and the local docker-compose replica set
 * both satisfy this; a bare `mongod` on a laptop does not.
 */
export const supportsTransactions = () => transactionsSupported;

export async function connectDB(): Promise<void> {
  await mongoose.connect(config.db.uri, {
    autoIndex: !config.isProd, // in production, indexes are created by a migration, not on boot
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });

  const admin = mongoose.connection.db?.admin();
  try {
    const info = await admin?.command({ hello: 1 });
    transactionsSupported = Boolean(info?.setName || info?.msg === 'isdbgrid');
  } catch {
    transactionsSupported = false;
  }

  logger.info(
    { db: mongoose.connection.name, transactions: transactionsSupported },
    'MongoDB connected',
  );

  if (!transactionsSupported) {
    logger.warn(
      'This MongoDB deployment is standalone — transactions are disabled. ' +
        'Order placement will fall back to best-effort writes. ' +
        'Use Atlas or the bundled docker-compose replica set for production parity.',
    );
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB disconnected');
}
