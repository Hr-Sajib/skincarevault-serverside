import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Order, ORDER_STATUSES, type OrderStatus } from '@/models/order.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { badRequest, notFound } from '@/utils/AppError';
import { recordAudit } from '@/middleware/audit';
import { cancelOrderAndRestock } from '@/modules/orders/order.service';
import { normaliseBdPhone } from '@/utils/text';
import { formatBDT } from '@/lib/money';

/**
 * Which status may follow which. Enforced server-side so a stale admin tab
 * cannot push an order backwards through the pipeline.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  pending_payment: ['cancelled', 'expired'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
  expired: [],
};

/** GET /admin/orders */
export async function listOrders(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 25 } = req.query as unknown as { page: number; limit: number };
  const { status, method, phone, from, to, q } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};

  if (status && status !== 'all') filter.status = status;
  if (method) filter['payment.method'] = method;

  if (phone) {
    const normalised = normaliseBdPhone(phone);
    if (normalised) filter['contact.phone'] = normalised;
  }

  if (q) filter.orderNo = q.trim().toUpperCase();

  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) {
      // An inclusive end date: the admin means "through the end of that day".
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    filter.placedAt = range;
  }

  const [items, total, statusCounts] = await Promise.all([
    Order.find(filter)
      .sort({ placedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('orderNo contact totals payment.method payment.status status placedAt items')
      .lean(),
    Order.countDocuments(filter),
    // Tab counts, so the admin sees the queue depth without a second request.
    Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  sendResponse(res, {
    data: {
      items: items.map((o) => ({ ...o, itemCount: o.items?.length ?? 0, items: undefined })),
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
    },
    meta: buildMeta(page, limit, total),
  });
}

/** GET /admin/orders/:id */
export async function getOrder(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id).populate('customerId', 'name phone email');
  if (!order) throw notFound('Order');
  sendResponse(res, { data: order });
}

/** PATCH /admin/orders/:id — status change, courier details, internal note. */
export async function updateOrder(req: Request, res: Response): Promise<void> {
  const order = await Order.findById(req.params.id);
  if (!order) throw notFound('Order');

  const { status, note, courier, trackingNumber, consignmentId, adminNote } = req.body;

  if (status && status !== order.status) {
    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw badRequest(
        `An order that is ${order.status} cannot move to ${status}.`,
        'INVALID_TRANSITION',
        { from: order.status, allowed },
      );
    }

    // Cancelling has to give the stock back, so it goes through the
    // transactional path rather than a plain field assignment.
    if (status === 'cancelled') {
      const cancelled = await cancelOrderAndRestock(order._id.toString(), {
        note: note ?? 'Cancelled by admin',
        byAdminId: req.admin!.id,
      });

      recordAudit(req, {
        action: 'order.cancel',
        entity: 'Order',
        entityId: order._id,
        before: { status: order.status },
        after: { status: 'cancelled', note },
      });

      sendResponse(res, {
        message: `Order ${order.orderNo} cancelled and stock restored.`,
        data: cancelled,
      });
      return;
    }

    const previous = order.status;
    order.status = status;
    order.statusHistory.push({
      status,
      at: new Date(),
      byAdminId: new Types.ObjectId(req.admin!.id),
      note,
    });

    // COD is collected on handover, so delivery is what marks it paid.
    if (status === 'delivered') {
      order.fulfilment = { ...order.fulfilment, deliveredAt: new Date() };
      if (order.payment.method === 'cod' && order.payment.status === 'unpaid') {
        order.payment.status = 'paid';
        order.payment.paidAt = new Date();
      }
    }
    if (status === 'shipped') {
      order.fulfilment = { ...order.fulfilment, shippedAt: new Date() };
    }

    recordAudit(req, {
      action: 'order.status',
      entity: 'Order',
      entityId: order._id,
      before: { status: previous },
      after: { status, note },
    });
  }

  if (courier !== undefined) order.fulfilment = { ...order.fulfilment, courier };
  if (trackingNumber !== undefined) {
    order.fulfilment = { ...order.fulfilment, trackingNumber };
  }
  if (consignmentId !== undefined) {
    order.fulfilment = { ...order.fulfilment, consignmentId };
  }
  if (adminNote !== undefined) order.adminNote = adminNote;

  await order.save();

  sendResponse(res, { message: `Order ${order.orderNo} updated.`, data: order });
}

/** POST /admin/orders/:id/cancel */
export async function cancelOrder(req: Request, res: Response): Promise<void> {
  const order = await cancelOrderAndRestock(String(req.params.id), {
    note: req.body.note ?? 'Cancelled by admin',
    byAdminId: req.admin!.id,
  });

  recordAudit(req, {
    action: 'order.cancel',
    entity: 'Order',
    entityId: order._id,
    after: { note: req.body.note },
  });

  sendResponse(res, {
    message: `Order ${order.orderNo} cancelled and stock restored.`,
    data: order,
  });
}

/**
 * GET /admin/orders/export
 *
 * Streams CSV rather than building it in memory, so exporting a year of
 * orders does not scale with the process's heap.
 */
export async function exportOrders(req: Request, res: Response): Promise<void> {
  const { status, from, to } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};
  if (status && status !== 'all') filter.status = status;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    filter.placedAt = range;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
  );

  const columns = [
    'Order No', 'Date', 'Customer', 'Phone', 'District', 'Items',
    'Subtotal', 'Discount', 'Shipping', 'Total', 'Payment', 'Payment Status',
    'Status', 'Courier', 'Tracking',
  ];
  res.write(`${columns.join(',')}\n`);

  const cursor = Order.find(filter).sort({ placedAt: -1 }).cursor();

  for await (const order of cursor) {
    const row = [
      order.orderNo,
      order.placedAt.toISOString().slice(0, 10),
      order.contact.name,
      order.contact.phone,
      order.shipping.district,
      order.items.reduce((n, i) => n + i.qty, 0),
      formatBDT(order.totals.subtotalMinor),
      formatBDT(order.totals.discountMinor),
      formatBDT(order.totals.shippingMinor),
      formatBDT(order.totals.grandTotalMinor),
      order.payment.method,
      order.payment.status,
      order.status,
      order.fulfilment?.courier ?? '',
      order.fulfilment?.trackingNumber ?? '',
    ];
    res.write(`${row.map(csvCell).join(',')}\n`);
  }

  res.end();
}

/** Quotes a cell when it contains a comma, quote, or newline. */
function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export { ORDER_STATUSES };
