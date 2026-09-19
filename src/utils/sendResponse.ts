import type { Response } from 'express';

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Payload<T> {
  statusCode?: number;
  message?: string;
  data: T;
  meta?: Meta;
}

/**
 * The single response shape every endpoint returns. The client's RTK Query
 * `transformResponse` unwraps `data`, so nothing downstream has to branch
 * on whether a route returned a bare value or an envelope.
 */
export function sendResponse<T>(res: Response, payload: Payload<T>): void {
  const { statusCode = 200, message, data, meta } = payload;
  res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    ...(meta ? { meta } : {}),
    data,
  });
}

export function buildMeta(page: number, limit: number, total: number): Meta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
