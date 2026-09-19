import { z } from 'zod';
import { ORDER_STATUSES } from '@/models/order.model';
import { ADMIN_ROLES } from '@/models/adminUser.model';
import {
  bdPhone,
  cartItems,
  cartLine,
  contactDetails,
  imagePayload,
  objectId,
  paginationQuery,
  shippingAddress,
} from '@/modules/shared/common.validation';

/* ------------------------------------------------------------------ public */

export const listProductsQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().optional(),
  brand: objectId.optional(),
  concern: z.string().trim().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'rating', 'relevance']).optional(),
  inStock: z.coerce.boolean().optional(),
  featured: z.coerce.boolean().optional(),
});

export const slugParam = z.object({ slug: z.string().min(1).max(200) });
export const idParam = z.object({ id: objectId });

// An empty cart is a legitimate thing to validate, so this one allows [].
export const validateCartBody = z.object({
  items: z.array(cartLine).max(50).default([]),
});

export const quoteBody = z.object({
  items: cartItems,
  couponCode: z.string().trim().max(40).optional().nullable(),
  district: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
});

export const couponValidateBody = z.object({
  code: z.string().trim().min(1, 'Enter a coupon code.').max(40),
  items: cartItems,
  phone: z.string().trim().optional(),
});

export const createOrderBody = z.object({
  items: cartItems,
  contact: contactDetails,
  shipping: shippingAddress,
  couponCode: z.string().trim().max(40).optional().nullable(),
  paymentMethod: z.enum(['cod', 'sslcommerz']),
  // What the client displayed. A mismatch stops the order with a 409.
  expectedTotalMinor: z.number().int().min(0).optional().nullable(),
});

export const createReviewBody = z.object({
  productId: objectId,
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, 'Tell us a little more.').max(2000),
  customerName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().optional(),
});

/* -------------------------------------------------------------------- auth */

export const registerBody = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: bdPhone,
  email: z.string().email().optional().or(z.literal('')),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(128, 'That password is too long.'),
});

export const loginBody = z.object({
  phone: bdPhone,
  password: z.string().min(1, 'Enter your password.'),
});

export const adminLoginBody = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/* ------------------------------------------------------------------- admin */

const variantBody = z.object({
  _id: objectId.optional(),
  sku: z.string().trim().min(1, 'Every variant needs a SKU.').max(60),
  label: z.string().trim().min(1, 'Every variant needs a label.').max(60),
  priceMinor: z.number().int().min(0, 'Price cannot be negative.'),
  compareAtMinor: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).default(0),
  isDefault: z.boolean().default(false),
});

export const createProductBody = z.object({
  title: z.string().trim().min(2).max(200),
  slug: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(300).optional(),
  description: z.string().max(20000).optional(),
  brandId: objectId.nullable().optional(),
  categoryIds: z.array(objectId).default([]),
  ingredients: z.array(z.string().trim().max(120)).default([]),
  skinConcerns: z.array(z.string().trim().max(60)).default([]),
  images: z.array(imagePayload).default([]),
  variants: z.array(variantBody).min(1, 'Add at least one variant.'),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  seo: z
    .object({
      title: z.string().trim().max(70).optional(),
      description: z.string().trim().max(180).optional(),
    })
    .optional(),
});

export const updateProductBody = createProductBody.partial();

export const addImagesBody = z.object({
  images: z.array(imagePayload).min(1, 'Nothing to add.'),
});

export const updateImagesBody = z.object({
  images: z
    .array(
      z.object({
        _id: objectId,
        position: z.number().int().min(0).optional(),
        alt: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .min(1),
});

export const adjustStockBody = z.object({
  variantId: objectId,
  stock: z.number().int().min(0, 'Stock cannot be negative.'),
  reason: z.string().trim().min(2, 'Give a short reason.').max(200),
});

export const bulkProductBody = z.object({
  ids: z.array(objectId).min(1, 'Select at least one product.').max(200),
  action: z.enum(['publish', 'unpublish', 'archive', 'feature', 'unfeature']),
});

export const adminListQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().optional(),
  category: objectId.optional(),
  lowStock: z.string().optional(),
});

export const adminOrderListQuery = paginationQuery.extend({
  status: z.enum([...ORDER_STATUSES, 'all']).optional(),
  method: z.enum(['cod', 'sslcommerz']).optional(),
  phone: z.string().trim().optional(),
  q: z.string().trim().max(60).optional(),
  from: z.string().datetime().or(z.string().date()).optional(),
  to: z.string().datetime().or(z.string().date()).optional(),
});

export const updateOrderBody = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  note: z.string().trim().max(500).optional(),
  courier: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  consignmentId: z.string().trim().max(100).optional(),
  adminNote: z.string().trim().max(1000).optional(),
});

