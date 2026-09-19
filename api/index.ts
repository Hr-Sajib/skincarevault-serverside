import path from 'node:path';
import moduleAlias from 'module-alias';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vercel serverless entry point.
 *
 * Vercel's Node function builder transpiles each .ts file it discovers
 * individually (TypeScript -> JavaScript, per file) rather than bundling
 * the whole dependency graph -- so it never resolves the "@/" path alias
 * every file under src/ uses; that alias only means something to tsc/tsx,
 * which apply the project's tsconfig at compile time. Registering it here,
 * before anything else loads, is what makes require('@/config') resolve
 * correctly once these files are actually running on Vercel.
 *
 * src/server.ts remains the entry for traditional hosting (Railway, Render,
 * or local dev via `npm run dev`) -- it owns app.listen() and the in-process
 * stock-release interval. Neither of those makes sense here: a serverless
 * function has no persistent process for setInterval to run in, so that job
 * is a separate scheduled function -- see api/cron/.
 */
(moduleAlias as unknown as { addAliases: (a: Record<string, string>) => void }).addAliases({
  '@': path.join(__dirname, '..', 'src'),
});

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => void;
let appPromise: Promise<ExpressApp> | null = null;
let dbReady: Promise<void> | null = null;

function withTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

async function getApp() {
  if (!appPromise) {
    appPromise = withTimeout('import src/app', import('../src/app'), 8000)
      .then((m) => m.createApp() as unknown as ExpressApp);
  }
  return appPromise;
}

async function ensureDB() {
  if (!dbReady) {
    dbReady = (async () => {
      const { connectDB } = await withTimeout('import src/lib/db', import('../src/lib/db'), 8000);
      await withTimeout('connectDB()', connectDB(), 12000);
      const { getSettings } = await withTimeout('import settings model', import('../src/models/settings.model'), 8000);
      await withTimeout('getSettings()', getSettings(), 8000);
    })().catch((err) => {
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
      }),
    );
  }
}
