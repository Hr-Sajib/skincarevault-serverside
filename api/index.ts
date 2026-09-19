import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vercel serverless entry point.
 *
 * src/server.ts remains the entry for traditional hosting (Railway, Render,
 * or local dev via `npm run dev`) -- it owns app.listen() and the in-process
 * stock-release interval. Neither of those makes sense here: a serverless
 * function has no persistent process for setInterval to run in, so that job
 * is a separate scheduled function -- see api/cron/.
 *
 * Both the Express app construction and the DB connection are deferred into
 * the handler's try/catch (rather than at module top-level) so that any
 * synchronous throw during either -- a bad env var, a bad import -- surfaces
 * as a normal JSON error response instead of Vercel's opaque generic crash
 * page, which gave no information to debug from.
 */

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => void;
let appPromise: Promise<ExpressApp> | null = null;
let dbReady: Promise<void> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = import('../src/app').then((m) => m.createApp() as unknown as ExpressApp);
  }
  return appPromise;
}

async function ensureDB() {
  if (!dbReady) {
    dbReady = Promise.all([
      import('../src/lib/db').then((m) => m.connectDB()),
      import('../src/models/settings.model').then((m) => m.getSettings()),
    ])
      .then(() => undefined)
      .catch((err) => {
        dbReady = null;
        throw err;
      });
  }
  return dbReady;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    await ensureDB();
    app(req, res);
  } catch (err) {
    const error = err as Error;
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        code: 'BOOT_FAILED',
        message: error?.message ?? String(err),
        stack: error?.stack,
      }),
    );
  }
}
