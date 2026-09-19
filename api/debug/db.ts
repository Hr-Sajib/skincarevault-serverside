import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Standalone connectivity probe -- bypasses the app/config layer entirely
 * so a hang here isolates the cause to Mongo networking itself, not
 * anything in src/. Races against a manual timeout so this endpoint always
 * answers within a bounded time instead of hanging like the real one did.
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const start = Date.now();
  res.setHeader('Content-Type', 'application/json');

  const steps: string[] = [];
  try {
    steps.push('importing mongoose');
    const mongoose = (await import('mongoose')).default;

    steps.push('starting connect');
    const uri = process.env.MONGODB_URI ?? '';

    const timeoutMs = 8000;
    let timer: NodeJS.Timeout;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`manual-timeout-${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([
      mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }),
      timeout,
    ]);
    clearTimeout(timer!);

    steps.push('connected');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ms: Date.now() - start, steps }));
  } catch (err) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        ok: false,
        ms: Date.now() - start,
        steps,
        error: (err as Error).message,
        stack: (err as Error).stack,
      }),
    );
  }
}
