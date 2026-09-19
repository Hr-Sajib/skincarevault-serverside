import { config } from '@/config';
import { logger } from '@/lib/logger';
import { AppError, badRequest } from '@/utils/AppError';

/**
 * SSLCommerz client.
 *
 * Two calls matter. `initiate` opens a payment session and returns the URL to
 * send the customer to. `validate` is the server-to-server check that decides
 * whether an order is actually paid — the browser callback is never trusted
 * for that, because it arrives from the customer's own machine and can be
 * forged.
 */

export interface InitiateParams {
  tranId: string;
  amountMinor: number;
  orderNo: string;
  customer: { name: string; phone: string; email?: string };
  shipping: { address1: string; city: string; district: string; postcode?: string };
  itemCount: number;
  productNames: string;
}

export interface InitiateResult {
  gatewayUrl: string;
  sessionKey: string;
}

export interface ValidationResult {
  status: string;
  tranId: string;
  valId: string;
  amount: number;
  currency: string;
  cardType?: string;
  bankTranId?: string;
  riskLevel?: string;
  raw: Record<string, unknown>;
}

function requireCredentials(): { storeId: string; storePassword: string } {
  if (!config.ssl.isConfigured) {
    throw new AppError(
      503,
      'Online payment is not configured. Please choose cash on delivery.',
      'GATEWAY_NOT_CONFIGURED',
    );
  }
  return {
    storeId: config.ssl.storeId as string,
    storePassword: config.ssl.storePassword as string,
  };
}

/** Opens a payment session and returns where to send the customer. */
export async function initiatePayment(params: InitiateParams): Promise<InitiateResult> {
  const { storeId, storePassword } = requireCredentials();

  const body = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePassword,

    // The gateway works in major units, so paisa is converted here — the one
    // place in the codebase where that is allowed to happen.
    total_amount: (params.amountMinor / 100).toFixed(2),
    currency: 'BDT',
    tran_id: params.tranId,

    // Callbacks must be publicly reachable, which is why local development
    // needs a tunnel pointed at the API.
    success_url: `${config.apiUrl}/api/v1/payments/ssl/success`,
    fail_url: `${config.apiUrl}/api/v1/payments/ssl/fail`,
    cancel_url: `${config.apiUrl}/api/v1/payments/ssl/cancel`,
    ipn_url: `${config.apiUrl}/api/v1/payments/ssl/ipn`,

    shipping_method: 'Courier',
    num_of_item: String(params.itemCount),
    product_name: params.productNames.slice(0, 250),
    product_category: 'Skincare',
    product_profile: 'physical-goods',

    cus_name: params.customer.name,
    cus_email: params.customer.email || 'noreply@skincarevault.com',
    cus_phone: params.customer.phone,
    cus_add1: params.shipping.address1,
    cus_city: params.shipping.city,
    cus_state: params.shipping.district,
    cus_postcode: params.shipping.postcode || '1000',
    cus_country: 'Bangladesh',

    ship_name: params.customer.name,
    ship_add1: params.shipping.address1,
    ship_city: params.shipping.city,
    ship_state: params.shipping.district,
    ship_postcode: params.shipping.postcode || '1000',
    ship_country: 'Bangladesh',

    value_a: params.orderNo, // echoed back on every callback
  });

  const url = `${config.ssl.baseUrl}/gwprocess/v4/api.php`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    logger.error({ status: response.status, tranId: params.tranId }, 'Gateway init HTTP error');
    throw new AppError(502, 'Could not reach the payment gateway. Please try again.', 'GATEWAY_UNREACHABLE');
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (data.status !== 'SUCCESS' || typeof data.GatewayPageURL !== 'string') {
    logger.error(
      { tranId: params.tranId, status: data.status, reason: data.failedreason },
      'Gateway refused to open a session',
    );
    throw new AppError(
      502,
      typeof data.failedreason === 'string' && data.failedreason
        ? `Payment could not be started: ${data.failedreason}`
        : 'Payment could not be started. Please try again or choose cash on delivery.',
      'GATEWAY_INIT_FAILED',
    );
  }

  return {
    gatewayUrl: data.GatewayPageURL,
    sessionKey: String(data.sessionkey ?? ''),
  };
}

/**
 * The authoritative check. Asks SSLCommerz directly what happened to a
 * transaction, using the `val_id` a callback delivered.
 *
 * Nothing about payment state is decided from callback form fields — they
 * come through the customer's browser. Only this response counts.
 */
export async function validatePayment(valId: string): Promise<ValidationResult> {
  const { storeId, storePassword } = requireCredentials();

  const url = new URL(`${config.ssl.baseUrl}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', storeId);
  url.searchParams.set('store_passwd', storePassword);
  url.searchParams.set('v', '1');
  url.searchParams.set('format', 'json');

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new AppError(502, 'Could not verify the payment.', 'VALIDATION_UNREACHABLE');
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    status: String(data.status ?? ''),
    tranId: String(data.tran_id ?? ''),
    valId: String(data.val_id ?? valId),
    amount: Number(data.amount ?? 0),
    currency: String(data.currency ?? ''),
    cardType: data.card_type ? String(data.card_type) : undefined,
    bankTranId: data.bank_tran_id ? String(data.bank_tran_id) : undefined,
    riskLevel: data.risk_level ? String(data.risk_level) : undefined,
    raw: data,
  };
}

/**
 * Decides whether a validation response means "paid", and that the amount
 * matches what we actually charged.
 *
 * A tolerance of one paisa absorbs the gateway's two-decimal rounding; any
 * larger gap is treated as a mismatch and the order is not marked paid.
 */
export function assertPaid(
  result: ValidationResult,
  expectedAmountMinor: number,
): void {
  if (result.status !== 'VALID' && result.status !== 'VALIDATED') {
    throw badRequest(
      'That payment was not completed.',
      'PAYMENT_NOT_VALID',
      { status: result.status },
    );
  }

  if (result.currency !== 'BDT') {
    throw badRequest('Unexpected payment currency.', 'CURRENCY_MISMATCH', {
      currency: result.currency,
    });
  }

  const paidMinor = Math.round(result.amount * 100);
  if (Math.abs(paidMinor - expectedAmountMinor) > 1) {
    logger.error(
      { tranId: result.tranId, paidMinor, expectedAmountMinor },
      'Payment amount does not match the order total',
    );
    throw badRequest('The paid amount does not match this order.', 'AMOUNT_MISMATCH', {
      paidMinor,
      expectedAmountMinor,
    });
  }
}

/** A transaction id unique to one payment attempt. */
export const buildTranId = (orderNo: string): string =>
  `${orderNo}-${Date.now().toString(36).toUpperCase()}`;
