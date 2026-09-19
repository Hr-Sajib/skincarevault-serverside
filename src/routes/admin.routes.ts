import { Router } from 'express';
import * as auth from '@/modules/auth/auth.controller';
import * as adminProducts from '@/modules/admin/adminProduct.controller';
import * as adminOrders from '@/modules/admin/adminOrder.controller';
import * as dashboard from '@/modules/admin/dashboard.controller';
import * as catalogue from '@/modules/admin/adminCatalogue.controller';
import * as settings from '@/modules/admin/adminSettings.controller';
import * as reviews from '@/modules/reviews/review.controller';
import { validate } from '@/middleware/validate';
import { requireAdmin, requirePermission } from '@/middleware/auth';
import { loginLimiter } from '@/middleware/rateLimit';
import * as v from '@/routes/validation';
import { paginationQuery } from '@/modules/shared/common.validation';

const router = Router();

/* -------------------------------------------------------------------- auth */

router.post('/auth/login', loginLimiter, validate({ body: v.adminLoginBody }), auth.loginAdmin);
router.post('/auth/refresh', auth.refreshAdmin);
router.post('/auth/logout', auth.logoutAdmin);

// Everything past this point requires a valid admin token. A customer token
// fails here on the audience claim, before any role is even considered.
router.use(requireAdmin);

router.get('/auth/me', auth.getAdminMe);

/* --------------------------------------------------------------- dashboard */

router.get('/dashboard', requirePermission('orders:read'), dashboard.getDashboard);

/* ------------------------------------------------------------------ orders */

router.get(
  '/orders',
  requirePermission('orders:read'),
  validate({ query: v.adminOrderListQuery }),
  adminOrders.listOrders,
);
// Declared before `/orders/:id` so "export" is not read as an id.
router.get('/orders/export', requirePermission('orders:read'), adminOrders.exportOrders);
router.get(
  '/orders/:id',
  requirePermission('orders:read'),
  validate({ params: v.idParam }),
  adminOrders.getOrder,
);
router.patch(
  '/orders/:id',
  requirePermission('orders:write'),
  validate({ params: v.idParam, body: v.updateOrderBody }),
  adminOrders.updateOrder,
);
router.post(
  '/orders/:id/cancel',
  requirePermission('orders:write'),
  validate({ params: v.idParam }),
  adminOrders.cancelOrder,
);

/* ---------------------------------------------------------------- products */

router.get(
  '/products',
  requirePermission('products:read'),
  validate({ query: v.adminListQuery }),
  adminProducts.listProducts,
);
router.post(
  '/products',
  requirePermission('products:write'),
  validate({ body: v.createProductBody }),
  adminProducts.createProduct,
);
router.post(
  '/products/bulk',
  requirePermission('products:write'),
  validate({ body: v.bulkProductBody }),
  adminProducts.bulkUpdate,
);
router.get(
  '/products/:id',
  requirePermission('products:read'),
  validate({ params: v.idParam }),
  adminProducts.getProduct,
);
router.patch(
  '/products/:id',
  requirePermission('products:write'),
  validate({ params: v.idParam, body: v.updateProductBody }),
  adminProducts.updateProduct,
);
router.delete(
  '/products/:id',
  requirePermission('products:write'),
  validate({ params: v.idParam }),
  adminProducts.archiveProduct,
);
router.post(
  '/products/:id/images',
  requirePermission('products:write'),
  validate({ params: v.idParam, body: v.addImagesBody }),
  adminProducts.addImages,
);
router.patch(
  '/products/:id/images',
  requirePermission('products:write'),
  validate({ params: v.idParam, body: v.updateImagesBody }),
  adminProducts.updateImages,
);
router.delete(
  '/products/:id/images/:imageId',
  requirePermission('products:write'),
  adminProducts.deleteImage,
);
router.patch(
  '/products/:id/stock',
  requirePermission('products:write'),
  validate({ params: v.idParam, body: v.adjustStockBody }),
  adminProducts.adjustStock,
);

/* -------------------------------------------------- categories and brands */

router.post(
  '/categories',
  requirePermission('categories:write'),
  validate({ body: v.categoryBody }),
  catalogue.createCategory,
);
router.patch('/categories/reorder', requirePermission('categories:write'), catalogue.reorderCategories);
router.patch(
  '/categories/:id',
  requirePermission('categories:write'),
  validate({ params: v.idParam, body: v.categoryBody.partial() }),
  catalogue.updateCategory,
);
router.delete(
  '/categories/:id',
  requirePermission('categories:write'),
  validate({ params: v.idParam }),
  catalogue.deleteCategory,
);

router.post(
  '/brands',
  requirePermission('brands:write'),
  validate({ body: v.brandBody }),
  catalogue.createBrand,
);
router.patch(
  '/brands/:id',
  requirePermission('brands:write'),
  validate({ params: v.idParam, body: v.brandBody.partial() }),
  catalogue.updateBrand,
);
router.delete(
  '/brands/:id',
  requirePermission('brands:write'),
  validate({ params: v.idParam }),
  catalogue.deleteBrand,
);

/* ----------------------------------------------------------------- coupons */

router.get(
  '/coupons',
  requirePermission('coupons:write'),
  validate({ query: paginationQuery }),
  catalogue.listCoupons,
);
router.post(
  '/coupons',
  requirePermission('coupons:write'),
  validate({ body: v.couponBody }),
  catalogue.createCoupon,
);
router.patch(
  '/coupons/:id',
  requirePermission('coupons:write'),
  validate({ params: v.idParam, body: v.updateCouponBody }),
  catalogue.updateCoupon,
);
router.delete(
  '/coupons/:id',
  requirePermission('coupons:write'),
  validate({ params: v.idParam }),
  catalogue.deleteCoupon,
);

/* ----------------------------------------------------------------- reviews */

router.get(
  '/reviews',
  requirePermission('reviews:moderate'),
  validate({ query: paginationQuery }),
  reviews.listReviews,
);
router.patch(
  '/reviews/:id',
  requirePermission('reviews:moderate'),
  validate({ params: v.idParam, body: v.moderateReviewBody }),
  reviews.moderateReview,
);
router.delete(
  '/reviews/:id',
  requirePermission('reviews:moderate'),
  validate({ params: v.idParam }),
  reviews.deleteReview,
);

/* ----------------------------------------------------- settings and staff */

router.get('/settings', requirePermission('settings:write'), settings.getStoreSettings);
router.patch(
  '/settings',
  requirePermission('settings:write'),
  validate({ body: v.settingsBody }),
  settings.updateStoreSettings,
);

// Staff management is owner-only, which `ROLE_PERMISSIONS` expresses by
// granting `staff:write` to nobody but the wildcard owner role.
router.get('/staff', requirePermission('staff:write'), settings.listStaff);
router.post(
  '/staff',
  requirePermission('staff:write'),
  validate({ body: v.staffBody }),
  settings.createStaff,
);
router.patch(
  '/staff/:id',
  requirePermission('staff:write'),
  validate({ params: v.idParam, body: v.updateStaffBody }),
  settings.updateStaff,
);
router.delete(
  '/staff/:id',
  requirePermission('staff:write'),
  validate({ params: v.idParam }),
  settings.deleteStaff,
);

router.get('/audit', requirePermission('audit:read'), settings.listAuditLog);

/* ----------------------------------------------------------------- uploads */

router.post(
  '/uploads/signature',
  requirePermission('products:write'),
  validate({ body: v.uploadSignatureBody }),
  catalogue.getUploadSignature,
);

export default router;
