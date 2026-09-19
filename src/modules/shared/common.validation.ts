import { z } from 'zod';
import { Types } from 'mongoose';
import { normaliseBdPhone } from '@/utils/text';

export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'Not a valid id.' });

/** Accepts every shape a BD customer might type, stores one canonical form. */
export const bdPhone = z
  .string()
  .min(1, 'Phone number is required.')
  .transform((v, ctx) => {
    const normalised = normaliseBdPhone(v);
    if (!normalised) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid Bangladeshi mobile number, e.g. 01712345678.',
      });
      return z.NEVER;
    }
    return normalised;
  });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const cartLine = z.object({
  productId: objectId,
  variantId: objectId,
  qty: z.coerce.number().int().min(1).max(99),
});

export const cartItems = z
  .array(cartLine)
  .min(1, 'Your cart is empty.')
  .max(50, 'That is too many different items for one order.');

export const shippingAddress = z.object({
  address1: z.string().min(5, 'Enter a street address.').max(200),
  address2: z.string().max(200).optional(),
  area: z.string().max(100).optional(),
  city: z.string().min(1, 'City is required.').max(100),
  district: z.string().min(1, 'District is required.').max(100),
  division: z.string().max(100).optional(),
  postcode: z.string().max(10).optional(),
  note: z.string().max(500).optional(),
});

export const contactDetails = z.object({
  name: z.string().min(2, 'Enter your full name.').max(120),
  phone: bdPhone,
  email: z.string().email('Enter a valid email address.').optional().or(z.literal('')),
});

export const imagePayload = z.object({
  publicId: z.string().min(1),
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().min(1, 'Every image needs alt text.').max(200),
  position: z.number().int().min(0).default(0),
});
