import { StatusCodes } from 'http-status-codes';

/** An error we raised deliberately and can safely show the client. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(StatusCodes.BAD_REQUEST, message, code, details);

export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(StatusCodes.UNAUTHORIZED, message, 'UNAUTHORIZED');

export const forbidden = (message = 'You do not have access to this.') =>
  new AppError(StatusCodes.FORBIDDEN, message, 'FORBIDDEN');

export const notFound = (what = 'Resource') =>
  new AppError(StatusCodes.NOT_FOUND, `${what} not found.`, 'NOT_FOUND');

export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(StatusCodes.CONFLICT, message, code, details);

export const tooManyRequests = (message = 'Too many requests. Please slow down.') =>
  new AppError(StatusCodes.TOO_MANY_REQUESTS, message, 'RATE_LIMITED');

/**
 * Raised when a guarded stock decrement matches nothing, meaning another
 * order took the last units between quote and placement.
 */
export const outOfStock = (sku: string, title: string) =>
  new AppError(
    StatusCodes.CONFLICT,
    `${title} is out of stock.`,
    'OUT_OF_STOCK',
    { sku, title },
  );

/**
 * Raised when the client's displayed total disagrees with the server's
 * recomputed total. Carries the corrected quote so the UI can show the change.
 */
export const priceChanged = (details: unknown) =>
  new AppError(
    StatusCodes.CONFLICT,
    'Prices in your cart have changed. Please review the updated total.',
    'PRICE_CHANGED',
    details,
  );
