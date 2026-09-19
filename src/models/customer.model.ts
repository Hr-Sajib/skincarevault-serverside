import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAddress {
  _id: Types.ObjectId;
  label?: string;
  name: string;
  phone: string;
  address1: string;
  address2?: string;
  area?: string;
  city: string;
  district: string;
  division?: string;
  postcode?: string;
}

export interface ICustomer extends Document {
  _id: Types.ObjectId;
  name: string;
  /** The unique identity. BD shoppers reliably give a phone, not an email. */
  phone: string;
  email?: string | null;
  passwordHash?: string | null;
  addresses: IAddress[];
  defaultAddressId?: Types.ObjectId | null;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address1: { type: String, required: true, trim: true },
    address2: { type: String, trim: true },
    area: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    division: { type: String, trim: true },
    postcode: { type: String, trim: true },
  },
  { _id: true },
);

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: null },
    // Never selected by default, so it cannot leak through a careless find().
    passwordHash: { type: String, default: null, select: false },
    addresses: { type: [addressSchema], default: [] },
    defaultAddressId: { type: Schema.Types.ObjectId, default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Email is optional, so uniqueness applies only to the rows that have one.
customerSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

export const Customer = model<ICustomer>('Customer', customerSchema);
