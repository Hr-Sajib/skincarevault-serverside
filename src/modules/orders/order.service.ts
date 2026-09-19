import mongoose, { type ClientSession } from 'mongoose';
import { Product } from '@/models/product.model';
import { Coupon } from '@/models/coupon.model';
import { Order, type IOrder, type IOrderItem, type OrderStatus } from '@/models/order.model';
import { nextOrderNo } from '@/models/counter.model';
import { getSettings } from '@/models/settings.model';
import { supportsTransactions } from '@/lib/db';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import { badRequest, conflict, notFound, outOfStock } from '@/utils/AppError';
import { buildQuote, type CartLineInput, type Quote } from '@/modules/checkout/pricing.service';

export interface PlaceOrderInput {
  items: CartLineInput[];
  contact: { name: string; phone: string; email?: string };
  shipping: {
    address1: string;
    address2?: string;
    area?: string;
    city: string;
    district: string;
    division?: string;
    postcode?: string;
    note?: string;
  };
  couponCode?: string | null;
  paymentMethod: 'cod' | 'sslcommerz';
  customerId?: string | null;
  /** What the client displayed. Compared against the server's own total. */
  expectedTotalMinor?: number | null;
}

export interface PlaceOrderResult {
  order: IOrder;
  quote: Quote;
}

/**
 * Places an order.
 *
 * Everything below happens inside one transaction, because an order that
 * exists without its stock decrement — or a decrement without an order — is
 * worse than no order at all:
 *
 *   1. take the next order number    (counters)
 *   2. decrement stock, guarded      (products)
 *   3. increment coupon usage        (coupons)
 *   4. insert the order              (orders)
 *
 * For COD the stock is decremented outright. For a gateway payment it is
 * moved into `reserved` instead, and only converted to a real decrement once
 * the payment validates — with a sweep job releasing it if the customer never
 * comes back.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const settings = await getSettings();

  if (input.paymentMethod === 'cod' && !settings.payment.codEnabled) {
    throw badRequest('Cash on delivery is unavailable right now.', 'COD_DISABLED');
  }
  if (input.paymentMethod === 'sslcommerz' && !settings.payment.sslcommerzEnabled) {
    throw badRequest('Online payment is unavailable right now.', 'GATEWAY_DISABLED');
  }

  // The server's own numbers. The client's are never trusted.
  const quote = await buildQuote({
    items: input.items,
    couponCode: input.couponCode,
    district: input.shipping.district,
    phone: input.contact.phone,
  });

  if (quote.removed.length) {
    throw conflict(
      'Some items in your cart are no longer available.',
      'CART_CHANGED',
      { removed: quote.removed, quote },
    );
  }

  if (quote.totals.grandTotalMinor < settings.payment.minOrderMinor) {
    throw badRequest(
      `Minimum order is ৳${(settings.payment.minOrderMinor / 100).toFixed(0)}.`,
      'BELOW_MINIMUM',
    );
  }

  // If what the customer was shown disagrees with what we just computed,
  // stop and make them confirm the corrected figure.
  if (
    input.expectedTotalMinor != null &&
    input.expectedTotalMinor !== quote.totals.grandTotalMinor
  ) {
    throw conflict(
      'Prices in your cart have changed. Please review the updated total.',
      'PRICE_CHANGED',
      { quote },
    );
  }

  const isGatewayPayment = input.paymentMethod === 'sslcommerz';

  const items: IOrderItem[] = quote.lines.map((line) => ({
    productId: new mongoose.Types.ObjectId(line.productId),
    variantId: new mongoose.Types.ObjectId(line.variantId),
    sku: line.sku,
    title: line.title,
    variantLabel: line.variantLabel,
    image: line.image,
    unitPriceMinor: line.unitPriceMinor,
    qty: line.qty,
    lineTotalMinor: line.lineTotalMinor,
  }));

  const run = async (session?: ClientSession): Promise<IOrder> => {
    const orderNo = await nextOrderNo(session, settings.orderPrefix);

    for (const line of quote.lines) {
      await takeStock(line.productId, line.variantId, line.qty, isGatewayPayment, session, {
        sku: line.sku,
        title: `${line.title} (${line.variantLabel})`,
      });
    }

    if (quote.coupon) {
      await consumeCoupon(quote.coupon.code, session);
    }

    const status: OrderStatus = isGatewayPayment ? 'pending_payment' : 'pending';

    const [order] = await Order.create(
      [
        {
          orderNo,
          customerId: input.customerId ?? null,
          items,
          contact: input.contact,
          shipping: {
            ...input.shipping,
            zoneId: quote.shipping?.zoneId ?? null,
            zoneName: quote.shipping?.zoneName,
          },
          totals: quote.totals,
          coupon: quote.coupon,
          payment: {
            method: input.paymentMethod,
            status: isGatewayPayment ? 'initiated' : 'unpaid',
          },
          reservationExpiresAt: isGatewayPayment
            ? new Date(Date.now() + config.paymentReservationMinutes * 60 * 1000)
            : null,
          status,
          statusHistory: [{ status, at: new Date() }],
          placedAt: new Date(),
        },
      ],
      { session: session ?? undefined, ordered: true },
    );

    return order;
  };

  const order = await withTransaction(run);
  logger.info(
    { orderNo: order.orderNo, method: input.paymentMethod, total: order.totals.grandTotalMinor },
    'Order placed',
  );

  return { order, quote };
}

/**
 * Takes `qty` units of a variant, atomically.
 *
 * The invariant that makes this simple: **`stock` always means sellable
 * units**. Reserving for a gateway payment decrements `stock` immediately and
 * bumps `reserved` alongside it, purely so the admin can see how many units
 * are sitting at the payment gateway. Physical units on hand are
 * `stock + reserved`.
 *
 * Because of that, the guard is a plain field comparison — the document only
 * matches when the units are actually there, so two concurrent orders for the
 * last one produce one success and one clean failure. No read-then-write, no
 * race window, and no field-to-field comparison that `$elemMatch` cannot do.
 */
