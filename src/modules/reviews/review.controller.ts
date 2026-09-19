import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import { Review } from '@/models/review.model';
import { Product } from '@/models/product.model';
import { Order } from '@/models/order.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { badRequest, notFound } from '@/utils/AppError';
import { recordAudit } from '@/middleware/audit';
import { normaliseBdPhone } from '@/utils/text';

/**
 * POST /reviews
 *
 * Lands in `pending` and is invisible until an admin approves it. If the
 * reviewer's phone matches a delivered order containing the product, the
 * review is linked to that order and earns the verified-purchase badge.
 */
export async function createReview(req: Request, res: Response): Promise<void> {
  const { productId, rating, title, body, customerName, phone } = req.body;

  const product = await Product.findById(productId).select('_id title status');
  if (!product || product.status !== 'published') throw notFound('Product');

  let orderId: Types.ObjectId | null = null;
  if (phone) {
    const normalised = normaliseBdPhone(phone);
    if (normalised) {
      const purchase = await Order.findOne({
        'contact.phone': normalised,
        'items.productId': product._id,
        status: 'delivered',
      }).select('_id');
      orderId = purchase?._id ?? null;
    }
  }

  const review = await Review.create({
    productId: product._id,
    customerId: req.customer?.id ?? null,
    orderId,
    customerName: customerName || req.customer?.name || 'Customer',
    rating,
    title,
    body,
    status: 'pending',
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Thank you. Your review will appear once it has been checked.',
    data: { id: review._id, status: review.status },
  });
}

/** GET /admin/reviews — the moderation queue. */
export async function listReviews(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 25 } = req.query as unknown as { page: number; limit: number };
  const status = (req.query.status as string) ?? 'pending';

  const filter = status === 'all' ? {} : { status };

  const [items, total, counts] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('productId', 'title slug images')
      .lean(),
    Review.countDocuments(filter),
    Review.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  sendResponse(res, {
    data: {
      items: items.map((r) => ({ ...r, isVerified: Boolean(r.orderId) })),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    },
    meta: buildMeta(page, limit, total),
  });
}

/**
 * PATCH /admin/reviews/:id — approve or reject.
 *
 * The product's denormalised rating is recomputed from approved reviews
 * afterwards, so the product page never has to aggregate on read.
 */
export async function moderateReview(req: Request, res: Response): Promise<void> {
  const { status } = req.body as { status: 'approved' | 'rejected' };

  const review = await Review.findById(req.params.id);
  if (!review) throw notFound('Review');

  const previous = review.status;
  review.status = status;
  review.moderatedBy = new Types.ObjectId(req.admin!.id);
  review.moderatedAt = new Date();
  await review.save();

  await recomputeProductRating(review.productId.toString());

  recordAudit(req, {
    action: `review.${status}`,
    entity: 'Review',
    entityId: review._id,
    before: { status: previous },
    after: { status },
  });

  sendResponse(res, { message: `Review ${status}.`, data: review });
}

/** DELETE /admin/reviews/:id */
export async function deleteReview(req: Request, res: Response): Promise<void> {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) throw notFound('Review');

  await recomputeProductRating(review.productId.toString());

  recordAudit(req, {
    action: 'review.delete',
    entity: 'Review',
    entityId: review._id,
    before: { rating: review.rating, body: review.body.slice(0, 120) },
  });

  sendResponse(res, { message: 'Review deleted.', data: null });
}

/**
 * Recalculates a product's average rating from its approved reviews.
 *
 * Denormalising the average onto the product is what keeps the listing page
 * from aggregating reviews for every card it renders.
 */
export async function recomputeProductRating(productId: string): Promise<void> {
  const [stats] = await Review.aggregate([
    { $match: { productId: new Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        'rating.avg': stats ? Math.round(stats.avg * 10) / 10 : 0,
        'rating.count': stats?.count ?? 0,
      },
    },
  );
}

/** GET /products/:slug/reviews — paginated, for the "load more" control. */
export async function listProductReviews(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 10 } = req.query as unknown as { page: number; limit: number };

  const product = await Product.findOne({ slug: req.params.slug }).select('_id');
  if (!product) throw notFound('Product');

  const filter = { productId: product._id, status: 'approved' as const };

  const [items, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('customerName rating title body images orderId createdAt')
      .lean(),
    Review.countDocuments(filter),
  ]);

  sendResponse(res, {
    data: items.map((r) => ({ ...r, isVerified: Boolean(r.orderId) })),
    meta: buildMeta(page, limit, total),
  });
}

export { badRequest };
