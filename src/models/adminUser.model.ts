import { Schema, model, type Document, type Types } from 'mongoose';

export const ADMIN_ROLES = ['owner', 'admin', 'staff'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface IAdminUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: 'staff' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const AdminUser = model<IAdminUser>('AdminUser', adminUserSchema);

/**
 * What each role may do. Checked in route middleware, never only in the UI.
 *
 *  owner  — everything, including managing other staff accounts
 *  admin  — everything except staff management
 *  staff  — orders only; cannot touch catalogue, pricing, or settings
 */
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  owner: ['*'],
  admin: [
    'orders:read',
    'orders:write',
    'products:read',
    'products:write',
    'categories:write',
    'brands:write',
    'coupons:write',
    'reviews:moderate',
    'settings:write',
    'audit:read',
  ],
  staff: ['orders:read', 'orders:write', 'products:read'],
};

export function roleCan(role: AdminRole, permission: string): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return granted.includes('*') || granted.includes(permission);
}
