import { Schema, model, type Document, type Types } from 'mongoose';

export type ProductStatus = 'draft' | 'published' | 'archived';

export interface IProductImage {
  _id?: Types.ObjectId;
  publicId: string;
  url: string;
  width?: number;
  height?: number;
  alt: string;
  position: number;
}

export interface IProductVariant {
  _id: Types.ObjectId;
  sku: string;
  label: string;
  priceMinor: number;
  compareAtMinor?: number | null;
  /**
   * Sellable units. Always net of anything held at the payment gateway —
   * reserving decrements this and bumps `reserved` at the same time.
   */
  stock: number;
  /** Units held by orders sitting in `pending_payment`. Display only. */
  reserved: number;
  isDefault: boolean;
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  brandId?: Types.ObjectId | null;
  categoryIds: Types.ObjectId[];
  ingredients: string[];
  skinConcerns: string[];
  images: IProductImage[];
  variants: IProductVariant[];
  rating: { avg: number; count: number };
  status: ProductStatus;
  isFeatured: boolean;
  seo: { title?: string; description?: string };
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema<IProductImage>(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    width: Number,
    height: Number,
    // Required so a product cannot be published without accessible images.
    alt: { type: String, required: true, trim: true, maxlength: 200 },
    position: { type: Number, default: 0 },
  },
  { _id: true },
);

const variantSchema = new Schema<IProductVariant>(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    label: { type: String, required: true, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    compareAtMinor: { type: Number, min: 0, default: null },
    stock: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const productSchema = new Schema<IProduct>(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    subtitle: { type: String, trim: true, maxlength: 300 },
    description: { type: String }, // sanitised HTML, cleaned on write
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', default: null },
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    ingredients: [{ type: String, trim: true }],
    skinConcerns: [{ type: String, trim: true, lowercase: true }],
    images: { type: [imageSchema], default: [] },
    variants: {
      type: [variantSchema],
      validate: {
        validator: (v: IProductVariant[]) => v.length > 0,
        message: 'A product needs at least one variant.',
      },
    },
    rating: {
      avg: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    isFeatured: { type: Boolean, default: false },
    seo: {
      title: { type: String, trim: true, maxlength: 70 },
      description: { type: String, trim: true, maxlength: 180 },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// --- Indexes -------------------------------------------------------------

// The listing page's default query: filter by status + category, sort by newest.
// Compound so the filter and the sort are satisfied by one index scan.
productSchema.index({ status: 1, categoryIds: 1, createdAt: -1 });

// Price range filtering and price sorting.
productSchema.index({ 'variants.priceMinor': 1 });

// SKUs are unique shop-wide, not merely within one product. Sparse so a
// draft product without SKUs yet does not collide.
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });

// Search. Weighted so a title hit outranks an ingredient hit.
productSchema.index(
  { title: 'text', subtitle: 'text', ingredients: 'text', skinConcerns: 'text' },
  {
    weights: { title: 10, subtitle: 5, skinConcerns: 3, ingredients: 1 },
    name: 'product_search',
  },
);

// Storefront queries never look at archived rows; a partial index keeps them
// from paying for the dead ones.
productSchema.index(
  { isFeatured: 1, createdAt: -1 },
  { partialFilterExpression: { status: 'published' } },
);

// --- Virtuals ------------------------------------------------------------

/** Lowest live price across variants — what the listing card shows. */
productSchema.virtual('priceFromMinor').get(function (this: IProduct) {
  if (!this.variants?.length) return 0;
  return Math.min(...this.variants.map((v) => v.priceMinor));
});

/** Sellable units across all variants. `stock` is already net of reservations. */
productSchema.virtual('totalAvailable').get(function (this: IProduct) {
  if (!this.variants?.length) return 0;
  return this.variants.reduce((n, v) => n + Math.max(0, v.stock), 0);
});

productSchema.virtual('inStock').get(function (this: IProduct) {
  return this.variants?.some((v) => v.stock > 0) ?? false;
});

/** Physical units on the shelf, including those held at the payment gateway. */
productSchema.virtual('totalOnHand').get(function (this: IProduct) {
  if (!this.variants?.length) return 0;
  return this.variants.reduce((n, v) => n + v.stock + v.reserved, 0);
});

// --- Hooks ---------------------------------------------------------------

// Exactly one default variant, always. If the admin marks none, the first wins.
productSchema.pre('save', function (next) {
  if (this.variants?.length) {
    const marked = this.variants.findIndex((v) => v.isDefault);
    const keep = marked === -1 ? 0 : marked;
    this.variants.forEach((v, i) => {
      v.isDefault = i === keep;
    });
  }
  next();
});

export const Product = model<IProduct>('Product', productSchema);
