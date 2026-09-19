import rateLimit, { type Options } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import { config } from '@/config';

function make(windowMs: number, max: number, message: string): Partial<Options> {
  return {
    windowMs,
    // Limits would make local development miserable, so they are relaxed there.
    limit: config.isProd ? max : max * 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message, code: 'RATE_LIMITED' },
    statusCode: StatusCodes.TOO_MANY_REQUESTS,
  };
}

const MINUTE = 60 * 1000;

/** Broad ceiling on the whole API. */
export const generalLimiter = rateLimit(
  make(15 * MINUTE, 1000, 'Too many requests. Please slow down.'),
);

/** Credential stuffing defence. Counts failures only, so a busy admin is unaffected. */
export const loginLimiter = rateLimit({
  ...make(15 * MINUTE, 8, 'Too many sign-in attempts. Try again in 15 minutes.'),
  skipSuccessfulRequests: true,
});

/** Order placement — expensive, and the one endpoint worth abusing. */
export const orderLimiter = rateLimit(
  make(10 * MINUTE, 10, 'Too many orders from this connection. Please wait a moment.'),
);

/** Coupon validation, which is otherwise a free brute-force oracle for codes. */
export const couponLimiter = rateLimit(
  make(5 * MINUTE, 20, 'Too many coupon attempts. Please wait a few minutes.'),
);

/** Order tracking takes a phone number, so it is an enumeration target. */
export const trackingLimiter = rateLimit(
  make(5 * MINUTE, 15, 'Too many lookups. Please wait a few minutes.'),
);

export const reviewLimiter = rateLimit(
  make(60 * MINUTE, 5, 'You have submitted several reviews already. Try again later.'),
);
