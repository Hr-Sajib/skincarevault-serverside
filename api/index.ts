import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app';
import { connectDB } from '../src/lib/db';
import { getSettings } from '../src/models/settings.model';
import { logger } from '../src/lib/logger';

/**
 * Vercel serverless entry point.
 *
 * `src/server.ts` remains the entry for traditional hosting (Railway,
 * Render, or local dev via `npm run dev`) — it owns `app.listen()` and the
 * in-process stock-release interval. Neither of those makes sense here:
 * a serverless function has no persistent process for `setInterval` to run
 * in, so that job is a separate scheduled function — see `api/cron/`.
 *
 * The Express app itself is exported directly (no `.listen()` call), which
 * is Vercel's documented pattern for Express: it wraps the app as the
 * function's request handler.
 */

const app = createApp();

// Connecting is async, but this module is only ever evaluated once per
// warm container — the promise is cached so a second invocation on the
// same container skips straight to an already-open connection.
let ready: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (!ready) {
    ready = connectDB()
      .then(() => getSettings())
      .then(() => undefined)
      .catch((err) => {
        // Let the next invocation try again rather than caching a failure.
        ready = null;
        throw err;
      });
  }
  return ready;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await ensureReady();
  } catch (err) {
    logger.error({ err }, 'Database not ready');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, message: 'Service starting up, please retry.', code: 'DB_NOT_READY' }));
    return;
  }

  app(req, res);
}
