import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Product } from '@/models/product.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { badRequest, notFound } from '@/utils/AppError';
import { sanitiseRichText, slugify, escapeRegex } from '@/utils/text';
import { recordAudit } from '@/middleware/audit';
import { destroyAsset } from '@/lib/cloudinary';
import { logger } from '@/lib/logger';

/** GET /admin/products */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 25 } = req.query as unknown as { page: number; limit: number };
  const { q, status, category, lowStock } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};

  if (status && status !== 'all') filter.status = status;
  if (category) filter.categoryIds = category;
  if (q) {
    const term = escapeRegex(q.trim());
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { 'variants.sku': { $regex: term, $options: 'i' } },
    ];
  }
  if (lowStock === 'true') filter['variants.stock'] = { $lte: 5 };

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('brandId', 'name')
      .populate('categoryIds', 'name')
      .lean(),
    Product.countDocuments(filter),
  ]);

  sendResponse(res, { data: items, meta: buildMeta(page, limit, total) });
}

/** GET /admin/products/:id */
export async function getProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product');
  sendResponse(res, { data: product });
}

/** POST /admin/products */
export async function createProduct(req: Request, res: Response): Promise<void> {
  const payload = await normalisePayload(req.body);

  const product = await Product.create(payload);

  recordAudit(req, {
    action: 'product.create',
    entity: 'Product',
    entityId: product._id,
    after: { title: product.title, status: product.status },
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `"${product.title}" created.`,
    data: product,
  });
}

/** PATCH /admin/products/:id */
export async function updateProduct(req: Request, res: Response): Promise<void> {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw notFound('Product');

  const before = {
    title: existing.title,
    status: existing.status,
    variants: existing.variants.map((v) => ({ sku: v.sku, priceMinor: v.priceMinor })),
  };

  const payload = await normalisePayload(req.body, existing.title, existing._id.toString());
  Object.assign(existing, payload);

  // Publishing is the point where the catalogue's guarantees have to hold.
  if (existing.status === 'published') assertPublishable(existing);

  await existing.save();

  recordAudit(req, {
    action: 'product.update',
    entity: 'Product',
    entityId: existing._id,
    before,
    after: {
      title: existing.title,
      status: existing.status,
      variants: existing.variants.map((v) => ({ sku: v.sku, priceMinor: v.priceMinor })),
    },
  });

  sendResponse(res, { message: 'Product saved.', data: existing });
}

/**
 * DELETE /admin/products/:id
 *
 * Archives rather than deletes. Historic orders snapshot their line items,
 * so they would survive a hard delete — but the product page, review
 * threads, and reporting all still want the row to exist.
 */
export async function archiveProduct(req: Request, res: Response): Promise<void> {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'archived', isFeatured: false } },
    { new: true },
  );
  if (!product) throw notFound('Product');

  recordAudit(req, {
    action: 'product.archive',
    entity: 'Product',
    entityId: product._id,
    after: { status: 'archived' },
  });

  sendResponse(res, { message: `"${product.title}" archived.`, data: product });
}

/** POST /admin/products/:id/images — attach assets already uploaded to Cloudinary. */
export async function addImages(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product');

  const startAt = product.images.length;
  req.body.images.forEach((img: Record<string, unknown>, i: number) => {
    product.images.push({ ...img, position: startAt + i } as never);
  });

  await product.save();

  recordAudit(req, {
    action: 'product.images.add',
    entity: 'Product',
    entityId: product._id,
    after: { added: req.body.images.length },
  });

  sendResponse(res, { message: 'Images added.', data: product.images });
}

/** PATCH /admin/products/:id/images — reorder, or edit alt text. */
export async function updateImages(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product');

  const updates = req.body.images as Array<{ _id: string; position?: number; alt?: string }>;

  for (const update of updates) {
    const image = product.images.find((img) => img._id?.toString() === update._id);
    if (!image) continue;
    if (update.position !== undefined) image.position = update.position;
    if (update.alt !== undefined) image.alt = update.alt;
  }

  product.images.sort((a, b) => a.position - b.position);
  await product.save();

  sendResponse(res, { message: 'Images updated.', data: product.images });
}

/**
 * DELETE /admin/products/:id/images/:imageId
 *
 * Removes the reference and the Cloudinary asset. The asset is deleted after
 * the document saves, so a Cloudinary hiccup cannot leave the product
 * pointing at an image that no longer exists.
 */
export async function deleteImage(req: Request, res: Response): Promise<void> {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product');

  const image = product.images.find((img) => img._id?.toString() === req.params.imageId);
  if (!image) throw notFound('Image');

  const publicId = image.publicId;
  product.images = product.images.filter((img) => img._id?.toString() !== req.params.imageId);
  product.images.forEach((img, i) => {
    img.position = i;
  });

  if (product.status === 'published' && product.images.length === 0) {
    throw badRequest(
      'A published product needs at least one image. Unpublish it first.',
      'LAST_IMAGE',
    );
  }

  await product.save();

  destroyAsset(publicId).catch((err) => {
    // The product is already correct; an orphaned asset is a cleanup chore,
    // not a failed request.
    logger.error({ err, publicId }, 'Failed to delete Cloudinary asset');
  });

  recordAudit(req, {
    action: 'product.images.delete',
    entity: 'Product',
    entityId: product._id,
    before: { publicId },
  });

  sendResponse(res, { message: 'Image removed.', data: product.images });
}

