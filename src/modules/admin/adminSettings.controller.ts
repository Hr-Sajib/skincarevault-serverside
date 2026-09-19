import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AdminUser } from '@/models/adminUser.model';
import { AuditLog } from '@/models/auditLog.model';
import { Settings, getSettings } from '@/models/settings.model';
import { sendResponse, buildMeta } from '@/utils/sendResponse';
import { badRequest, notFound } from '@/utils/AppError';
import { recordAudit } from '@/middleware/audit';
import { hashPassword } from '@/modules/auth/auth.service';
import { revokeAllSessions } from '@/modules/auth/auth.service';

/* ---------------------------------------------------------------- settings */

/** GET /admin/settings */
export async function getStoreSettings(_req: Request, res: Response): Promise<void> {
  sendResponse(res, { data: await getSettings() });
}

/**
 * PATCH /admin/settings
 *
 * Shipping rates, the COD toggle, and thresholds all live here, so changing
 * a delivery charge is an edit rather than a deploy.
 */
export async function updateStoreSettings(req: Request, res: Response): Promise<void> {
  const before = await getSettings();

  // Every store needs a catch-all zone, or an order from an unlisted district
  // has nowhere to land.
  if (Array.isArray(req.body.shippingZones)) {
    const hasCatchAll = req.body.shippingZones.some(
      (z: { districts?: string[]; isActive?: boolean }) =>
        z.isActive !== false && z.districts?.includes('*'),
    );
    if (!hasCatchAll) {
      throw badRequest(
        'Keep one active zone with districts set to "*" so every district is covered.',
        'NO_CATCHALL_ZONE',
      );
    }
  }

  const settings = await Settings.findByIdAndUpdate(
    'store',
    { $set: req.body },
    { new: true, upsert: true, runValidators: true },
  );

  recordAudit(req, {
    action: 'settings.update',
    entity: 'Settings',
    entityId: 'store',
    before: { payment: before.payment, shippingZones: before.shippingZones },
    after: { payment: settings?.payment, shippingZones: settings?.shippingZones },
  });

  sendResponse(res, { message: 'Settings saved.', data: settings });
}

/* ------------------------------------------------------------------- staff */

/** GET /admin/staff — owner only. */
export async function listStaff(_req: Request, res: Response): Promise<void> {
  const staff = await AdminUser.find()
    .select('name email role isActive lastLoginAt createdAt')
    .sort({ createdAt: 1 });
  sendResponse(res, { data: staff });
}

/** POST /admin/staff */
export async function createStaff(req: Request, res: Response): Promise<void> {
  const { name, email, password, role } = req.body;

  const existing = await AdminUser.findOne({ email: email.toLowerCase() });
  if (existing) throw badRequest('An account with that email already exists.', 'EMAIL_TAKEN');

  const admin = await AdminUser.create({
    name,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    role,
  });

  recordAudit(req, {
    action: 'staff.create',
    entity: 'AdminUser',
    entityId: admin._id,
    after: { email: admin.email, role: admin.role },
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: `${admin.name} can now sign in.`,
    data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
  });
}

/** PATCH /admin/staff/:id */
export async function updateStaff(req: Request, res: Response): Promise<void> {
  const admin = await AdminUser.findById(req.params.id);
  if (!admin) throw notFound('Staff account');

  const { name, role, isActive, password } = req.body;

  // Locking yourself out of your own store is never the intent.
  if (admin._id.toString() === req.admin!.id) {
    if (isActive === false) {
      throw badRequest('You cannot deactivate your own account.', 'SELF_DEACTIVATE');
    }
    if (role && role !== admin.role) {
      throw badRequest('You cannot change your own role.', 'SELF_ROLE_CHANGE');
    }
  }

  // The last active owner must stay an active owner.
  const isDemotion = role !== undefined && role !== 'owner';
  const isDeactivation = isActive === false;
  if (admin.role === 'owner' && (isDemotion || isDeactivation)) {
    const owners = await AdminUser.countDocuments({ role: 'owner', isActive: true });
    if (owners <= 1) {
      throw badRequest('The store needs at least one active owner.', 'LAST_OWNER');
    }
  }

  const before = { role: admin.role, isActive: admin.isActive };

  if (name !== undefined) admin.name = name;
  if (role !== undefined) admin.role = role;
  if (isActive !== undefined) admin.isActive = isActive;
  if (password) admin.passwordHash = await hashPassword(password);

  await admin.save();

  // A deactivated account or a changed password must not keep a live session.
  if (isActive === false || password) {
    await revokeAllSessions(admin._id.toString(), 'admin');
  }

  recordAudit(req, {
    action: 'staff.update',
    entity: 'AdminUser',
    entityId: admin._id,
    before,
    after: { role: admin.role, isActive: admin.isActive, passwordChanged: Boolean(password) },
  });

  sendResponse(res, {
    message: `${admin.name} updated.`,
    data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, isActive: admin.isActive },
  });
}

/** DELETE /admin/staff/:id */
export async function deleteStaff(req: Request, res: Response): Promise<void> {
  if (req.params.id === req.admin!.id) {
    throw badRequest('You cannot delete your own account.', 'SELF_DELETE');
  }

  const admin = await AdminUser.findById(req.params.id);
  if (!admin) throw notFound('Staff account');

  if (admin.role === 'owner') {
    const owners = await AdminUser.countDocuments({ role: 'owner', isActive: true });
    if (owners <= 1) {
      throw badRequest('The store needs at least one active owner.', 'LAST_OWNER');
    }
  }

  await admin.deleteOne();
  await revokeAllSessions(admin._id.toString(), 'admin');

  recordAudit(req, {
    action: 'staff.delete',
    entity: 'AdminUser',
    entityId: admin._id,
    before: { email: admin.email, role: admin.role },
  });

  sendResponse(res, { message: `${admin.name} removed.`, data: null });
}

/* --------------------------------------------------------------- audit log */

/** GET /admin/audit */
export async function listAuditLog(req: Request, res: Response): Promise<void> {
  const { page = 1, limit = 50 } = req.query as unknown as { page: number; limit: number };
  const { adminId, entity, action } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};
  if (adminId) filter.adminId = adminId;
  if (entity) filter.entity = entity;
  if (action) filter.action = action;

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  sendResponse(res, { data: items, meta: buildMeta(page, limit, total) });
}
