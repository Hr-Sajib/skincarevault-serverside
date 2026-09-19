import pino from 'pino';
import { config } from '@/config';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  // Pretty output locally; plain JSON in production so the host can parse it.
  transport: config.isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.store_passwd',
      'SSL_STORE_PASSWORD',
    ],
    censor: '[redacted]',
  },
});
