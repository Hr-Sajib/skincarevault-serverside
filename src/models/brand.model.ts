import { Schema, model, type Document, type Types } from 'mongoose';

export interface IBrand extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  logo?: { publicId: string; url: string; alt: string } | null;
  countryOfOrigin?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const brandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 500 },
    logo: {
      type: new Schema(
        {
          publicId: { type: String, required: true },
          url: { type: String, required: true },
          alt: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    countryOfOrigin: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Brand = model<IBrand>('Brand', brandSchema);
