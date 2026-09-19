import { Schema, model, type Document, type Types } from 'mongoose';

/**
 * One row per issued refresh token. Lets us revoke a session server-side —
 * a plain stateless JWT cannot be taken back once handed out.
 */
export interface ISession extends Document {
  _id: Types.ObjectId;
  subjectId: Types.ObjectId;
  subjectType: 'customer' | 'admin';
  /** SHA-256 of the refresh token. The raw token is never stored. */
  tokenHash: string;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<ISession>({
  subjectId: { type: Schema.Types.ObjectId, required: true },
  subjectType: { type: String, enum: ['customer', 'admin'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  ip: String,
  userAgent: String,
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

// TTL index — Mongo deletes expired sessions itself, so there is no
// cleanup job to write, schedule, or forget about.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.index({ subjectId: 1, subjectType: 1 });

export const Session = model<ISession>('Session', sessionSchema);
