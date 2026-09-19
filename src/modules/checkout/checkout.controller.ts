import type { Request, Response } from 'express';
import { getSettings } from '@/models/settings.model';
import { sendResponse } from '@/utils/sendResponse';
import { valuateCart, buildQuote, applyCoupon } from '@/modules/checkout/pricing.service';

/**
 * POST /cart/validate
 *
 * The client cart holds ids and quantities only, so this is where it becomes
 * money. Returns authoritative prices plus anything that had to change —
 * a line whose product was unpublished, or a quantity trimmed to remaining
 * stock — so the cart page can say what happened rather than silently differ.
 */
export async function validateCart(req: Request, res: Response): Promise<void> {
  const valuation = await valuateCart(req.body.items);

  sendResponse(res, {
    data: {
      lines: valuation.lines,
      removed: valuation.removed,
      itemCount: valuation.itemCount,
      subtotalMinor: valuation.subtotalMinor,
      hasChanges:
        valuation.removed.length > 0 || valuation.lines.some((l) => l.adjusted),
    },
  });
}

/**
 * POST /checkout/quote
 *
 * The full money picture for a cart: discount, shipping for a district, and
 * the grand total. Writes nothing — the checkout page calls it on every
 * district or coupon change.
 */
export async function getQuote(req: Request, res: Response): Promise<void> {
  const quote = await buildQuote({
    items: req.body.items,
    couponCode: req.body.couponCode ?? null,
    district: req.body.district ?? null,
    phone: req.body.phone ?? null,
  });

  sendResponse(res, { data: quote });
}

/** POST /coupons/validate — checks a code against a cart before checkout. */
export async function validateCouponCode(req: Request, res: Response): Promise<void> {
  const valuation = await valuateCart(req.body.items);
  const outcome = await applyCoupon(req.body.code, valuation, req.body.phone);

  sendResponse(res, {
    message: `Coupon ${outcome.snapshot.code} applied.`,
    data: {
      coupon: outcome.snapshot,
      subtotalMinor: valuation.subtotalMinor,
      discountMinor: outcome.discountMinor,
    },
  });
}

/**
 * GET /checkout/config
 *
 * Shipping zones, enabled payment methods, and the minimum order value —
 * everything the checkout form needs to render without hardcoding rates
 * the admin is free to change.
 */
export async function getCheckoutConfig(_req: Request, res: Response): Promise<void> {
  const settings = await getSettings();

  sendResponse(res, {
    data: {
      shippingZones: settings.shippingZones
        .filter((z) => z.isActive)
        .sort((a, b) => a.position - b.position)
        .map((z) => ({
          id: z._id.toString(),
          name: z.name,
          rateMinor: z.rateMinor,
          freeOverMinor: z.freeOverMinor ?? null,
          districts: z.districts,
          estimate: z.estimate,
        })),
      payment: settings.payment,
      store: settings.store,
    },
  });
}