/**
 * PATCH /admin/products/:id/stock
 *
 * A deliberate correction — a delivery arriving, or a count after stocktake.
 * Separate from the order pipeline so it is always attributable in the audit
 * log, never mixed up with a sale.
 */
export async function adjustStock(req: Request, res: Response): Promise<void> {
  const { variantId, stock, reason } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product) throw notFound('Product');

  const variant = product.variants.find((v) => v._id.toString() === variantId);
  if (!variant) throw notFound('Variant');

  const before = variant.stock;
  variant.stock = stock;
  await product.save();

  recordAudit(req, {
    action: 'product.stock.adjust',
    entity: 'Product',
    entityId: product._id,
    before: { sku: variant.sku, stock: before },
    after: { sku: variant.sku, stock, reason },
  });

  sendResponse(res, {
    message: `Stock for ${variant.sku} set to ${stock}.`,
    data: { variantId, stock, previous: before },
  });
}

/** POST /admin/products/bulk — publish, archive, or feature several at once. */
export async function bulkUpdate(req: Request, res: Response): Promise<void> {
  const { ids, action } = req.body as { ids: string[]; action: string };

  const updates: Record<string, Record<string, unknown>> = {
    publish: { status: 'published' },
    unpublish: { status: 'draft' },
    archive: { status: 'archived', isFeatured: false },
    feature: { isFeatured: true },
    unfeature: { isFeatured: false },
  };

  const update = updates[action];
  if (!update) throw badRequest(`Unknown bulk action "${action}".`, 'UNKNOWN_ACTION');

  // Publishing in bulk still has to respect the publish rules, so those rows
  // are checked individually and the unpublishable ones reported back.
  if (action === 'publish') {
    const candidates = await Product.find({ _id: { $in: ids } });
    const blocked: Array<{ id: string; title: string; reason: string }> = [];
    const allowed: string[] = [];

    for (const product of candidates) {
      try {
        assertPublishable(product);
        allowed.push(product._id.toString());
      } catch (err) {
        blocked.push({
          id: product._id.toString(),
          title: product.title,
          reason: err instanceof Error ? err.message : 'Cannot publish',
        });
      }
    }

    const result = await Product.updateMany({ _id: { $in: allowed } }, { $set: update });
    recordAudit(req, { action: `product.bulk.${action}`, entity: 'Product', after: { ids: allowed } });

    sendResponse(res, {
      message: blocked.length
        ? `${result.modifiedCount} published, ${blocked.length} skipped.`
        : `${result.modifiedCount} products published.`,
      data: { modified: result.modifiedCount, blocked },
    });
    return;
  }

  const result = await Product.updateMany({ _id: { $in: ids } }, { $set: update });

  recordAudit(req, { action: `product.bulk.${action}`, entity: 'Product', after: { ids } });

  sendResponse(res, {
    message: `${result.modifiedCount} products updated.`,
    data: { modified: result.modifiedCount },
  });
}

/* ----------------------------------------------------------------- helpers */

/**
 * What a product must have before customers can see it. Enforced here rather
 * than in the schema, because a draft is deliberately allowed to be incomplete.
 */
function assertPublishable(product: {
  images: Array<{ alt: string }>;
  variants: Array<{ priceMinor: number; sku: string }>;
  title: string;
}): void {
  if (!product.images.length) {
    throw badRequest(`"${product.title}" needs at least one image before publishing.`, 'NO_IMAGES');
  }
  if (product.images.some((img) => !img.alt?.trim())) {
    throw badRequest(`Every image on "${product.title}" needs alt text.`, 'MISSING_ALT');
  }
  if (!product.variants.length) {
    throw badRequest(`"${product.title}" needs at least one variant.`, 'NO_VARIANTS');
  }
  if (product.variants.some((v) => v.priceMinor <= 0)) {
    throw badRequest(`Every variant on "${product.title}" needs a price.`, 'NO_PRICE');
  }
}

/** Derives the slug, cleans the description, and normalises free-text fields. */
async function normalisePayload(
  body: Record<string, unknown>,
  existingTitle?: string,
  existingId?: string,
): Promise<Record<string, unknown>> {
  const payload = { ...body };

  if (typeof payload.description === 'string') {
    payload.description = sanitiseRichText(payload.description);
  }

  const title = (payload.title as string) ?? existingTitle;
  const wantsNewSlug = typeof payload.slug === 'string' && payload.slug.trim().length > 0;

  if (wantsNewSlug) {
    payload.slug = slugify(payload.slug as string);
  } else if (!existingTitle || (payload.title && payload.title !== existingTitle)) {
    payload.slug = slugify(title as string);
  }

  if (typeof payload.slug === 'string') {
    payload.slug = await uniqueSlug(payload.slug, existingId);
  }

  if (Array.isArray(payload.skinConcerns)) {
    payload.skinConcerns = (payload.skinConcerns as string[]).map((c) =>
      c.trim().toLowerCase(),
    );
  }

  return payload;
}

/** Appends `-2`, `-3`, ... until the slug is free. */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix = 1;

  // Bounded so a pathological case cannot spin.
  while (suffix < 50) {
    const clash = await Product.findOne({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).select('_id');

    if (!clash) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return `${base}-${Date.now().toString(36)}`;
}
