import crypto from 'node:crypto';

const SESSION_COOKIE = 'imf_admin_session';
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password, encodedHash) {
  const [algorithm, salt, expectedHex, extra] = String(encodedHash || '').split('$');
  if (
    algorithm !== 'scrypt'
    || !/^[a-f0-9]{32}$/i.test(salt || '')
    || !/^[a-f0-9]{128}$/i.test(expectedHex || '')
    || extra !== undefined
  ) {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, 64);
  return safeEqual(actual, Buffer.from(expectedHex, 'hex'));
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAdminSession(username, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(now / 1000) + SESSION_LIFETIME_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSession(token, secret, now = Date.now()) {
  if (!token || !secret || typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(payload, secret))) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof claims.sub !== 'string'
      || !Number.isInteger(claims.exp)
      || claims.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function getAdminSessionCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const pair = cookieHeader.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) return '';
  try {
    return decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1));
  } catch {
    return '';
  }
}

export function setAdminSessionCookie(res, req, token) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/api/admin',
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; '));
}

export function clearAdminSessionCookie(res, req) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=`,
    'Path=/api/admin',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; '));
}

export const adminSessionLifetimeSeconds = SESSION_LIFETIME_SECONDS;
