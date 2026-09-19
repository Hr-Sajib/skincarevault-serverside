import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectDB } from '../../src/lib/db';
import { releaseExpiredReservations } from '../../src/jobs/releaseStock';
import { logger } from '../../src/lib/logger';

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
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Vercel sends this bearer token on cron-triggered requests when
  // CRON_SECRET is set -- without the check, the endpoint would be a public
  // URL anyone could hit to force a sweep.
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;

  if (expected && authHeader !== `Bearer ${expected}`) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  try {
    await connectDB();
    const released = await releaseExpiredReservations();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, released }));
  } catch (err) {
    logger.error({ err }, 'Cron stock-release sweep failed');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false }));
  }
}
