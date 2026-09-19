import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';
import { config } from '@/config';
import type { AdminRole } from '@/models/adminUser.model';

/**
 * Token audiences are how a customer token is kept from ever reaching an
 * admin route. The admin middleware demands `aud: 'admin'`, so a valid
 * customer token fails verification outright rather than merely failing a
 * role check further in.
 */
export type TokenAudience = 'customer' | 'admin';

export interface AccessTokenPayload {
  sub: string;
  aud: TokenAudience;
  role?: AdminRole;
  name?: string;
}

export const ACCESS_COOKIE = {
  customer: 'sv_token',
  admin: 'sv_admin_token',
} as const;

export const REFRESH_COOKIE = {
  customer: 'sv_refresh',
  admin: 'sv_admin_refresh',
} as const;

export function signAccessToken(payload: AccessTokenPayload): string {
  const { sub, aud, ...rest } = payload;
  return jwt.sign({ ...rest, aud }, config.jwt.accessSecret, {
    subject: sub,
    expiresIn: config.jwt.accessExpiresIn,
  } as SignOptions);
}

export function signRefreshToken(sub: string, aud: TokenAudience): string {
  return jwt.sign({ aud }, config.jwt.refreshSecret, {
    subject: sub,
    expiresIn: config.jwt.refreshExpiresIn,
  } as SignOptions);
}

export function verifyAccessToken(
  token: string,
  audience: TokenAudience,
): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwt.accessSecret, {
    audience,
  }) as jwt.JwtPayload;

  return {
    sub: String(decoded.sub),
    aud: audience,
    role: decoded.role as AdminRole | undefined,
    name: decoded.name as string | undefined,
  };
}

export function verifyRefreshToken(
  token: string,
  audience: TokenAudience,
): { sub: string } {
  const decoded = jwt.verify(token, config.jwt.refreshSecret, {
    audience,
  }) as jwt.JwtPayload;
  return { sub: String(decoded.sub) };
}

/** Refresh tokens are stored only as a hash, so a database leak cannot replay them. */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.isProd,
    // Lax, not Strict: the SSLCommerz redirect is a cross-site navigation back
    // to us, and Strict would drop the cookie on arrival.
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function setAuthCookies(
  res: Response,
  audience: TokenAudience,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(ACCESS_COOKIE[audience], accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE[audience], refreshToken, cookieOptions(30 * DAY));
}

export function clearAuthCookies(res: Response, audience: TokenAudience): void {
  const opts = { httpOnly: true, secure: config.isProd, sameSite: 'lax' as const, path: '/' };
  res.clearCookie(ACCESS_COOKIE[audience], opts);
  res.clearCookie(REFRESH_COOKIE[audience], opts);
}

/** Expiry of a refresh token as a Date, for the session row's TTL field. */
export function refreshExpiryDate(): Date {
  return new Date(Date.now() + 30 * DAY);
}
