import type { NextFunction, Request, Response } from 'express';
import { AdminUser, roleCan, type AdminRole } from '@/models/adminUser.model';
import { Customer } from '@/models/customer.model';
import { ACCESS_COOKIE, verifyAccessToken } from '@/lib/tokens';
import { forbidden, unauthorized } from '@/utils/AppError';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: string; name: string; role: AdminRole };
      customer?: { id: string; name: string };
    }
  }
}

function readToken(req: Request, cookieName: string): string | null {
  const fromCookie = req.cookies?.[cookieName];
  if (fromCookie) return fromCookie;

  // Bearer is accepted as a fallback for API clients and testing tools.
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}

/** Requires a signed-in admin. Rejects a customer token before any role check. */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = readToken(req, ACCESS_COOKIE.admin);
    if (!token) throw unauthorized('Admin sign-in required.');

    const payload = verifyAccessToken(token, 'admin');

    // Re-read the account on every request so deactivating someone takes
    // effect immediately instead of when their token happens to expire.
    const admin = await AdminUser.findById(payload.sub).select('name role isActive');
    if (!admin || !admin.isActive) {
      throw unauthorized('This admin account is no longer active.');
    }

    req.admin = { id: admin._id.toString(), name: admin.name, role: admin.role };
    next();
  } catch (err) {
    next(err instanceof Error && 'statusCode' in err ? err : unauthorized());
  }
}

/** Gates a route on a specific permission. Use after `requireAdmin`. */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) return next(unauthorized('Admin sign-in required.'));
    if (!roleCan(req.admin.role, permission)) {
      return next(forbidden(`Your role cannot perform this action (${permission}).`));
    }
    next();
  };
}

/** Requires a signed-in customer. */
export async function requireCustomer(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = readToken(req, ACCESS_COOKIE.customer);
    if (!token) throw unauthorized();

    const payload = verifyAccessToken(token, 'customer');
    const customer = await Customer.findById(payload.sub).select('name isActive');
    if (!customer || !customer.isActive) throw unauthorized();

    req.customer = { id: customer._id.toString(), name: customer.name };
    next();
  } catch (err) {
    next(err instanceof Error && 'statusCode' in err ? err : unauthorized());
  }
}

/**
 * Attaches the customer when a valid token is present, but never rejects.
 *
 * This is what makes guest checkout work: `POST /orders` runs through it, so
 * a signed-in customer gets their order linked to their account while an
 * anonymous visitor passes straight through and checks out as a guest.
 */
export async function attachCustomerIfPresent(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = readToken(req, ACCESS_COOKIE.customer);
    if (token) {
      const payload = verifyAccessToken(token, 'customer');
      const customer = await Customer.findById(payload.sub).select('name isActive');
      if (customer?.isActive) {
        req.customer = { id: customer._id.toString(), name: customer.name };
      }
    }
  } catch {
    // An expired or malformed token simply means "treat this as a guest".
  }
  next();
}
