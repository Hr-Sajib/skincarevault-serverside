import { Order, type IOrder } from '@/models/order.model';
import { logger } from '@/lib/logger';
import { assertPaid, validatePayment } from '@/lib/sslcommerz';
import { commitReservation, cancelOrderAndRestock } from '@/modules/orders/order.service';
import { notFound } from '@/utils/AppError';

export type SettleOutcome =
  | { outcome: 'paid'; order: IOrder }
  | { outcome: 'already_paid'; order: IOrder }
  | { outcome: 'rejected'; order: IOrder; reason: string };

/**
 * Settles a payment callback. Safe to call repeatedly with the same `val_id`.
 *
 * SSLCommerz posts to the success URL *and*, independently, to the IPN URL.
 * The two race, either can arrive first, and either can arrive twice. Three
 * things keep that from double-processing an order:
 *
 *   1. the status guard below — only an order still `initiated` is settled;
 *   2. a conditional update, so the transition happens exactly once even if
 *      two callbacks pass the guard concurrently;
 *   3. a unique partial index on `payment.valId`, as the final backstop.
 */
export async function settlePayment(params: {
  valId: string;
  tranId: string;
  source: 'success' | 'ipn';
}): Promise<SettleOutcome> {
  const order = await Order.findOne({ 'payment.tranId': params.tranId });
  if (!order) {
    logger.error({ tranId: params.tranId }, 'Callback for an unknown transaction');
    throw notFound('Order');
  }

  // Already settled by the callback that won the race. Not an error.
  if (order.payment.status === 'paid') {
    logger.info(
      { orderNo: order.orderNo, source: params.source },
      'Duplicate payment callback ignored',
    );
    return { outcome: 'already_paid', order };
  }

  // The authoritative check — never the callback's own form fields.
  const validation = await validatePayment(params.valId);

  try {
    assertPaid(validation, order.totals.grandTotalMinor);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Validation failed';
    logger.warn(
      { orderNo: order.orderNo, valId: params.valId, reason },
      'Payment rejected at validation',
    );

    await markFailed(order, reason, validation.raw);
    return { outcome: 'rejected', order, reason };
  }

  // Conditional transition: whichever callback gets here first flips the
  // order, and the other one matches nothing.
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, 'payment.status': 'initiated' },
    {
      $set: {
        'payment.status': 'paid',
        'payment.valId': validation.valId,
        'payment.cardType': validation.cardType,
        'payment.bankTranId': validation.bankTranId,
        'payment.paidAt': new Date(),
        'payment.raw': validation.raw,
        status: 'confirmed',
        reservationExpiresAt: null,
      },
      $push: {
        statusHistory: {
          status: 'confirmed',
          at: new Date(),
          note: `Payment confirmed via ${validation.cardType ?? 'gateway'}`,
        },
      },
    },
    { new: true },
  );

  if (!claimed) {
    const current = await Order.findById(order._id);
    return { outcome: 'already_paid', order: current ?? order };
  }

  // The units already left `stock` when the order was placed; this clears
  // the reservation marker so the sale becomes permanent.
  await commitReservation(claimed);

  logger.info(
    { orderNo: claimed.orderNo, valId: validation.valId, source: params.source },
    'Payment settled',
  );

  return { outcome: 'paid', order: claimed };
}

/**
 * Marks a gateway order failed or cancelled and gives its stock back.
 * Used by the fail and cancel callbacks, and when validation rejects.
 */
export async function markFailed(
  order: IOrder,
  reason: string,
  raw?: Record<string, unknown>,
): Promise<IOrder> {
  if (order.payment.status === 'paid') return order;

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        'payment.status': 'failed',
        ...(raw ? { 'payment.raw': raw } : {}),
      },
    },
  );

  // Releases the reservation and restores the units.
  const cancelled = await cancelOrderAndRestock(order._id.toString(), {
    status: 'cancelled',
    note: reason,
  }).catch((err) => {
    logger.error({ err, orderNo: order.orderNo }, 'Failed to restock a failed payment');
    return order;
  });

  return cancelled;
}

/** Looks an order up by the transaction id a callback carried. */
export async function findByTranId(tranId: string): Promise<IOrder | null> {
  return Order.findOne({ 'payment.tranId': tranId });
}
