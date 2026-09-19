import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Category } from '@/models/category.model';
import { Brand } from '@/models/brand.model';
import { Coupon } from '@/models/coupon.model';
import { Product } from '@/models/product.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { badRequest, notFound } from '@/utils/AppError';
import { slugify } from '@/utils/text';
import { recordAudit } from '@/middleware/audit';
import { createUploadSignature } from '@/lib/cloudinary';

/* -------------------------------------------------------------- categories */

/** GET /categories — the public nav tree, parents with their children nested. */
export async function getCategoryTree(_req: Request, res: Response): Promise<void> {
  const all = await Category.find({ isActive: true }).sort({ position: 1, name: 1 }).lean();

  const parents = all.filter((c) => !c.parentId);
  const tree = parents.map((parent) => ({
    ...parent,
    children: all.filter((c) => c.parentId?.toString() === parent._id.toString()),
  }));

  sendResponse(res, { data: tree });
}

/** POST /admin/categories */
export async function createCategory(req: Request, res: Response): Promise<void> {
  const category = await Category.create({
    ...req.body,
    slug: slugify(req.body.slug || req.body.name),
  });

  recordAudit(req, {
    action: 'category.create',
    entity: 'Category',
    entityId: category._id,
    after: { name: category.name },
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `Category "${category.name}" created.`,
    data: category,
  });
}

/** PATCH /admin/categories/:id */
export async function updateCategory(req: Request, res: Response): Promise<void> {
  const payload = { ...req.body };
  if (payload.slug || payload.name) {
    payload.slug = slugify(payload.slug || payload.name);
  }

  // A category cannot be its own parent, and the model is one level deep.
  if (payload.parentId && payload.parentId === req.params.id) {
    throw badRequest('A category cannot be its own parent.', 'CIRCULAR_PARENT');
  }

  const category = await Category.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });
  if (!category) throw notFound('Category');

  recordAudit(req, {
    action: 'category.update',
    entity: 'Category',
    entityId: category._id,
    after: { name: category.name },
  });

  sendResponse(res, { message: 'Category saved.', data: category });
}

/**
 * DELETE /admin/categories/:id
 *
 * Refuses while products or child categories still point at it, rather than
 * leaving the storefront with links into nothing.
 */
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  const [productCount, childCount] = await Promise.all([
    Product.countDocuments({ categoryIds: req.params.id, status: { $ne: 'archived' } }),
    Category.countDocuments({ parentId: req.params.id }),
  ]);

  if (productCount > 0) {
    throw badRequest(
      `${productCount} product${productCount === 1 ? '' : 's'} still use this category. Move them first.`,
      'CATEGORY_IN_USE',
    );
  }
  if (childCount > 0) {
    throw badRequest(
      `This category has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}. Remove them first.`,
      'CATEGORY_HAS_CHILDREN',
    );
  }

  const category = await Category.findByIdAndDelete(req.params.id);
  if (!category) throw notFound('Category');

  recordAudit(req, {
    action: 'category.delete',
    entity: 'Category',
    entityId: category._id,
    before: { name: category.name },
  });

  sendResponse(res, { message: `Category "${category.name}" deleted.`, data: null });
}

/** PATCH /admin/categories/reorder */
export async function reorderCategories(req: Request, res: Response): Promise<void> {
  const order = req.body.order as Array<{ id: string; position: number }>;

  await Category.bulkWrite(
    order.map(({ id, position }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { position } } },
    })),
  );

  sendResponse(res, { message: 'Order saved.', data: null });
}

/* ------------------------------------------------------------------ brands */

export async function listBrands(_req: Request, res: Response): Promise<void> {
  const brands = await Brand.find({ isActive: true }).sort({ name: 1 }).lean();
  sendResponse(res, { data: brands });
}

export async function createBrand(req: Request, res: Response): Promise<void> {
  const brand = await Brand.create({
    ...req.body,
    slug: slugify(req.body.slug || req.body.name),
  });

  recordAudit(req, {
    action: 'brand.create',
    entity: 'Brand',
    entityId: brand._id,
    after: { name: brand.name },
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `Brand "${brand.name}" created.`,
    data: brand,
  });
}

