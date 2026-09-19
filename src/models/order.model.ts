import { Schema, model, type Document, type Types } from 'mongoose';

export const ORDER_STATUSES = [
  'pending', // COD order awaiting confirmation
  'pending_payment', // gateway order, customer is at SSLCommerz right now
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
  'expired', // gateway order abandoned; reservation released by the sweep job
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'initiated',
  'paid',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentMethod = 'cod' | 'sslcommerz';

/**
 * A line item is a *snapshot*, not a reference. Title, variant label, image
 * and unit price are copied in at order time, so renaming a product or
 * raising its price never rewrites a historic invoice.
 */
export interface IOrderItem {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  sku: string;
  title: string;
  variantLabel: string;
  image?: { url: string; alt: string } | null;
  unitPriceMinor: number;
  qty: number;
  lineTotalMinor: number;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  orderNo: string;
  customerId?: Types.ObjectId | null;
  items: IOrderItem[];
  contact: { name: string; phone: string; email?: string };
  shipping: {
    address1: string;
    address2?: string;
    area?: string;
    city: string;
    district: string;
    division?: string;
    postcode?: string;
    zoneId?: Types.ObjectId | null;
    zoneName?: string;
    note?: string;
  };
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    shippingMinor: number;
    grandTotalMinor: number;
  };
  coupon?: {
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    discountMinor: number;
  } | null;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    tranId?: string | null;
    valId?: string | null;
    cardType?: string;
    bankTranId?: string;
    paidAt?: Date | null;
    /** Full validated gateway response, kept verbatim for chargeback disputes. */
    raw?: Record<string, unknown>;
  };
  /** When a gateway order's stock reservation lapses. Null once paid. */
  reservationExpiresAt?: Date | null;
  status: OrderStatus;
  statusHistory: Array<{
    status: OrderStatus;
    at: Date;
    byAdminId?: Types.ObjectId | null;
    note?: string;
  }>;
  fulfilment?: {
    courier?: string;
    trackingNumber?: string;
    consignmentId?: string;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  };
  adminNote?: string;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    title: { type: String, required: true },
    variantLabel: { type: String, required: true },
    image: {
      type: new Schema(
        { url: { type: String, required: true }, alt: { type: String, default: '' } },
        { _id: false },
      ),
      default: null,
    },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
    lineTotalMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNo: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },

    items: {
      type: [orderItemSchema],
      validate: {
        validator: (v: IOrderItem[]) => v.length > 0,
        message: 'An order needs at least one item.',
      },
    },

    contact: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },

    shipping: {
      address1: { type: String, required: true, trim: true },
      address2: { type: String, trim: true },
      area: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      district: { type: String, required: true, trim: true },
      division: { type: String, trim: true },
      postcode: { type: String, trim: true },
      zoneId: { type: Schema.Types.ObjectId, default: null },
      zoneName: { type: String },
      note: { type: String, trim: true, maxlength: 500 },
    },

    totals: {
      subtotalMinor: { type: Number, required: true, min: 0 },
      discountMinor: { type: Number, required: true, min: 0, default: 0 },
      shippingMinor: { type: Number, required: true, min: 0, default: 0 },
      grandTotalMinor: { type: Number, required: true, min: 0 },
    },

    coupon: {
      type: new Schema(
        {
          code: { type: String, required: true },
          type: { type: String, enum: ['percent', 'fixed'], required: true },
          value: { type: Number, required: true },
          discountMinor: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },

    payment: {
      method: { type: String, enum: ['cod', 'sslcommerz'], required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'unpaid' },
      tranId: { type: String, default: null },
      valId: { type: String, default: null },
      cardType: String,
      bankTranId: String,
      paidAt: { type: Date, default: null },
      raw: { type: Schema.Types.Mixed },
    },

    reservationExpiresAt: { type: Date, default: null },

    status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    statusHistory: [
      {
        status: { type: String, enum: ORDER_STATUSES, required: true },
        at: { type: Date, default: Date.now },
        byAdminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
        note: String,
        _id: false,
      },
    ],

    fulfilment: {
      courier: String,
      trackingNumber: String,
      consignmentId: String,
      shippedAt: { type: Date, default: null },
      deliveredAt: { type: Date, default: null },
    },

    adminNote: { type: String, maxlength: 1000 },
    placedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// --- Indexes -------------------------------------------------------------

// The admin orders list is always filtered by status and sorted by recency.
orderSchema.index({ status: 1, placedAt: -1 });

// Guest order tracking, and "has this number ordered before".
orderSchema.index({ 'contact.phone': 1, placedAt: -1 });

// IDEMPOTENCY. SSLCommerz posts to both the success URL and the IPN URL, they
// race, and either can arrive twice. A unique index on the gateway's own id
// makes a duplicate write impossible. Partial, because the many unpaid and COD
// orders all have a null valId and would otherwise collide with each other.
orderSchema.index(
  { 'payment.valId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'payment.valId': { $type: 'string' } },
  },
);

// Our own transaction id, looked up when a callback arrives.
orderSchema.index(
  { 'payment.tranId': 1 },
  { partialFilterExpression: { 'payment.tranId': { $type: 'string' } } },
);

// The stock-release sweep scans exactly this.
orderSchema.index(
  { status: 1, reservationExpiresAt: 1 },
  { partialFilterExpression: { status: 'pending_payment' } },
);

orderSchema.index({ customerId: 1, placedAt: -1 });

export const Order = model<IOrder>('Order', orderSchema);
