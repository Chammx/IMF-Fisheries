import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledHandler, createWorkerFetchHandler } from '../src/worker-runtime.js';

const logger = { error() {} };

test('Worker adds a burst limit to enquiry and admin login requests', async () => {
  const calls = [];
  let dispatched = 0;
  const handler = createWorkerFetchHandler(async () => {
    dispatched += 1;
    return Response.json({ ok: true });
  }, logger);
  const request = new Request('https://api.example/api/enquiries', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.10',
      'x-imf-client-ip': '203.0.113.10',
      'x-imf-proxy-token': 'local-test-token',
    },
  });
  const response = await handler(request, {
    PROXY_SHARED_SECRET: 'local-test-token',
    ENQUIRY_BURST_LIMIT: {
      async limit(input) {
        calls.push(input);
        return { success: false };
      },
    },
  });

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: 'Too many enquiries. Please try again shortly.',
  });
  assert.deepEqual(calls, [{ key: 'imf-fisheries:/api/enquiries:203.0.113.10' }]);
  assert.equal(dispatched, 0);
});

test('Worker dispatches normally when route is outside burst policy', async () => {
  let dispatched = 0;
  const handler = createWorkerFetchHandler(async () => {
    dispatched += 1;
    return Response.json({ ok: true });
  }, logger);
  const response = await handler(new Request('https://api.example/api/health', {
    headers: { 'x-imf-proxy-token': 'local-test-token' },
  }), { PROXY_SHARED_SECRET: 'local-test-token' });
  assert.equal(response.status, 200);
  assert.equal(dispatched, 1);
});

test('Worker fails open to the Express limiter if Cloudflare burst checks fail', async () => {
  let dispatched = 0;
  const handler = createWorkerFetchHandler(async () => {
    dispatched += 1;
    return Response.json({ ok: true });
  }, logger);
  const response = await handler(new Request('https://api.example/api/admin/login', {
    method: 'POST',
    headers: { 'x-imf-proxy-token': 'local-test-token' },
  }), {
    PROXY_SHARED_SECRET: 'local-test-token',
    ADMIN_LOGIN_BURST_LIMIT: {
      async limit() { throw new Error('local binding unavailable'); },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(dispatched, 1);
});

test('Worker rejects requests that do not come through the secret Pages proxy', async () => {
  let dispatched = 0;
  const handler = createWorkerFetchHandler(async () => {
    dispatched += 1;
    return Response.json({ ok: true });
  }, logger);
  const response = await handler(new Request('https://api.example/api/health'), {
    PROXY_SHARED_SECRET: 'local-test-token',
  });
  assert.equal(response.status, 403);
  assert.equal(dispatched, 0);
});

test('daily Supabase activity check runs through the scheduled handler without changing rows', async () => {
  const messages = [];
  let completed;
  const scheduled = createScheduledHandler(
    async () => { messages.push('checked'); },
    { info: (message) => messages.push(message), error: (message) => messages.push(message) },
  );
  scheduled({}, {}, { waitUntil: (promise) => { completed = promise; } });
  await completed;
  assert.deepEqual(messages, ['checked', 'Supabase activity check completed.']);
});
