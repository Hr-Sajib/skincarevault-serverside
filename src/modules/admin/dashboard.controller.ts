import type { Request, Response } from 'express';
import { Order } from '@/models/order.model';
import { Product } from '@/models/product.model';
import { Review } from '@/models/review.model';
import { getSettings } from '@/models/settings.model';
import { sendResponse } from '@/utils/sendResponse';

/** The shop trades in Dhaka time; bucketing by UTC would cut each day at 6am. */
const TZ = 'Asia/Dhaka';

/** Orders that never became revenue and must not pollute the totals. */
const NON_REVENUE = ['cancelled', 'expired', 'pending_payment'];

/**
 * GET /admin/dashboard
 *
 * One `$facet` produces the revenue series, the top sellers, the status mix,
 * and the period totals together — four answers, one pass over the orders
 * that match the window.
 */
export async function getDashboard(req: Request, res: Response): Promise<void> {
  const days = Number(req.query.days ?? 30);
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // The equally long window immediately before, for the period-on-period delta.
  const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

  const settings = await getSettings();

  const [current, previous, lowStock, pendingReviews, needsAction] = await Promise.all([
    revenueFacet(from, now),
    periodTotals(previousFrom, from),
    Product.aggregate([
      { $match: { status: 'published' } },
      { $unwind: '$variants' },
      {
        $match: {
          'variants.stock': { $lte: settings.inventory.lowStockThreshold },
        },
      },
      {
        $project: {
          title: 1,
          slug: 1,
          sku: '$variants.sku',
          label: '$variants.label',
          stock: '$variants.stock',
          reserved: '$variants.reserved',
          image: { $first: '$images.url' },
        },
      },
      { $sort: { stock: 1 } },
      { $limit: 20 },
    ]),
    Review.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'processing'] } }),
  ]);

  const totals = current.totals[0] ?? { revenueMinor: 0, orders: 0 };
  const prior = previous ?? { revenueMinor: 0, orders: 0 };

  sendResponse(res, {
    data: {
      range: { days, from, to: now },
      totals: {
        revenueMinor: totals.revenueMinor,
        orders: totals.orders,
        averageOrderMinor: totals.orders
          ? Math.round(totals.revenueMinor / totals.orders)
          : 0,
        revenueChangePct: percentChange(prior.revenueMinor, totals.revenueMinor),
        ordersChangePct: percentChange(prior.orders, totals.orders),
      },
      daily: fillMissingDays(current.daily, from, now),
      topProducts: current.top,
      statusMix: Object.fromEntries(current.mix.map((m: { _id: string; n: number }) => [m._id, m.n])),
      paymentMix: Object.fromEntries(
        current.payment.map((m: { _id: string; n: number }) => [m._id, m.n]),
      ),
      actionable: { needsAction, pendingReviews, lowStockCount: lowStock.length },
      lowStock,
    },
  });
}

interface Facet {
  daily: Array<{ _id: string; revenueMinor: number; orders: number }>;
  top: Array<{ _id: unknown; title: string; units: number; revenueMinor: number }>;
  mix: Array<{ _id: string; n: number }>;
  payment: Array<{ _id: string; n: number }>;
  totals: Array<{ revenueMinor: number; orders: number }>;
}

async function revenueFacet(from: Date, to: Date): Promise<Facet> {
  const [result] = await Order.aggregate([
    { $match: { placedAt: { $gte: from, $lte: to }, status: { $nin: NON_REVENUE } } },
    {
      $facet: {
        daily: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$placedAt', timezone: TZ } },
              revenueMinor: { $sum: '$totals.grandTotalMinor' },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        top: [
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.productId',
              // Snapshot title, so a renamed product still reports under the
              // name it sold as.
              title: { $first: '$items.title' },
              units: { $sum: '$items.qty' },
              revenueMinor: { $sum: '$items.lineTotalMinor' },
            },
          },
          { $sort: { units: -1 } },
          { $limit: 10 },
        ],
        mix: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        payment: [{ $group: { _id: '$payment.method', n: { $sum: 1 } } }],
        totals: [
          {
            $group: {
              _id: null,
              revenueMinor: { $sum: '$totals.grandTotalMinor' },
              orders: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  return (
    result ?? { daily: [], top: [], mix: [], payment: [], totals: [] }
  );
}

async function periodTotals(
  from: Date,
  to: Date,
): Promise<{ revenueMinor: number; orders: number }> {
  const [result] = await Order.aggregate([
    { $match: { placedAt: { $gte: from, $lt: to }, status: { $nin: NON_REVENUE } } },
    {
      $group: {
        _id: null,
        revenueMinor: { $sum: '$totals.grandTotalMinor' },
        orders: { $sum: 1 },
      },
    },
  ]);

  return result ?? { revenueMinor: 0, orders: 0 };
}

function percentChange(before: number, after: number): number | null {
  // Growth from zero has no meaningful percentage; the UI shows "new" instead.
  if (before === 0) return after === 0 ? 0 : null;
  return Math.round(((after - before) / before) * 100);
}

/**
 * A day with no orders produces no group, which would make the sparkline
 * skip it and misrepresent the shape. Zero-filled here instead.
 */
function fillMissingDays(
  rows: Array<{ _id: string; revenueMinor: number; orders: number }>,
  from: Date,
  to: Date,
): Array<{ date: string; revenueMinor: number; orders: number }> {
  const byDate = new Map(rows.map((r) => [r._id, r]));
  const out: Array<{ date: string; revenueMinor: number; orders: number }> = [];

  const cursor = new Date(from);
  while (cursor <= to) {
    const key = cursor.toLocaleDateString('en-CA', { timeZone: TZ });
    const row = byDate.get(key);
    out.push({
      date: key,
      revenueMinor: row?.revenueMinor ?? 0,
      orders: row?.orders ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}
