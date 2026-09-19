import { Router } from 'express';
import * as products from '@/modules/products/product.controller';
import * as checkout from '@/modules/checkout/checkout.controller';
import * as orders from '@/modules/orders/order.controller';
import * as reviews from '@/modules/reviews/review.controller';
import * as auth from '@/modules/auth/auth.controller';
import * as catalogue from '@/modules/admin/adminCatalogue.controller';
import { validate } from '@/middleware/validate';
import { attachCustomerIfPresent, requireCustomer } from '@/middleware/auth';
import {
  couponLimiter,
  loginLimiter,
  orderLimiter,
  reviewLimiter,
  trackingLimiter,
} from '@/middleware/rateLimit';
import * as v from '@/routes/validation';
import { paginationQuery } from '@/modules/shared/common.validation';

const router = Router();

/* -------------------------------------------------------------- catalogue */

router.get('/products', validate({ query: v.listProductsQuery }), products.listProducts);
router.get('/products/rails', products.getStorefrontRails);
router.get(
  '/products/:slug/reviews',
  validate({ params: v.slugParam, query: paginationQuery }),
  reviews.listProductReviews,
);
router.get('/products/:slug', validate({ params: v.slugParam }), products.getProductBySlug);

router.get('/categories', catalogue.getCategoryTree);
router.get('/brands', catalogue.listBrands);

/* ------------------------------------------------------- cart & checkout */

router.post('/cart/validate', validate({ body: v.validateCartBody }), checkout.validateCart);
router.get('/checkout/config', checkout.getCheckoutConfig);
router.post('/checkout/quote', validate({ body: v.quoteBody }), checkout.getQuote);
router.post(
  '/coupons/validate',
  couponLimiter,
  validate({ body: v.couponValidateBody }),
  checkout.validateCouponCode,
);

/* ------------------------------------------------------------------ orders */

// `attachCustomerIfPresent` never rejects, which is what lets a guest and a
// signed-in customer use the same endpoint.
router.post(
  '/orders',
  orderLimiter,
  attachCustomerIfPresent,
  validate({ body: v.createOrderBody }),
  orders.createOrder,
);
router.get('/orders/track', trackingLimiter, orders.trackOrder);
router.get('/orders/:orderNo', trackingLimiter, attachCustomerIfPresent, orders.getOrderByNumber);

/* ----------------------------------------------------------------- reviews */

router.post(
  '/reviews',
  reviewLimiter,
  attachCustomerIfPresent,
  validate({ body: v.createReviewBody }),
  reviews.createReview,
);

/* -------------------------------------------------------------------- auth */

router.post('/auth/register', loginLimiter, validate({ body: v.registerBody }), auth.registerCustomer);
router.post('/auth/login', loginLimiter, validate({ body: v.loginBody }), auth.loginCustomer);
router.post('/auth/logout', auth.logoutCustomer);
router.post('/auth/refresh', auth.refreshCustomer);
router.get('/auth/me', requireCustomer, auth.getMe);
router.get('/account/orders', requireCustomer, orders.listMyOrders);

export default router;
