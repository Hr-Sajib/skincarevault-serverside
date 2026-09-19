import { Types } from 'mongoose';
import { Product, type IProduct, type IProductVariant } from '@/models/product.model';
import { Coupon, type ICoupon } from '@/models/coupon.model';
import { Order } from '@/models/order.model';
import { getSettings, type IShippingZone } from '@/models/settings.model';
import { clampMinor, percentOfMinor, sumMinor } from '@/lib/money';
import { badRequest, notFound } from '@/utils/AppError';

/** What the client sends: ids and quantities. Never a price. */
export interface CartLineInput {
  productId: string;
  variantId: string;
  qty: number;
}

export interface PricedLine {
  productId: string;
  variantId: string;
  sku: string;
  slug: string;
  /** Carried so a category-scoped coupon can be evaluated without a second query. */
  categoryIds: string[];
  title: string;
  variantLabel: string;
  image: { url: string; alt: string } | null;
  unitPriceMinor: number;
  compareAtMinor: number | null;
  qty: number;
  lineTotalMinor: number;
  available: number;
  /** True when qty was reduced to match remaining stock. */
  adjusted: boolean;
}

export interface RemovedLine {
  productId: string;
  variantId: string;
  title: string;
  reason: 'unavailable' | 'out_of_stock';
}

export interface CartValuation {
  lines: PricedLine[];
  removed: RemovedLine[];
  subtotalMinor: number;
  itemCount: number;
}

export interface CouponOutcome {
  coupon: ICoupon;
  discountMinor: number;
  snapshot: { code: string; type: 'percent' | 'fixed'; value: number; discountMinor: number };
}

export interface Quote {
  lines: PricedLine[];
  removed: RemovedLine[];
  coupon: CouponOutcome['snapshot'] | null;
  shipping: { zoneId: string | null; zoneName: string; estimate: string; amountMinor: number } | null;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    grandTotalMinor: number;
  };
}

/**
 * Re-prices a cart from the database.
 *
 * This is the only function that decides what a line costs. Both
 * `POST /cart/validate` and order placement call it, so the price a customer
 * is shown and the price they are charged come from the same code path.
 */
export async function valuateCart(input: CartLineInput[]): Promise<CartValuation> {
  if (!input.length) {
    return { lines: [], removed: [], subtotalMinor: 0, itemCount: 0 };
  }

  const productIds = [...new Set(input.map((l) => l.productId))].filter((id) =>
    Types.ObjectId.isValid(id),
  );

  const products = await Product.find({
    _id: { $in: productIds },
    status: 'published',
  }).lean<IProduct[]>();

  const byId = new Map(products.map((p) => [p._id.toString(), p]));

  const lines: PricedLine[] = [];
  const removed: RemovedLine[] = [];

  for (const line of input) {
    const product = byId.get(line.productId);
    if (!product) {
      removed.push({
        productId: line.productId,
        variantId: line.variantId,
        title: 'This item',
        reason: 'unavailable',
      });
      continue;
    }

    const variant = product.variants.find((v) => v._id.toString() === line.variantId);
    if (!variant) {
      removed.push({
        productId: line.productId,
        variantId: line.variantId,
        title: product.title,
        reason: 'unavailable',
      });
      continue;
    }

    // `stock` is already net of anything held at the payment gateway —
    // reserving decrements it — so it is the sellable figure as-is.
    const available = Math.max(0, variant.stock);
    if (available <= 0) {
      removed.push({
        productId: line.productId,
        variantId: line.variantId,
        title: `${product.title} (${variant.label})`,
        reason: 'out_of_stock',
      });
      continue;
    }

    const qty = Math.min(line.qty, available);
    const cover = product.images?.find((img) => img.position === 0) ?? product.images?.[0];

    lines.push({
      productId: product._id.toString(),
      variantId: variant._id.toString(),
      sku: variant.sku,
      slug: product.slug,
      categoryIds: (product.categoryIds ?? []).map((id) => id.toString()),
      title: product.title,
      variantLabel: variant.label,
      image: cover ? { url: cover.url, alt: cover.alt } : null,
      unitPriceMinor: variant.priceMinor,
      compareAtMinor: variant.compareAtMinor ?? null,
      qty,
      lineTotalMinor: variant.priceMinor * qty,
      available,
      adjusted: qty !== line.qty,
    });
  }

  return {
    lines,
    removed,
    subtotalMinor: sumMinor(lines.map((l) => l.lineTotalMinor)),
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
  };
}

/**
 * Validates a coupon against a specific cart and returns the discount it earns.
 *
 * Throws with a customer-readable reason rather than silently returning zero,
 * so the checkout form can explain why a code did not apply.
 */
