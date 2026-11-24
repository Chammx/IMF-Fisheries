import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/[...path].js';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(value) {
      this.body = JSON.stringify(value);
      return this;
    },
    end(value = '') {
      this.body = value;
    },
  };
}

test('proxy forwards API requests only to the configured HTTPS backend', async () => {
  process.env.IMF_API_URL = 'https://api.example.test';
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  let upstreamOptions;
  globalThis.fetch = async (url, options) => {
    upstreamUrl = String(url);
    upstreamOptions = options;
    return new Response('{"authenticated":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'imf_admin_session=test; Path=/api/admin; HttpOnly',
      },
    });
  };

  try {
    const response = createResponse();
    await handler({
      method: 'POST',
      url: '/api/admin/login',
      headers: {
        origin: 'https://buyer-site.example',
        'content-type': 'application/json',
      },
      body: { username: 'admin' },
    }, response);
    assert.equal(upstreamUrl, 'https://api.example.test/api/admin/login');
    assert.equal(upstreamOptions.method, 'POST');
    assert.equal(upstreamOptions.headers.get('origin'), 'https://buyer-site.example');
    assert.equal(upstreamOptions.body, JSON.stringify({ username: 'admin' }));
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.toString(), '{"authenticated":true}');
    assert.match(response.headers['set-cookie'], /HttpOnly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('proxy refuses absolute or non-API request paths', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Untrusted route must not be fetched.');
  };
  try {
    const response = createResponse();
    await handler({
      method: 'GET',
      url: 'https://attacker.example/private',
      headers: {},
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Invalid API route/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('proxy refuses unsupported HTTP methods', async () => {
  const response = createResponse();
  await handler({ method: 'DELETE', url: '/api/enquiries', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET, POST, PATCH, OPTIONS');
});

test('proxy fails closed when backend configuration is missing', async () => {
  delete process.env.IMF_API_URL;
  const response = createResponse();
  await handler({ method: 'GET', url: '/api/health', headers: {} }, response);
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /not configured/i);
});