export const categoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  parentId: objectId.nullable().optional(),
  image: z
    .object({
      publicId: z.string(),
      url: z.string().url(),
      alt: z.string().min(1),
    })
    .nullable()
    .optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const brandBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  logo: z
    .object({ publicId: z.string(), url: z.string().url(), alt: z.string().min(1) })
    .nullable()
    .optional(),
  countryOfOrigin: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

export const couponBody = z
  .object({
    code: z.string().trim().min(3, 'Use at least 3 characters.').max(40),
    description: z.string().trim().max(300).optional(),
    type: z.enum(['percent', 'fixed']),
    value: z.number().min(0),
    minSpendMinor: z.number().int().min(0).default(0),
    maxDiscountMinor: z.number().int().min(0).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    usageLimit: z.number().int().min(1).nullable().optional(),
    perCustomerLimit: z.number().int().min(1).nullable().optional(),
    appliesTo: z
      .object({
        scope: z.enum(['all', 'categories', 'products']).default('all'),
        categoryIds: z.array(objectId).default([]),
        productIds: z.array(objectId).default([]),
      })
      .default({ scope: 'all', categoryIds: [], productIds: [] }),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'percent' || c.value <= 100, {
    message: 'A percent coupon cannot exceed 100.',
    path: ['value'],
  })
  .refine((c) => !c.startsAt || !c.expiresAt || c.startsAt < c.expiresAt, {
    message: 'The end date must come after the start date.',
    path: ['expiresAt'],
  });

export const updateCouponBody = z.object({
  description: z.string().trim().max(300).optional(),
  minSpendMinor: z.number().int().min(0).optional(),
  maxDiscountMinor: z.number().int().min(0).nullable().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const moderateReviewBody = z.object({
  status: z.enum(['approved', 'rejected']),
});

export const staffBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10, 'Staff passwords need at least 10 characters.').max(128),
  role: z.enum(ADMIN_ROLES),
});

export const updateStaffBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ADMIN_ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(10).max(128).optional(),
});

export const settingsBody = z.object({
  store: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      tagline: z.string().trim().max(200).optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().trim().max(30).optional(),
      address: z.string().trim().max(300).optional(),
      facebook: z.string().trim().max(200).optional(),
      instagram: z.string().trim().max(200).optional(),
      whatsapp: z.string().trim().max(30).optional(),
    })
    .optional(),
  shippingZones: z
    .array(
      z.object({
        _id: objectId.optional(),
        name: z.string().trim().min(1).max(80),
        rateMinor: z.number().int().min(0),
        freeOverMinor: z.number().int().min(0).nullable().optional(),
        districts: z.array(z.string().trim().min(1)).min(1),
        estimate: z.string().trim().max(60).default(''),
        isActive: z.boolean().default(true),
        position: z.number().int().min(0).default(0),
      }),
    )
    .optional(),
  payment: z
    .object({
      codEnabled: z.boolean().optional(),
      sslcommerzEnabled: z.boolean().optional(),
      minOrderMinor: z.number().int().min(0).optional(),
    })
    .optional(),
  inventory: z
    .object({
      lowStockThreshold: z.number().int().min(0).optional(),
      urgencyThreshold: z.number().int().min(0).optional(),
    })
    .optional(),
  orderPrefix: z.string().trim().min(1).max(6).optional(),
  announcement: z
    .object({ text: z.string().trim().max(200), isActive: z.boolean() })
    .nullable()
    .optional(),
});

export const uploadSignatureBody = z.object({
  folder: z.enum(['products', 'categories', 'brands', 'reviews']).default('products'),
});
