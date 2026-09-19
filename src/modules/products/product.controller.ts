import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Product } from '@/models/product.model';
import { Category } from '@/models/category.model';
import { Review } from '@/models/review.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { notFound } from '@/utils/AppError';
import { escapeRegex } from '@/utils/text';

interface ListQuery {
  q?: string;
  category?: string;
  brand?: string;
  concern?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'relevance';
  inStock?: boolean;
  featured?: boolean;
  page: number;
  limit: number;
}

type SortSpec = Record<string, 1 | -1>;

const SORTS: Record<string, SortSpec> = {
  newest: { createdAt: -1 },
  price_asc: { 'variants.priceMinor': 1 },
  price_desc: { 'variants.priceMinor': -1 },
  rating: { 'rating.avg': -1, 'rating.count': -1 },
};

/**
 * GET /products
 *
 * One aggregation returns the page of results, the total count, and the
 * counts each remaining filter would yield — a `$facet`, so the listing page
 * renders its sidebar without a second round trip.
 */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListQuery;
  const { page, limit } = query;

  const match: Record<string, unknown> = { status: 'published' };

  if (query.category) {
    const category = await Category.findOne({ slug: query.category }).select('_id');
    if (!category) throw notFound('Category');
    // A parent category shows everything filed under its children too.
    const children = await Category.find({ parentId: category._id }).select('_id');
    match.categoryIds = { $in: [category._id, ...children.map((c) => c._id)] };
  }

  if (query.brand) {
    match.brandId = new Types.ObjectId(query.brand);
  }

  if (query.concern) {
    match.skinConcerns = query.concern.toLowerCase();
  }

  if (query.featured) {
    match.isFeatured = true;
  }

  if (query.inStock) {
    match['variants.stock'] = { $gt: 0 };
  }

  if (query.minPrice != null || query.maxPrice != null) {
    const range: Record<string, number> = {};
    if (query.minPrice != null) range.$gte = query.minPrice;
    if (query.maxPrice != null) range.$lte = query.maxPrice;
    match['variants.priceMinor'] = { ...(match['variants.priceMinor'] as object), ...range };
  }

  // Text search when the index can serve it; a prefix regex is the fallback
  // for short fragments the text index would ignore.
  let sort: SortSpec = SORTS[query.sort ?? 'newest'] ?? SORTS.newest;
  if (query.q) {
    const term = query.q.trim();
    if (term.length >= 3) {
      match.$text = { $search: term };
      if (!query.sort || query.sort === 'relevance') {
        // The score is projected as `score` below, so it is sorted by name —
        // `$meta` inside an aggregation `$sort` needs the field to exist first.
        sort = { score: -1 };
      }
    } else {
      // Too short for the text index to be useful; fall back to a prefix match.
      match.title = { $regex: `^${escapeRegex(term)}`, $options: 'i' };
    }
  }

  const projection = {
    slug: 1,
    title: 1,
    subtitle: 1,
    images: { $slice: ['$images', 2] },
    variants: 1,
    rating: 1,
    isFeatured: 1,
    brandId: 1,
    categoryIds: 1,
    createdAt: 1,
    ...(match.$text ? { score: { $meta: 'textScore' } } : {}),
  };

  const [result] = await Product.aggregate([
    { $match: match },
    {
      $facet: {
        items: [
          { $project: projection },
          { $sort: sort },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $lookup: {
              from: 'brands',
              localField: 'brandId',
              foreignField: '_id',
              as: 'brand',
              pipeline: [{ $project: { name: 1, slug: 1 } }],
            },
          },
          { $addFields: { brand: { $first: '$brand' } } },
        ],
        total: [{ $count: 'n' }],
        brands: [
          { $group: { _id: '$brandId', count: { $sum: 1 } } },
          {
            $lookup: {
              from: 'brands',
              localField: '_id',
              foreignField: '_id',
              as: 'brand',
              pipeline: [{ $project: { name: 1, slug: 1 } }],
            },
          },
          { $addFields: { brand: { $first: '$brand' } } },
          { $match: { brand: { $ne: null } } },
          { $sort: { count: -1 } },
        ],
        concerns: [
          { $unwind: '$skinConcerns' },
          { $group: { _id: '$skinConcerns', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ],
        priceBand: [
          { $unwind: '$variants' },
          {
            $group: {
              _id: null,
              min: { $min: '$variants.priceMinor' },
              max: { $max: '$variants.priceMinor' },
            },
          },
        ],
      },
    },
  ]);

  const total = result?.total?.[0]?.n ?? 0;

  sendResponse(res, {
    data: {
      items: result?.items ?? [],
      filters: {
        brands: result?.brands ?? [],
        concerns: result?.concerns ?? [],
        priceBand: result?.priceBand?.[0] ?? { min: 0, max: 0 },
      },
    },
    meta: buildMeta(page, limit, total),
  });
}

/** GET /products/:slug — detail, with approved reviews and related items. */
export async function getProductBySlug(req: Request, res: Response): Promise<void> {
  const product = await Product.findOne({
    slug: req.params.slug,
    status: 'published',
  })
    .populate('brandId', 'name slug logo')
    .populate('categoryIds', 'name slug');

  if (!product) throw notFound('Product');

  const [reviews, related] = await Promise.all([
    Review.find({ productId: product._id, status: 'approved' })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('customerName rating title body images orderId createdAt')
      .lean(),
    Product.find({
      _id: { $ne: product._id },
      status: 'published',
      categoryIds: { $in: product.categoryIds },
    })
      .select('slug title subtitle images variants rating')
      .limit(8)
      .lean(),
  ]);

  sendResponse(res, {
    data: {
      product,
      reviews: reviews.map((r) => ({ ...r, isVerified: Boolean(r.orderId) })),
      related,
    },
  });
}

/** GET /products/featured — the home page rails. */
export async function getStorefrontRails(_req: Request, res: Response): Promise<void> {
  const base = { status: 'published' as const };
  const select = 'slug title subtitle images variants rating isFeatured';

  const [featured, newArrivals, topRated] = await Promise.all([
    Product.find({ ...base, isFeatured: true }).select(select).limit(8).lean(),
    Product.find(base).sort({ createdAt: -1 }).select(select).limit(8).lean(),
    Product.find({ ...base, 'rating.count': { $gte: 1 } })
      .sort({ 'rating.avg': -1, 'rating.count': -1 })
      .select(select)
      .limit(8)
      .lean(),
  ]);

  sendResponse(res, { data: { featured, newArrivals, topRated } });
}
