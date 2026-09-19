import { Order } from '@/models/order.model';
import { cancelOrderAndRestock } from '@/modules/orders/order.service';
import { logger } from '@/lib/logger';

/**
 * Releases stock held by abandoned gateway payments.
 *
 * A customer who opens the SSLCommerz page and then closes the tab leaves
 * their units reserved with no callback ever arriving to resolve them.
 * Without this sweep those units are lost to the catalogue permanently.
 *
 * The query is served by the partial index on
 * `{ status, reservationExpiresAt }`, so it stays cheap however many orders
 * the shop accumulates.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const expired = await Order.find({
    status: 'pending_payment',
    reservationExpiresAt: { $lt: new Date() },
  })
    .select('_id orderNo')
    .limit(100);

  if (!expired.length) return 0;

  let released = 0;

  for (const order of expired) {
    try {
      await cancelOrderAndRestock(order._id.toString(), {
        status: 'expired',
        note: 'Payment not completed within the reservation window',
      });
      released += 1;
    } catch (err) {
      // One stuck order must not stop the rest of the sweep.
      logger.error({ err, orderNo: order.orderNo }, 'Failed to release a reservation');
    }
  }

  if (released > 0) {
    logger.info({ released }, 'Released abandoned payment reservations');
  }

  return released;
}

let timer: NodeJS.Timeout | null = null;

/** Starts the sweep. Ten minutes is frequent enough for a 30-minute window. */
export function startStockReleaseJob(intervalMs = 10 * 60 * 1000): void {
  if (timer) return;

  timer = setInterval(() => {
    releaseExpiredReservations().catch((err) => {
      logger.error({ err }, 'Stock release sweep failed');
    });
  }, intervalMs);

  // Do not hold the process open for the sake of a timer at shutdown.
  timer.unref();

  logger.info({ intervalMinutes: intervalMs / 60000 }, 'Stock release sweep started');
}

export function stopStockReleaseJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
