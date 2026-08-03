import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROOT } from './sessions.js';

const LICENSE_FILE = 'license.json';
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export type LicensePlan = 'free' | 'pro';

export interface LicenseStatus {
  plan: LicensePlan;
  productConfigured: boolean;
  checkoutUrl: string | null;
  detail: string;
  verifiedAt: number | null;
}

interface StoredLicense {
  licenseKey: string;
  productId: string;
  verifiedAt: number;
  plan: 'pro';
}

interface GumroadVerifyResponse {
  success?: boolean;
  purchase?: {
    product_id?: string | number;
    refunded?: boolean;
    disputed?: boolean;
    chargebacked?: boolean;
    cancelled?: boolean;
    subscription_cancelled_at?: string | null;
    subscription_ended_at?: string | null;
  };
}

export interface GumroadVerification {
  ok: boolean;
  detail: string;
}

function productId(): string {
  return process.env.MDVE_GUMROAD_PRODUCT_ID?.trim() ?? '';
}

function checkoutUrl(): string | null {
  const value = process.env.MDVE_PRO_CHECKOUT_URL?.trim();
  return value || null;
}

function licensePath(): string {
  return join(ROOT, LICENSE_FILE);
}

function isPurchaseActive(purchase: GumroadVerifyResponse['purchase']): boolean {
  return Boolean(
    purchase
      && !purchase.refunded
      && !purchase.disputed
      && !purchase.chargebacked
      && !purchase.cancelled
      && !purchase.subscription_cancelled_at
      && !purchase.subscription_ended_at,
  );
}

export function summarizeGumroadVerification(response: GumroadVerifyResponse, expectedProductId: string): GumroadVerification {
  if (!response.success || !response.purchase) return { ok: false, detail: 'That license key could not be verified.' };
  const actualProductId = response.purchase.product_id === undefined ? '' : String(response.purchase.product_id);
  if (!actualProductId || actualProductId !== expectedProductId) return { ok: false, detail: 'That license key belongs to a different product.' };
  if (!isPurchaseActive(response.purchase)) return { ok: false, detail: 'That purchase is no longer active.' };
  return { ok: true, detail: 'MDVE Pro is active on this device.' };
}

async function readStoredLicense(): Promise<StoredLicense | null> {
  try {
    const raw = await readFile(licensePath(), 'utf8');
    const value = JSON.parse(raw) as Partial<StoredLicense>;
    if (
      value.plan !== 'pro'
      || typeof value.licenseKey !== 'string'
      || value.licenseKey.trim() === ''
      || typeof value.productId !== 'string'
      || typeof value.verifiedAt !== 'number'
    ) return null;
    return value as StoredLicense;
  } catch {
    return null;
  }
}

async function writeStoredLicense(value: StoredLicense): Promise<void> {
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  await writeFile(licensePath(), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(licensePath(), 0o600);
}

export async function getLicenseStatus(now = Date.now()): Promise<LicenseStatus> {
  const configuredProduct = productId();
  const stored = await readStoredLicense();
  const withinGrace = stored && stored.productId === configuredProduct && now - stored.verifiedAt <= OFFLINE_GRACE_MS;
  return {
    plan: withinGrace ? 'pro' : 'free',
    productConfigured: Boolean(configuredProduct),
    checkoutUrl: checkoutUrl(),
    verifiedAt: stored?.verifiedAt ?? null,
    detail: withinGrace
      ? (now - stored.verifiedAt > 5 * 60 * 1000 ? 'MDVE Pro is active via its offline grace period.' : 'MDVE Pro is active on this device.')
      : stored
        ? 'The local license needs to be verified again.'
        : 'MDVE Free includes the complete local Mermaid workbench.',
  };
}

export async function activateLicense(licenseKey: string, fetcher: typeof fetch = fetch): Promise<LicenseStatus> {
  const key = licenseKey.trim();
  const configuredProduct = productId();
  if (!configuredProduct) throw new Error('MDVE Pro licensing is not configured yet. Set MDVE_GUMROAD_PRODUCT_ID first.');
  if (!key) throw new Error('Enter an MDVE Pro license key.');

  let response: Response;
  try {
    response = await fetcher('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ product_id: configuredProduct, license_key: key, increment_uses_count: 'false' }),
    });
  } catch {
    throw new Error('License verification could not reach Gumroad. Check your connection and try again.');
  }

  let body: GumroadVerifyResponse = {};
  try {
    body = await response.json() as GumroadVerifyResponse;
  } catch {
    // Keep the public error intentionally generic; a provider response must
    // never be allowed to leak credentials or transport details into the UI.
  }
  const verification = summarizeGumroadVerification(body, configuredProduct);
  if (!response.ok || !verification.ok) throw new Error(verification.detail);

  await writeStoredLicense({ licenseKey: key, productId: configuredProduct, verifiedAt: Date.now(), plan: 'pro' });
  return getLicenseStatus();
}

export async function deactivateLicense(): Promise<LicenseStatus> {
  try {
    await unlink(licensePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return getLicenseStatus();
}
