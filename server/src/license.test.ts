import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { activateLicense, getLicenseStatus, summarizeGumroadVerification } from './license.js';
import { setDataRoot } from './sessions.js';

test('license verification persists only an opaque local entitlement and supports offline grace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdve-license-'));
  const previousProduct = process.env.MDVE_GUMROAD_PRODUCT_ID;
  const previousCheckout = process.env.MDVE_PRO_CHECKOUT_URL;
  process.env.MDVE_GUMROAD_PRODUCT_ID = 'product-123';
  process.env.MDVE_PRO_CHECKOUT_URL = 'https://gumroad.example/mdve-pro';
  setDataRoot(root);

  try {
    const free = await getLicenseStatus();
    assert.equal(free.plan, 'free');
    assert.equal(free.productConfigured, true);

    const activated = await activateLicense('license-secret', async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.match(String(init?.body), /product_id=product-123/);
      assert.match(String(init?.body), /license_key=license-secret/);
      return new Response(JSON.stringify({ success: true, purchase: { product_id: 'product-123' } }), { status: 200 });
    });
    assert.equal(activated.plan, 'pro');
    assert.equal(activated.checkoutUrl, 'https://gumroad.example/mdve-pro');
    assert.equal('licenseKey' in activated, false);

    const offline = await getLicenseStatus(Date.now() + 60 * 60 * 1000);
    assert.equal(offline.plan, 'pro');
    const expired = await getLicenseStatus(Date.now() + 31 * 24 * 60 * 60 * 1000);
    assert.equal(expired.plan, 'free');
  } finally {
    if (previousProduct === undefined) delete process.env.MDVE_GUMROAD_PRODUCT_ID;
    else process.env.MDVE_GUMROAD_PRODUCT_ID = previousProduct;
    if (previousCheckout === undefined) delete process.env.MDVE_PRO_CHECKOUT_URL;
    else process.env.MDVE_PRO_CHECKOUT_URL = previousCheckout;
    await rm(root, { recursive: true, force: true });
  }
});

test('license verification rejects a refunded or mismatched purchase', () => {
  assert.equal(
    summarizeGumroadVerification({ success: true, purchase: { product_id: 'other' } }, 'product-123').ok,
    false,
  );
  assert.equal(
    summarizeGumroadVerification({ success: true, purchase: { product_id: 'product-123', refunded: true } }, 'product-123').ok,
    false,
  );
});
