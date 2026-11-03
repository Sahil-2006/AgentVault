import 'dotenv/config';

export interface Config {
  production: boolean; origin: string; paymentMode: 'simulation' | 'sandbox'; demoEnabled: boolean;
  databaseUrl: string; localPath: string; paypalClientId: string; paypalSecret: string;
  paypalMerchantId: string; paypalWebhookId: string; geminiKey: string; geminiModel: string;
}
export function getConfig(): Config {
  const production = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const paymentMode = process.env.PAYMENT_MODE || 'simulation';
  if (!['simulation', 'sandbox'].includes(paymentMode)) throw new Error('PAYMENT_MODE must be simulation or sandbox.');
  return {
    production, origin: process.env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:5173'),
    paymentMode: paymentMode as Config['paymentMode'], demoEnabled: process.env.DEMO_ENABLED === 'true' || (!production && process.env.DEMO_ENABLED !== 'false'),
    databaseUrl: process.env.DATABASE_URL || '', localPath: process.env.LOCAL_DATABASE_PATH || './data/postgres',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '', paypalSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    paypalMerchantId: process.env.PAYPAL_MERCHANT_ID || '', paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    geminiKey: process.env.GEMINI_API_KEY || '', geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  };
}
