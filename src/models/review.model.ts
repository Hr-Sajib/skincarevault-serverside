import { Schema, model, type Document, type Types } from 'mongoose';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface IReview extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  customerId?: Types.ObjectId | null;
  /** Present when the reviewer actually bought it — earns the verified badge. */
  orderId?: Types.ObjectId | null;
  customerName: string;
  rating: number;
  title?: string;
  body: string;
  images: Array<{ publicId: string; url: string; alt: string }>;
  status: ReviewStatus;
  moderatedBy?: Types.ObjectId | null;
  moderatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    customerName: { type: String, required: true, trim: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    images: {
      type: [
        new Schema(
          {
            publicId: { type: String, required: true },
            url: { type: String, required: true },
            alt: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    moderatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Approved reviews on a product page, newest first.
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });

// The admin moderation queue.
reviewSchema.index({ status: 1, createdAt: -1 });

// One review per customer per product, for signed-in customers only.
reviewSchema.index(
  { productId: 1, customerId: 1 },
  {
    unique: true,
    partialFilterExpression: { customerId: { $type: 'objectId' } },
  },
);

export const Review = model<IReview>('Review', reviewSchema);
