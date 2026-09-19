import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.join(process.cwd(), '.env') });

/**
 * Every environment variable the API needs, validated once at boot.
 * A missing or malformed value crashes the process here rather than
 * surfacing as a confusing runtime error three layers deep.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('skincarevault'),

  SSL_STORE_ID: z.string().optional(),
  SSL_STORE_PASSWORD: z.string().optional(),
  SSL_IS_LIVE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /** Where the customer's browser gets sent back to. */
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Where the payment gateway posts callbacks. Must be publicly reachable. */
  API_URL: z.string().url().default('http://localhost:5000'),

  /** Shared secret the API uses to ask Next.js to revalidate a product page. */
  REVALIDATE_SECRET: z.string().optional(),

  /** Minutes an unpaid gateway order may hold its stock reservation. */
  PAYMENT_RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  port: env.PORT,

  db: {
    uri: env.MONGODB_URI,
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    folder: env.CLOUDINARY_FOLDER,
    get isConfigured() {
      return Boolean(
        env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
      );
    },
  },

  ssl: {
    storeId: env.SSL_STORE_ID,
    storePassword: env.SSL_STORE_PASSWORD,
    isLive: env.SSL_IS_LIVE,
    get baseUrl() {
      return env.SSL_IS_LIVE
        ? 'https://securepay.sslcommerz.com'
        : 'https://sandbox.sslcommerz.com';
    },
    get isConfigured() {
      return Boolean(env.SSL_STORE_ID && env.SSL_STORE_PASSWORD);
    },
  },

  appUrl: env.APP_URL,
  apiUrl: env.API_URL,
  revalidateSecret: env.REVALIDATE_SECRET,
  paymentReservationMinutes: env.PAYMENT_RESERVATION_MINUTES,
} as const;

export type Config = typeof config;
