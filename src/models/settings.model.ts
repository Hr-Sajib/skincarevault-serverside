import { Schema, model, type Document, type Types } from 'mongoose';

export interface IShippingZone {
  _id: Types.ObjectId;
  name: string;
  rateMinor: number;
  /** Order subtotal above which this zone ships free. Null disables it. */
  freeOverMinor?: number | null;
  /** District names, or the literal `"*"` for the catch-all zone. */
  districts: string[];
  estimate: string;
  isActive: boolean;
  position: number;
}

// Keyed by the literal "store" rather than an ObjectId — it is a singleton.
export interface ISettings extends Document<string> {
  _id: string;
  store: {
    name: string;
    tagline?: string;
    email?: string;
    phone?: string;
    address?: string;
    facebook?: string;
    instagram?: string;
    whatsapp?: string;
  };
  shippingZones: IShippingZone[];
  payment: {
    codEnabled: boolean;
    sslcommerzEnabled: boolean;
    /** Orders below this cannot be placed at all. */
    minOrderMinor: number;
  };
  inventory: {
    lowStockThreshold: number;
    /** Show "only N left" on the product page below this count. */
    urgencyThreshold: number;
  };
  orderPrefix: string;
  announcement?: { text: string; isActive: boolean } | null;
  updatedAt: Date;
}

const shippingZoneSchema = new Schema<IShippingZone>(
  {
    name: { type: String, required: true, trim: true },
    rateMinor: { type: Number, required: true, min: 0 },
    freeOverMinor: { type: Number, default: null, min: 0 },
    districts: { type: [String], default: [] },
    estimate: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    position: { type: Number, default: 0 },
  },
  { _id: true },
);

const settingsSchema = new Schema<ISettings>(
  {
    _id: { type: String, default: 'store' },
    store: {
      name: { type: String, default: 'Skincare Vault' },
      tagline: { type: String, default: '' },
      email: String,
      phone: String,
      address: String,
      facebook: String,
      instagram: String,
      whatsapp: String,
    },
    shippingZones: { type: [shippingZoneSchema], default: [] },
    payment: {
      codEnabled: { type: Boolean, default: true },
      sslcommerzEnabled: { type: Boolean, default: true },
      minOrderMinor: { type: Number, default: 0 },
    },
    inventory: {
      lowStockThreshold: { type: Number, default: 5 },
      urgencyThreshold: { type: Number, default: 5 },
    },
    orderPrefix: { type: String, default: 'SV' },
    announcement: {
      type: new Schema(
        { text: { type: String, default: '' }, isActive: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true, _id: false },
);

export const Settings = model<ISettings>('Settings', settingsSchema);

/** The default shipping model for a Bangladesh storefront. */
export const DEFAULT_SHIPPING_ZONES = [
  {
    name: 'Inside Dhaka',
    rateMinor: 6000,
    freeOverMinor: 300000,
    districts: ['Dhaka'],
    estimate: '1-2 days',
    isActive: true,
    position: 0,
  },
  {
    name: 'Dhaka Sub-urban',
    rateMinor: 10000,
    freeOverMinor: null,
    districts: ['Gazipur', 'Narayanganj', 'Savar', 'Keraniganj', 'Narsingdi', 'Manikganj'],
    estimate: '2-3 days',
    isActive: true,
    position: 1,
  },
  {
    name: 'Outside Dhaka',
    rateMinor: 12000,
    freeOverMinor: null,
    districts: ['*'],
    estimate: '3-5 days',
    isActive: true,
    position: 2,
  },
];

/**
 * Reads the singleton, creating it with sane defaults on first call.
 * Every caller goes through here, so the document always exists.
 */
export async function getSettings(): Promise<ISettings> {
  const existing = await Settings.findById('store');
  if (existing) return existing;

  return Settings.create({
    _id: 'store',
    shippingZones: DEFAULT_SHIPPING_ZONES,
  });
}
