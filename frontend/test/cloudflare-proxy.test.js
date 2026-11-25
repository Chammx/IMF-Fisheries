import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';

test('Cloudflare proxy forwards API requests only to the configured HTTPS backend', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return Response.json({ ok: true }, { status: 201 });
  };

  try {
    const response = await onRequest({
      request: new Request('https://site.example/api/enquiries?source=buyer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://site.example',
          'cf-connecting-ip': '203.0.113.10',
          'x-forwarded-for': '198.51.100.200',
        },
        body: JSON.stringify({ name: 'Buyer' }),
      }),
      env: { IMF_API_URL: 'https://api.example.test', PROXY_SHARED_SECRET: 'local-test-token' },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(forwarded.url, 'https://api.example.test/api/enquiries?source=buyer');
    assert.equal(forwarded.options.headers.get('origin'), 'https://site.example');
    assert.equal(forwarded.options.headers.get('x-imf-proxy-token'), 'local-test-token');
    assert.equal(forwarded.options.headers.get('x-forwarded-for'), '203.0.113.10');
    assert.equal(forwarded.options.headers.get('x-forwarded-proto'), 'https');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare proxy rejects unsupported methods and unsafe backend origins', async () => {
  const unsupported = await onRequest({
    request: new Request('https://site.example/api/enquiries', { method: 'DELETE' }),
    env: { IMF_API_URL: 'https://api.example.test', PROXY_SHARED_SECRET: 'local-test-token' },
  });
  assert.equal(unsupported.status, 405);

  const unsafeBackend = await onRequest({
    request: new Request('https://site.example/api/health'),
    env: { IMF_API_URL: 'https://user:pass@api.example.test', PROXY_SHARED_SECRET: 'local-test-token' },
  });
  assert.equal(unsafeBackend.status, 500);

  const missingBackend = await onRequest({
    request: new Request('https://site.example/api/health'),
    env: {},
  });
  assert.equal(missingBackend.status, 503);

  const missingProxySecret = await onRequest({
    request: new Request('https://site.example/api/health'),
    env: { IMF_API_URL: 'https://api.example.test' },
  });
  assert.equal(missingProxySecret.status, 503);
});