export async function updateBrand(req: Request, res: Response): Promise<void> {
  const payload = { ...req.body };
  if (payload.slug || payload.name) {
    payload.slug = slugify(payload.slug || payload.name);
  }

  const brand = await Brand.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });
  if (!brand) throw notFound('Brand');

  sendResponse(res, { message: 'Brand saved.', data: brand });
}

export async function deleteBrand(req: Request, res: Response): Promise<void> {
  const inUse = await Product.countDocuments({
    brandId: req.params.id,
    status: { $ne: 'archived' },
  });
  if (inUse > 0) {
    throw badRequest(
      `${inUse} product${inUse === 1 ? '' : 's'} still use this brand.`,
      'BRAND_IN_USE',
    );
  }

  const brand = await Brand.findByIdAndDelete(req.params.id);
  if (!brand) throw notFound('Brand');

  sendResponse(res, { message: `Brand "${brand.name}" deleted.`, data: null });
}

/* ----------------------------------------------------------------- coupons */

export async function listCoupons(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 25 } = req.query as unknown as { page: number; limit: number };

  const [items, total] = await Promise.all([
    Coupon.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Coupon.countDocuments(),
  ]);

  const now = new Date();
  sendResponse(res, {
    data: items.map((c) => ({
      ...c,
      // The admin table shows one plain-language state rather than four flags.
      state: !c.isActive
        ? 'disabled'
        : c.expiresAt && c.expiresAt < now
          ? 'expired'
          : c.startsAt && c.startsAt > now
            ? 'scheduled'
            : c.usageLimit && c.usedCount >= c.usageLimit
              ? 'exhausted'
              : 'live',
    })),
    meta: buildMeta(page, limit, total),
  });
}

export async function createCoupon(req: Request, res: Response): Promise<void> {
  const coupon = await Coupon.create(req.body);

  recordAudit(req, {
    action: 'coupon.create',
    entity: 'Coupon',
    entityId: coupon._id,
    after: { code: coupon.code, type: coupon.type, value: coupon.value },
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `Coupon ${coupon.code} created.`,
    data: coupon,
  });
}

export async function updateCoupon(req: Request, res: Response): Promise<void> {
  const payload = { ...req.body };
  // Redemptions already made are a fact; only the admin's limit is editable.
  delete payload.usedCount;

  const coupon = await Coupon.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });
  if (!coupon) throw notFound('Coupon');

  recordAudit(req, {
    action: 'coupon.update',
    entity: 'Coupon',
    entityId: coupon._id,
    after: { code: coupon.code },
  });

  sendResponse(res, { message: `Coupon ${coupon.code} saved.`, data: coupon });
}

export async function deleteCoupon(req: Request, res: Response): Promise<void> {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw notFound('Coupon');

  // A code that has been redeemed is referenced by those orders, so it is
  // disabled rather than deleted.
  if (coupon.usedCount > 0) {
    coupon.isActive = false;
    await coupon.save();
    sendResponse(res, {
      message: `Coupon ${coupon.code} has been used ${coupon.usedCount} times, so it was disabled rather than deleted.`,
      data: coupon,
    });
    return;
  }

  await coupon.deleteOne();
  sendResponse(res, { message: `Coupon ${coupon.code} deleted.`, data: null });
}

/* ----------------------------------------------------------------- uploads */

/** POST /admin/uploads/signature */
export async function getUploadSignature(req: Request, res: Response): Promise<void> {
  const folder = typeof req.body.folder === 'string' ? req.body.folder : 'products';
  const allowed = ['products', 'categories', 'brands', 'reviews'];

  if (!allowed.includes(folder)) {
    throw badRequest(`Uploads to "${folder}" are not allowed.`, 'INVALID_FOLDER');
  }

  sendResponse(res, { data: createUploadSignature(folder) });
}
