import type { Request, Response } from 'express';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { sendResponse } from '@/utils/sendResponse';
import { findByTranId, markFailed, settlePayment } from '@/modules/payments/payment.service';

/**
 * SSLCommerz callback handlers.
 *
 * The success, fail, and cancel endpoints are browser navigations — the
 * gateway POSTs the customer's browser back to us — so each one ends in a
 * redirect to a page a person can read. The IPN endpoint is server-to-server
 * and answers with JSON.
 *
 * None of them believe the posted body. Payment state comes only from the
 * validation call inside `settlePayment`.
 */

const storefront = (path: string) => `${config.appUrl}${path}`;

/**
 * Gateway fields arrive in the POST body, but some configurations return the
 * customer with a GET instead, putting them in the query string.
 */
const gatewayFields = (req: Request): Record<string, unknown> => ({
  ...(req.query as Record<string, unknown>),
  ...(req.body as Record<string, unknown>),
});

/** POST /payments/ssl/success — customer returning from a completed payment. */
export async function handleSuccess(req: Request, res: Response): Promise<void> {
  const fields = gatewayFields(req);
  const tranId = String(fields.tran_id ?? '');
  const valId = String(fields.val_id ?? '');

  if (!tranId || !valId) {
    logger.warn({ tranId }, 'Success callback missing identifiers');
    res.redirect(storefront('/checkout?payment=invalid'));
    return;
  }

  try {
    const result = await settlePayment({ valId, tranId, source: 'success' });

    if (result.outcome === 'rejected') {
      res.redirect(
        storefront(`/checkout?payment=failed&order=${result.order.orderNo}`),
      );
      return;
    }

    res.redirect(
      storefront(`/order/${result.order.orderNo}?payment=success&phone=${
        encodeURIComponent(result.order.contact.phone)
      }`),
    );
  } catch (err) {
    logger.error({ err, tranId }, 'Success callback failed');
    res.redirect(storefront('/checkout?payment=error'));
  }
}

/** POST /payments/ssl/fail — the gateway declined or the bank refused. */
export async function handleFail(req: Request, res: Response): Promise<void> {
  const tranId = String(gatewayFields(req).tran_id ?? '');
  const order = tranId ? await findByTranId(tranId) : null;

  if (order) {
    await markFailed(order, 'Payment failed at the gateway');
  }

  res.redirect(
    storefront(`/checkout?payment=failed${order ? `&order=${order.orderNo}` : ''}`),
  );
}

/** POST /payments/ssl/cancel — the customer backed out on the gateway page. */
export async function handleCancel(req: Request, res: Response): Promise<void> {
  const tranId = String(gatewayFields(req).tran_id ?? '');
  const order = tranId ? await findByTranId(tranId) : null;

  if (order) {
    await markFailed(order, 'Payment cancelled by the customer');
  }

  res.redirect(storefront('/checkout?payment=cancelled'));
}

/**
 * POST /payments/ssl/ipn — the authoritative notification.
 *
 * This arrives server-to-server and lands even when the customer closes the
 * tab before being redirected back, which is exactly why it exists. It races
 * the success callback; `settlePayment` is idempotent, so whichever arrives
 * second is a no-op.
 */
export async function handleIpn(req: Request, res: Response): Promise<void> {
  const tranId = String(req.body.tran_id ?? '');
  const valId = String(req.body.val_id ?? '');
  const status = String(req.body.status ?? '');

  logger.info({ tranId, status }, 'IPN received');

  if (!tranId) {
    sendResponse(res, { data: { received: true, handled: false } });
    return;
  }

  // A failed or cancelled IPN carries no val_id to validate against.
  if (!valId || status === 'FAILED' || status === 'CANCELLED') {
    const order = await findByTranId(tranId);
    if (order) await markFailed(order, `Gateway reported ${status || 'failure'}`);
    sendResponse(res, { data: { received: true, handled: true, outcome: 'failed' } });
    return;
  }

  try {
    const result = await settlePayment({ valId, tranId, source: 'ipn' });
    sendResponse(res, { data: { received: true, handled: true, outcome: result.outcome } });
  } catch (err) {
    logger.error({ err, tranId }, 'IPN handling failed');
    // Answer 200 regardless: a non-2xx makes the gateway retry, and a bug on
    // our side would turn into a retry storm rather than getting fixed.
    sendResponse(res, { data: { received: true, handled: false } });
  }
}
