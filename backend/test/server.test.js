import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminSession,
  createPasswordHash,
  setAdminSessionCookie,
  verifyAdminSession,
} from '../src/admin-auth.js';

const adminPassword = 'Test-only-Admin-Password-2026';
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.FRONTEND_ORIGIN = 'http://localhost:8000';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD_HASH = createPasswordHash(adminPassword, 'a'.repeat(32));
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { app } = await import('../src/server.js');
let server;
let baseUrl;
let adminCookie;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const validEnquiry = {
  name: 'Test Buyer',
  company: 'Test Importers Ltd',
  email: 'buyer@example.com',
  phone: '+44 20 1234 5678',
  country: 'United Kingdom',
  type: 'Export quotation request',
  product: 'Mud crab',
  qty: '2 metric tonnes',
  packaging: 'Please confirm available export packaging',
  destination: 'Port of London',
  requirements: 'Please confirm requested size and applicable documents.',
  message: 'Please review this test export quotation request.',
  website: '',
};

test('health reports whether Supabase is configured without exposing credentials', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    databaseConfigured: false,
  });
});

test('CORS allows configured international frontend origins with credentials', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:8000' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8000');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('CORS rejects origins that are not configured', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(response.status, 403);
});

test('rejects invalid RFQ details including a phone number without country code', async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validEnquiry, phone: '020 1234 5678' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Please check your export enquiry details.');
});

test('rejects missing destination, quantity, or business information', async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validEnquiry, destination: '', company: '' }),
  });
  assert.equal(response.status, 400);
});

test('returns clear errors for malformed and oversized JSON bodies', async () => {
  const malformed = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'Invalid JSON request body.');

  const oversized = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validEnquiry, message: 'x'.repeat(21 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'Request is too large.');
});

test('valid RFQs are not reported as stored when Supabase is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validEnquiry),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /storage is not configured/i);
});

test('honeypot submissions are accepted without being stored', async () => {
  const response = await fetch(`${baseUrl}/api/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validEnquiry, website: 'spam.example' }),
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).ok, true);
});

test('admin endpoints reject requests without an authenticated session', async () => {
  const response = await fetch(`${baseUrl}/api/admin/enquiries`);
  assert.equal(response.status, 401);
});

test('admin login issues an HttpOnly cookie and authenticates a session', async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: adminPassword }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i);
  adminCookie = cookie.split(';', 1)[0];

  const session = await fetch(`${baseUrl}/api/admin/session`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true, username: 'test-admin' });
});

test('rejects invalid admin credentials', async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-admin', password: 'Wrong-password-2026' }),
  });
  assert.equal(response.status, 401);
});

test('authenticated admin access remains protected when the database is unavailable', async () => {
  const response = await fetch(`${baseUrl}/api/admin/enquiries`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'Database not configured');
});

test('admin update validation runs after authentication and before database access', async () => {
  const invalidId = await fetch(`${baseUrl}/api/admin/enquiries/not-a-uuid`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'invalid' }),
  });
  assert.equal(invalidId.status, 400);

  const excessiveNotes = await fetch(`${baseUrl}/api/admin/enquiries/123e4567-e89b-12d3-a456-426614174000`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ internal_notes: 'x'.repeat(5001) }),
  });
  assert.equal(excessiveNotes.status, 400);
});

test('admin logout clears the session cookie and the session is no longer accepted', async () => {
  const response = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);

  const session = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(session.status, 401);
});

test('signed sessions reject tampering and expired sessions', () => {
  const token = createAdminSession(
    'test-admin',
    process.env.ADMIN_SESSION_SECRET,
    1_000_000,
  );
  assert.equal(verifyAdminSession(token, process.env.ADMIN_SESSION_SECRET, 1_000_001).sub, 'test-admin');
  assert.equal(verifyAdminSession(token, process.env.ADMIN_SESSION_SECRET, 99_000_000), null);
  assert.equal(verifyAdminSession(`${token}x`, process.env.ADMIN_SESSION_SECRET, 1_000_001), null);
});

test('production admin cookies require HTTPS and use same-site protection', () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const headers = {};
  setAdminSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, { secure: false }, 'session');
  process.env.NODE_ENV = previousEnvironment;

  assert.match(headers['Set-Cookie'], /Secure/i);
  assert.match(headers['Set-Cookie'], /SameSite=Lax/i);
  assert.doesNotMatch(headers['Set-Cookie'], /SameSite=None/i);
});
