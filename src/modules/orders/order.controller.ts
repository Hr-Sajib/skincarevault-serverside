import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Order } from '@/models/order.model';
import { sendResponse } from '@/utils/sendResponse';
import { notFound } from '@/utils/AppError';
import { logger } from '@/lib/logger';
import { cancelOrderAndRestock, placeOrder } from '@/modules/orders/order.service';
import { buildTranId, initiatePayment } from '@/lib/sslcommerz';
import { normaliseBdPhone } from '@/utils/text';

/**
 * POST /orders
 *
 * COD returns the order number and the customer is done. A gateway order is
 * created as `pending_payment` with its stock reserved, a payment session is
 * opened, and the client is handed the URL to redirect to.
 */
export async function createOrder(req: Request, res: Response): Promise<void> {
  const { order } = await placeOrder({
    items: req.body.items,
    contact: req.body.contact,
    shipping: req.body.shipping,
    couponCode: req.body.couponCode ?? null,
    paymentMethod: req.body.paymentMethod,
    expectedTotalMinor: req.body.expectedTotalMinor ?? null,
    // Set by `attachCustomerIfPresent`; absent for a guest, which is fine.
    customerId: req.customer?.id ?? null,
  });

  if (order.payment.method === 'cod') {
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: 'Order placed. We will call to confirm shortly.',
      data: { orderNo: order.orderNo, status: order.status, gatewayUrl: null },
    });
    return;
  }

  // Gateway path. A failure here must not strand the order holding stock.
  const tranId = buildTranId(order.orderNo);
  order.payment.tranId = tranId;
  await order.save();

  try {
    const { gatewayUrl } = await initiatePayment({
      tranId,
      amountMinor: order.totals.grandTotalMinor,
      orderNo: order.orderNo,
      customer: order.contact,
      shipping: {
        address1: order.shipping.address1,
        city: order.shipping.city,
        district: order.shipping.district,
        postcode: order.shipping.postcode,
      },
      itemCount: order.items.reduce((n, i) => n + i.qty, 0),
      productNames: order.items.map((i) => i.title).join(', '),
    });

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      message: 'Redirecting you to payment.',
      data: { orderNo: order.orderNo, status: order.status, gatewayUrl },
    });
  } catch (err) {
    // The session never opened, so the customer will never return through a
    // callback. Release the reservation now rather than waiting on the sweep.
    logger.error({ err, orderNo: order.orderNo }, 'Gateway init failed; releasing stock');
    await cancelOrderAndRestock(order._id.toString(), {
      status: 'cancelled',
      note: 'Payment session could not be opened',
    }).catch((restockErr) => {
      logger.error({ err: restockErr, orderNo: order.orderNo }, 'Restock after init failure failed');
    });
    throw err;
  }
}

/**
 * GET /orders/track?orderNo=&phone=
 *
 * The guest tracking lookup. Both the order number and the matching phone
 * are required, so knowing an order number alone reveals nothing.
 */
export async function trackOrder(req: Request, res: Response): Promise<void> {
  const orderNo = String(req.query.orderNo ?? '').trim().toUpperCase();
  const phone = normaliseBdPhone(String(req.query.phone ?? ''));

  if (!orderNo || !phone) throw notFound('Order');

  const order = await Order.findOne({ orderNo, 'contact.phone': phone }).select(
    'orderNo items totals coupon payment.method payment.status status statusHistory ' +
      'shipping.district shipping.city shipping.zoneName fulfilment placedAt contact.name',
  );

  if (!order) throw notFound('Order');

  sendResponse(res, { data: order });
}

/** GET /orders/:orderNo — the confirmation page, gated the same way. */
export async function getOrderByNumber(req: Request, res: Response): Promise<void> {
  const orderNo = String(req.params.orderNo).toUpperCase();
  const phone = req.query.phone ? normaliseBdPhone(String(req.query.phone)) : null;

  const filter: Record<string, unknown> = { orderNo };

  // A signed-in customer sees their own order without proving a phone number.
  if (req.customer) {
    filter.$or = [{ customerId: req.customer.id }, ...(phone ? [{ 'contact.phone': phone }] : [])];
  } else {
    if (!phone) throw notFound('Order');
    filter['contact.phone'] = phone;
  }

  const order = await Order.findOne(filter);
  if (!order) throw notFound('Order');

  sendResponse(res, { data: order });
}

/** GET /account/orders — history for a signed-in customer. */
export async function listMyOrders(req: Request, res: Response): Promise<void> {
  const orders = await Order.find({ customerId: req.customer!.id })
    .sort({ placedAt: -1 })
    .select('orderNo items totals status payment.method payment.status placedAt')
    .limit(50);

  sendResponse(res, { data: orders });
}
