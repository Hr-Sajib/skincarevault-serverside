import { Schema, model, type Document, type Types } from 'mongoose';

export type CouponType = 'percent' | 'fixed';

export interface ICoupon extends Document {
  _id: Types.ObjectId;
  code: string;
  description?: string;
  type: CouponType;
  /** Percent: a whole number, 15 means 15%. Fixed: an amount in paisa. */
  value: number;
  minSpendMinor: number;
  /** Caps a percent discount. Null means uncapped. Ignored for fixed. */
  maxDiscountMinor?: number | null;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  /** Total redemptions allowed across all customers. Null means unlimited. */
  usageLimit?: number | null;
  usedCount: number;
  /** Redemptions allowed per phone number. Null means unlimited. */
  perCustomerLimit?: number | null;
  appliesTo: {
    scope: 'all' | 'categories' | 'products';
    categoryIds: Types.ObjectId[];
    productIds: Types.ObjectId[];
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 40,
    },
    description: { type: String, trim: true, maxlength: 300 },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    minSpendMinor: { type: Number, default: 0, min: 0 },
    maxDiscountMinor: { type: Number, default: null, min: 0 },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usageLimit: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    perCustomerLimit: { type: Number, default: null, min: 1 },
    appliesTo: {
      scope: { type: String, enum: ['all', 'categories', 'products'], default: 'all' },
      categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
      productIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.index({ isActive: 1, expiresAt: 1 });

// A percent coupon above 100 would pay the customer to shop.
couponSchema.pre('validate', function (next) {
  if (this.type === 'percent' && this.value > 100) {
    return next(new Error('A percent coupon cannot exceed 100.'));
  }
  if (this.startsAt && this.expiresAt && this.startsAt >= this.expiresAt) {
    return next(new Error('A coupon must expire after it starts.'));
  }
  next();
});

export const Coupon = model<ICoupon>('Coupon', couponSchema);
