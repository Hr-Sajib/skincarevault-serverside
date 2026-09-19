import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Customer } from '@/models/customer.model';
import { AdminUser } from '@/models/adminUser.model';
import { sendResponse } from '@/utils/sendResponse';
import { badRequest, unauthorized } from '@/utils/AppError';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  verifyRefreshToken,
} from '@/lib/tokens';
import {
  hashPassword,
  issueSession,
  revokeSession,
  sessionExists,
  verifyPassword,
} from '@/modules/auth/auth.service';
import { logger } from '@/lib/logger';

/* ---------------------------------------------------------------- customer */

/** POST /auth/register */
export async function registerCustomer(req: Request, res: Response): Promise<void> {
  const { name, phone, email, password } = req.body;

  const existing = await Customer.findOne({ phone });
  if (existing) {
    throw badRequest('An account with that phone number already exists.', 'PHONE_TAKEN');
  }

  const customer = await Customer.create({
    name,
    phone,
    email: email || null,
    passwordHash: await hashPassword(password),
  });

  await issueSession(req, res, 'customer', {
    sub: customer._id.toString(),
    aud: 'customer',
    name: customer.name,
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    message: 'Welcome to Skincare Vault.',
    data: publicCustomer(customer),
  });
}

/** POST /auth/login */
export async function loginCustomer(req: Request, res: Response): Promise<void> {
  const { phone, password } = req.body;

  const customer = await Customer.findOne({ phone }).select('+passwordHash');

  // One message for both branches, so the endpoint cannot be used to
  // discover which phone numbers have accounts.
  const invalid = unauthorized('That phone number or password is incorrect.');

  if (!customer?.passwordHash || !customer.isActive) throw invalid;
  if (!(await verifyPassword(customer.passwordHash, password))) throw invalid;

  customer.lastLoginAt = new Date();
  await customer.save();

  await issueSession(req, res, 'customer', {
    sub: customer._id.toString(),
    aud: 'customer',
    name: customer.name,
  });

  sendResponse(res, { message: 'Signed in.', data: publicCustomer(customer) });
}

/** POST /auth/logout */
export async function logoutCustomer(req: Request, res: Response): Promise<void> {
  await revokeSession(req.cookies?.[REFRESH_COOKIE.customer]);
  clearAuthCookies(res, 'customer');
  sendResponse(res, { message: 'Signed out.', data: null });
}

/** GET /auth/me */
export async function getMe(req: Request, res: Response): Promise<void> {
  const customer = await Customer.findById(req.customer!.id);
  if (!customer) throw unauthorized();
  sendResponse(res, { data: publicCustomer(customer) });
}

/** POST /auth/refresh — trades a valid refresh token for a fresh access token. */
export async function refreshCustomer(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE.customer];
  if (!token) throw unauthorized('Your session has expired. Please sign in again.');

  const { sub } = verifyRefreshToken(token, 'customer');

  // A signature alone is not enough — the session must still exist, which is
  // what makes a sign-out on another device take effect here.
  if (!(await sessionExists(token))) {
    clearAuthCookies(res, 'customer');
    throw unauthorized('Your session has ended. Please sign in again.');
  }

  const customer = await Customer.findById(sub);
  if (!customer?.isActive) throw unauthorized();

  // Rotation: the old session row is dropped as the new one is written.
  await revokeSession(token);
  await issueSession(req, res, 'customer', {
    sub: customer._id.toString(),
    aud: 'customer',
    name: customer.name,
  });

  sendResponse(res, { data: publicCustomer(customer) });
}

/* ------------------------------------------------------------------- admin */

/** POST /admin/auth/login */
export async function loginAdmin(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  const admin = await AdminUser.findOne({ email: email.toLowerCase() }).select(
    '+passwordHash',
  );

  const invalid = unauthorized('That email or password is incorrect.');
  if (!admin || !admin.isActive) throw invalid;
  if (!(await verifyPassword(admin.passwordHash, password))) {
    logger.warn({ email, ip: req.ip }, 'Failed admin sign-in');
    throw invalid;
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  await issueSession(req, res, 'admin', {
    sub: admin._id.toString(),
    aud: 'admin',
    role: admin.role,
    name: admin.name,
  });

  logger.info({ adminId: admin._id.toString(), email }, 'Admin signed in');

  sendResponse(res, {
    message: `Welcome back, ${admin.name}.`,
    data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
  });
}

/** POST /admin/auth/logout */
export async function logoutAdmin(req: Request, res: Response): Promise<void> {
  await revokeSession(req.cookies?.[REFRESH_COOKIE.admin]);
  clearAuthCookies(res, 'admin');
  sendResponse(res, { message: 'Signed out.', data: null });
}

/** GET /admin/auth/me */
export async function getAdminMe(req: Request, res: Response): Promise<void> {
  const admin = await AdminUser.findById(req.admin!.id).select(
    'name email role lastLoginAt',
  );
  if (!admin) throw unauthorized();
  sendResponse(res, { data: admin });
}

/** POST /admin/auth/refresh */
export async function refreshAdmin(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE.admin];
  if (!token) throw unauthorized('Your session has expired. Please sign in again.');

  const { sub } = verifyRefreshToken(token, 'admin');

  if (!(await sessionExists(token))) {
    clearAuthCookies(res, 'admin');
    throw unauthorized('Your session has ended. Please sign in again.');
  }

  const admin = await AdminUser.findById(sub);
  if (!admin?.isActive) throw unauthorized();

  await revokeSession(token);
  await issueSession(req, res, 'admin', {
    sub: admin._id.toString(),
    aud: 'admin',
    role: admin.role,
    name: admin.name,
  });

  sendResponse(res, {
    data: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
  });
}

/* ----------------------------------------------------------------- helpers */

function publicCustomer(customer: {
  _id: unknown;
  name: string;
  phone: string;
  email?: string | null;
  addresses: unknown[];
  defaultAddressId?: unknown;
}) {
  return {
    id: customer._id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? null,
    addresses: customer.addresses,
    defaultAddressId: customer.defaultAddressId ?? null,
  };
}

export { ACCESS_COOKIE };
