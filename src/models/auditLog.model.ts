import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  adminName: string;
  action: string; // 'product.update', 'order.cancel', ...
  entity: string; // 'Product', 'Order', ...
  entityId?: Types.ObjectId | string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  at: Date;
}

const auditLogSchema = new Schema<IAuditLog>({
  adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  // Denormalised so the log still reads correctly after a staff account is deleted.
  adminName: { type: String, required: true },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.Mixed, default: null },
  before: { type: Schema.Types.Mixed },
  after: { type: Schema.Types.Mixed },
  ip: String,
  userAgent: String,
  at: { type: Date, default: Date.now },
});

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ adminId: 1, at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
