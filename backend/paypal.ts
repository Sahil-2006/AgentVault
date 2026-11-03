import type { Config } from './config.js';
import { AppError } from './validation.js';
const base = 'https://api-m.sandbox.paypal.com';
export class PayPal {
  private cached?: { token: string; until: number };
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}
  configured() { return !!(this.config.paypalClientId && this.config.paypalSecret && this.config.paypalMerchantId); }
  async token() {
    if (!this.configured()) throw new AppError(503, 'PayPal Sandbox credentials and merchant ID are not configured on the server.');
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    const response = await this.fetcher(`${base}/v1/oauth2/token`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${this.config.paypalClientId}:${this.config.paypalSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!response.ok) throw new AppError(502, 'PayPal Sandbox authentication failed. Check the server credentials.');
    const data = await response.json();
    if (!data.access_token) throw new AppError(502, 'PayPal returned an invalid authentication response.');
    this.cached = { token: data.access_token, until: Date.now() + (Number(data.expires_in) - 60) * 1000 };
    return data.access_token as string;
  }
  async call(path: string, method = 'GET', body?: unknown, requestId?: string) {
    const token = await this.token();
    const response = await this.fetcher(`${base}${path}`, { method, signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new AppError(502, `PayPal Sandbox returned HTTP ${response.status}. Check payment status before retrying.`);
    return response.json();
  }
  async create(r: any) {
    const data = await this.call('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', purchase_units: [{ reference_id: r.id, custom_id: r.id, description: r.title, payee: { merchant_id: this.config.paypalMerchantId }, amount: { currency_code: 'USD', value: (r.amount_cents / 100).toFixed(2) } }], payment_source: { paypal: { experience_context: { brand_name: 'AgentVault', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: `${this.config.origin}/app/approvals?checkout=${r.id}`, cancel_url: `${this.config.origin}/app/approvals?canceled=${r.id}` } } } }, r.create_key);
    const approval = data.links?.find((link: any) => ['payer-action', 'approve'].includes(link.rel))?.href;
    if (!data.id || !approval) throw new AppError(502, 'PayPal did not return a checkout link.');
    const url = new URL(approval);
    if (url.protocol !== 'https:' || !['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(url.hostname)) throw new AppError(502, 'PayPal returned an unexpected checkout URL.');
    return { id: data.id as string, approvalUrl: approval as string };
  }
  get(orderId: string) { return this.call(`/v2/checkout/orders/${encodeURIComponent(orderId)}`); }
  capture(r: any) { return this.call(`/v2/checkout/orders/${encodeURIComponent(r.order_id)}/capture`, 'POST', {}, r.capture_key); }
  validate(order: any, r: any) {
    const units = order.purchase_units;
    if (order.id !== r.order_id || !Array.isArray(units) || units.length !== 1) throw new AppError(502, 'PayPal order identity mismatch.');
    const unit = units[0];
    if (unit.reference_id !== r.id || unit.payee?.merchant_id !== this.config.paypalMerchantId || unit.amount?.currency_code !== 'USD' || unit.amount?.value !== (r.amount_cents / 100).toFixed(2)) throw new AppError(502, 'PayPal amount, reference, currency, or payee mismatch.');
    const captures = unit.payments?.captures || [];
    if (captures.length > 1) throw new AppError(502, 'Unexpected multiple captures. Manual reconciliation is required.');
    const capture = captures.find((c: any) => c.status === 'COMPLETED');
    if (capture && (capture.amount?.currency_code !== 'USD' || capture.amount?.value !== (r.amount_cents / 100).toFixed(2))) throw new AppError(502, 'PayPal capture amount mismatch.');
    return capture?.id as string | undefined;
  }
  async verifyWebhook(headers: Record<string, any>, event: unknown) {
    if (!this.config.paypalWebhookId) throw new AppError(503, 'Webhook ID is not configured.');
    const fields = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
    if (fields.some(f => typeof headers[f] !== 'string')) throw new AppError(400, 'Missing PayPal signature headers.');
    const result = await this.call('/v1/notifications/verify-webhook-signature', 'POST', { auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'], transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'], transmission_time: headers['paypal-transmission-time'], webhook_id: this.config.paypalWebhookId, webhook_event: event });
    if (result.verification_status !== 'SUCCESS') throw new AppError(401, 'Invalid webhook signature.');
  }
}