export async function applyCoupon(
  code: string,
  valuation: CartValuation,
  phone?: string,
): Promise<CouponOutcome> {
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (!coupon || !coupon.isActive) {
    throw badRequest('That coupon code is not valid.', 'COUPON_INVALID');
  }

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) {
    throw badRequest('That coupon is not active yet.', 'COUPON_NOT_STARTED');
  }
  if (coupon.expiresAt && now > coupon.expiresAt) {
    throw badRequest('That coupon has expired.', 'COUPON_EXPIRED');
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= (coupon.usageLimit ?? 0)) {
    throw badRequest('That coupon has been fully claimed.', 'COUPON_EXHAUSTED');
  }

  // Which lines the coupon actually covers.
  const eligible = eligibleLines(coupon, valuation.lines);
  if (!eligible.length) {
    throw badRequest(
      'That coupon does not apply to anything in your cart.',
      'COUPON_NOT_APPLICABLE',
    );
  }

  const eligibleSubtotal = sumMinor(eligible.map((l) => l.lineTotalMinor));

  if (coupon.minSpendMinor > 0 && valuation.subtotalMinor < coupon.minSpendMinor) {
    throw badRequest(
      `Spend at least ৳${(coupon.minSpendMinor / 100).toFixed(0)} to use this coupon.`,
      'COUPON_MIN_SPEND',
      { minSpendMinor: coupon.minSpendMinor },
    );
  }

  if (coupon.perCustomerLimit && phone) {
    const used = await Order.countDocuments({
      'contact.phone': phone,
      'coupon.code': coupon.code,
      status: { $nin: ['cancelled', 'expired'] },
    });
    if (used >= coupon.perCustomerLimit) {
      throw badRequest('You have already used this coupon.', 'COUPON_ALREADY_USED');
    }
  }

  let discountMinor =
    coupon.type === 'percent'
      ? percentOfMinor(eligibleSubtotal, coupon.value)
      : coupon.value;

  // A percent cap, and the guarantee that a discount never exceeds the cart.
  if (coupon.type === 'percent' && coupon.maxDiscountMinor) {
    discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
  }
  discountMinor = clampMinor(Math.min(discountMinor, eligibleSubtotal));

  return {
    coupon,
    discountMinor,
    snapshot: {
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discountMinor,
    },
  };
}

function eligibleLines(coupon: ICoupon, lines: PricedLine[]): PricedLine[] {
  if (coupon.appliesTo.scope === 'all') return lines;

  if (coupon.appliesTo.scope === 'products') {
    const ids = new Set(coupon.appliesTo.productIds.map((id) => id.toString()));
    return lines.filter((l) => ids.has(l.productId));
  }

  const categoryIds = new Set(coupon.appliesTo.categoryIds.map((id) => id.toString()));
  return lines.filter((l) => l.categoryIds.some((id) => categoryIds.has(id)));
}

/**
 * Resolves the shipping zone for a district and returns its charge.
 * Falls back to the catch-all `"*"` zone, which every store must define.
 */
export async function resolveShipping(
  district: string,
  subtotalMinor: number,
): Promise<Quote['shipping']> {
  const settings = await getSettings();
  const active = settings.shippingZones
    .filter((z) => z.isActive)
    .sort((a, b) => a.position - b.position);

  if (!active.length) {
    return { zoneId: null, zoneName: 'Standard', estimate: '', amountMinor: 0 };
  }

  const needle = district.trim().toLowerCase();
  const matched =
    active.find((z) =>
      z.districts.some((d) => d !== '*' && d.trim().toLowerCase() === needle),
    ) ?? active.find((z) => z.districts.includes('*'));

  if (!matched) {
    throw badRequest(
      `We do not deliver to ${district} yet.`,
      'ZONE_UNAVAILABLE',
    );
  }

  const amountMinor = qualifiesForFreeShipping(matched, subtotalMinor)
    ? 0
    : matched.rateMinor;

  return {
    zoneId: matched._id.toString(),
    zoneName: matched.name,
    estimate: matched.estimate,
    amountMinor,
  };
}

const qualifiesForFreeShipping = (zone: IShippingZone, subtotalMinor: number): boolean =>
  zone.freeOverMinor !== null &&
  zone.freeOverMinor !== undefined &&
  subtotalMinor >= zone.freeOverMinor;

/**
 * The full quote: lines, discount, shipping, grand total.
 * `POST /checkout/quote` returns this, and order placement recomputes it.
 */
export async function buildQuote(params: {
  items: CartLineInput[];
  couponCode?: string | null;
  district?: string | null;
  phone?: string | null;
}): Promise<Quote> {
  const valuation = await valuateCart(params.items);

  if (!valuation.lines.length) {
    throw badRequest('Your cart is empty.', 'CART_EMPTY', { removed: valuation.removed });
  }

  let couponSnapshot: CouponOutcome['snapshot'] | null = null;
  let discountMinor = 0;

  if (params.couponCode) {
    const outcome = await applyCoupon(
      params.couponCode,
      valuation,
      params.phone ?? undefined,
    );
    couponSnapshot = outcome.snapshot;
    discountMinor = outcome.discountMinor;
  }

  const shipping = params.district
    ? await resolveShipping(params.district, valuation.subtotalMinor)
    : null;

  const shippingMinor = shipping?.amountMinor ?? 0;
  const grandTotalMinor = clampMinor(
    valuation.subtotalMinor - discountMinor + shippingMinor,
  );

  return {
    lines: valuation.lines,
    removed: valuation.removed,
    coupon: couponSnapshot,
    shipping,
    totals: {
      subtotalMinor: valuation.subtotalMinor,
      discountMinor,
      shippingMinor,
      grandTotalMinor,
    },
  };
}

/** Loads a product for the order snapshot, or throws if it vanished mid-checkout. */
export async function requireProduct(id: string): Promise<IProduct> {
  const product = await Product.findById(id);
  if (!product) throw notFound('Product');
  return product;
}

export type { IProductVariant };
