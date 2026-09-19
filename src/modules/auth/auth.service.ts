import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { Session } from '@/models/session.model';
import {
  hashToken,
  refreshExpiryDate,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  type AccessTokenPayload,
  type TokenAudience,
} from '@/lib/tokens';

/**
 * Argon2id — memory-hard, so a leaked hash cannot be cracked at GPU speed
 * the way a bcrypt or PBKDF2 hash can.
 */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, the OWASP baseline
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, ARGON_OPTIONS);

export const verifyPassword = async (hash: string, plain: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
};

/**
 * Issues an access/refresh pair, records the session, and sets both cookies.
 *
 * The refresh token is stored only as a SHA-256 hash, so a database leak
 * cannot be replayed into live sessions. Having the row at all is what makes
 * a sign-out actually revoke access, which a bare stateless JWT cannot do.
 */
export async function issueSession(
  req: Request,
  res: Response,
  audience: TokenAudience,
  payload: AccessTokenPayload,
): Promise<{ accessToken: string }> {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload.sub, audience);

  await Session.create({
    subjectId: payload.sub,
    subjectType: audience,
    tokenHash: hashToken(refreshToken),
    ip: req.ip,
    userAgent: req.get('user-agent'),
    expiresAt: refreshExpiryDate(),
  });

  setAuthCookies(res, audience, accessToken, refreshToken);
  return { accessToken };
}

/** Drops the stored session so the refresh token can never be used again. */
export async function revokeSession(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  await Session.deleteOne({ tokenHash: hashToken(refreshToken) });
}

/** Ends every session for a subject — used when an account is deactivated. */
export async function revokeAllSessions(
  subjectId: string,
  subjectType: TokenAudience,
): Promise<void> {
  await Session.deleteMany({ subjectId, subjectType });
}

/** True when the refresh token presented still has a live session row. */
export async function sessionExists(refreshToken: string): Promise<boolean> {
  const found = await Session.findOne({ tokenHash: hashToken(refreshToken) }).select('_id');
  return Boolean(found);
}
