import { Router } from 'express';
import * as payments from '@/modules/payments/payment.controller';

const router = Router();

/**
 * SSLCommerz callbacks.
 *
 * These are posted by the gateway, not by our own frontend, so they sit
 * outside the CORS allowlist and outside CSRF protection — the gateway
 * cannot present our cookies or a token. What makes that safe is that none
 * of these handlers trust the posted body: payment state is decided only by
 * the server-to-server validation call.
 */
router.post('/ssl/success', payments.handleSuccess);
router.post('/ssl/fail', payments.handleFail);
router.post('/ssl/cancel', payments.handleCancel);
router.post('/ssl/ipn', payments.handleIpn);

// Some gateway configurations issue a GET on return instead of a POST.
router.get('/ssl/success', payments.handleSuccess);
router.get('/ssl/fail', payments.handleFail);
router.get('/ssl/cancel', payments.handleCancel);

export default router;
