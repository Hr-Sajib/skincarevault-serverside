import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICategory extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  /** One level of nesting: Skincare -> Serums. Null for a top-level category. */
  parentId?: Types.ObjectId | null;
  image?: { publicId: string; url: string; alt: string } | null;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 500 },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    image: {
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
    position: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.index({ parentId: 1, position: 1 });

export const Category = model<ICategory>('Category', categorySchema);