async function takeStock(
  productId: string,
  variantId: string,
  qty: number,
  reserveOnly: boolean,
  session: ClientSession | undefined,
  label: { sku: string; title: string },
): Promise<void> {
  const result = await Product.updateOne(
    {
      _id: productId,
      variants: { $elemMatch: { _id: variantId, stock: { $gte: qty } } },
    },
    reserveOnly
      ? { $inc: { 'variants.$.stock': -qty, 'variants.$.reserved': qty } }
      : { $inc: { 'variants.$.stock': -qty } },
    { session: session ?? undefined },
  );

  if (result.matchedCount === 0) {
    throw outOfStock(label.sku, label.title);
  }
}

/**
 * Increments a coupon's usage, refusing to go past its limit.
 *
 * The `$lt` guard is the same trick as the stock decrement: a limited-run
 * code cannot be over-redeemed by two customers checking out simultaneously.
 */
async function consumeCoupon(code: string, session?: ClientSession): Promise<void> {
  const coupon = await Coupon.findOne({ code }).session(session ?? null);
  if (!coupon) throw notFound('Coupon');

  const filter: Record<string, unknown> = { code };
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined) {
    filter.usedCount = { $lt: coupon.usageLimit };
  }

  const result = await Coupon.updateOne(
    filter,
    { $inc: { usedCount: 1 } },
    { session: session ?? undefined },
  );

  if (result.matchedCount === 0) {
    throw conflict('That coupon has just been fully claimed.', 'COUPON_EXHAUSTED');
  }
}

/**
 * Runs the callback in a transaction when the deployment supports one.
 *
 * A standalone mongod — someone's laptop without the docker-compose replica
 * set — cannot start a session, so the work runs unwrapped there. Production
 * always has a replica set, and the warning at boot makes the difference loud.
 */
async function withTransaction<T>(fn: (session?: ClientSession) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    logger.warn('Placing order without a transaction — standalone MongoDB');
    return fn(undefined);
  }

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Cancels an order and puts its stock back, in one transaction.
 * Used by the admin cancel action and by the abandoned-payment sweep.
 */
export async function cancelOrderAndRestock(
  orderId: string,
  opts: { status?: OrderStatus; note?: string; byAdminId?: string | null } = {},
): Promise<IOrder> {
  const targetStatus = opts.status ?? 'cancelled';

  return withTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session ?? null);
    if (!order) throw notFound('Order');

    if (['cancelled', 'expired', 'returned'].includes(order.status)) {
      throw conflict('That order is already closed.', 'ALREADY_CLOSED');
    }
    if (order.status === 'delivered') {
      throw conflict('A delivered order cannot be cancelled.', 'ALREADY_DELIVERED');
    }

    // Stock was already decremented at placement either way. An order still
    // sitting at the gateway additionally has units counted in `reserved`,
    // which has to be wound back at the same time.
    const heldAtGateway = order.status === 'pending_payment';

    for (const item of order.items) {
      await Product.updateOne(
        { _id: item.productId, 'variants._id': item.variantId },
        heldAtGateway
          ? { $inc: { 'variants.$.stock': item.qty, 'variants.$.reserved': -item.qty } }
          : { $inc: { 'variants.$.stock': item.qty } },
        { session: session ?? undefined },
      );
    }

    if (order.coupon?.code) {
      await Coupon.updateOne(
        { code: order.coupon.code, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
        { session: session ?? undefined },
      );
    }

    order.status = targetStatus;
    order.reservationExpiresAt = null;
    order.statusHistory.push({
      status: targetStatus,
      at: new Date(),
      byAdminId: opts.byAdminId ? new mongoose.Types.ObjectId(opts.byAdminId) : null,
      note: opts.note,
    });

    await order.save({ session: session ?? undefined });
    return order;
  });
}

/**
 * Settles a gateway order's reservation once its payment has validated.
 *
 * The units already left `stock` at placement, so this only clears the
 * `reserved` marker — the sale is now permanent.
 */
export async function commitReservation(
  order: IOrder,
  session?: ClientSession,
): Promise<void> {
  for (const item of order.items) {
    await Product.updateOne(
      { _id: item.productId, 'variants._id': item.variantId },
      { $inc: { 'variants.$.reserved': -item.qty } },
      { session: session ?? undefined },
    );
  }
}

export { withTransaction };
