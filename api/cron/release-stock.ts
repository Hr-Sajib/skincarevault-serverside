import path from 'node:path';
import moduleAlias from 'module-alias';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Replaces the in-process sweep (src/jobs/releaseStock.ts's setInterval) on
 * Vercel, where nothing stays running between requests to drive a timer.
 * Vercel Cron invokes this on the schedule in vercel.json instead.
 *
 * On the Hobby plan, cron jobs are capped at once a day -- coarser than the
 * 30-minute reservation window this is meant to enforce. That's a real gap,
 * but a harmless one today: nothing enters pending_payment until
 * SSLCommerz is wired up, since cash-on-delivery orders settle immediately.
 * Revisit this (Pro plan for hourly+ crons, or a host that runs a real
 * process) before online payments go live.
 *
 * Imports of src/ modules are dynamic (not static `import` declarations)
 * so they execute after the alias registration below at runtime -- static
 * imports get hoisted ahead of other top-level code by the TS/CJS emitter
 * regardless of source order, which would run them before the alias exists.
 */
(moduleAlias as unknown as { addAliases: (a: Record<string, string>) => void }).addAliases({
  '@': path.join(__dirname, '..', '..', 'src'),
});

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;

  if (expected && authHeader !== `Bearer ${expected}`) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  try {
    const { connectDB } = await import('../../src/lib/db');
    const { releaseExpiredReservations } = await import('../../src/jobs/releaseStock');

    await connectDB();
    const released = await releaseExpiredReservations();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, released }));
  } catch (err) {
    const { logger } = await import('../../src/lib/logger');
    logger.error({ err }, 'Cron stock-release sweep failed');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false }));
  }
}
