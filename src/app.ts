import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { errorHandler, notFoundHandler } from '@/middleware/error';
import { blockOperatorInjection } from '@/middleware/validate';
import { generalLimiter } from '@/middleware/rateLimit';
import publicRoutes from '@/routes/public.routes';
import adminRoutes from '@/routes/admin.routes';
import paymentRoutes from '@/routes/payment.routes';

export function createApp(): Application {
  const app = express();

  // Behind Vercel, Railway, or Render there is a proxy in front, so req.ip
  // must come from X-Forwarded-For or every rate limit sees one address.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API serves JSON, not pages, and the gateway posts across origins.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls send no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true, // required for the auth cookies
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  // The gateway posts form-encoded callbacks, not JSON.
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/api/v1/health',
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      env: config.env,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(generalLimiter);
  app.use(blockOperatorInjection);

  // Gateway callbacks are mounted before the CORS-bound API routes because
  // they are posted by SSLCommerz rather than by our own frontend.
  app.use('/api/v1/payments', paymentRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1', publicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
