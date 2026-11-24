import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  adminSessionLifetimeSeconds,
  clearAdminSessionCookie,
  createAdminSession,
  getAdminSessionCookie,
  setAdminSessionCookie,
  verifyAdminSession,
  verifyPassword,
} from './admin-auth.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());

const localOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
const configuredOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : [...localOrigins]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '20kb' }));

const enquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().regex(/^\+[0-9][0-9\s().-]{6,23}$/),
  country: z.string().trim().min(2).max(100),
  type: z.enum([
    'Export quotation request',
    'Product availability enquiry',
    'Other export enquiry',
  ]),
  product: z.string().trim().min(2).max(160),
  qty: z.string().trim().min(1).max(120),
  packaging: z.string().trim().max(500).optional().default(''),
  destination: z.string().trim().min(2).max(200),
  requirements: z.string().trim().max(2000).optional().default(''),
  message: z.string().trim().min(10).max(4000),
  website: z.string().max(200).optional().default(''),
}).strict();

const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(256),
}).strict();
const enquiryStatusSchema = z.enum(['new', 'contacted', 'quoted', 'closed']);
const adminUpdateSchema = z.object({
  status: enquiryStatusSchema.optional(),
  internal_notes: z.string().trim().max(5000).optional(),
  follow_up_at: z.union([z.string().datetime(), z.null()]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

function isSampleValue(value) {
  return /your_project|replace-with|change-this/i.test(value || '');
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || isSampleValue(url) || isSampleValue(key)) return null;

  const parsedUrl = new URL(url);
  const localHttp = parsedUrl.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);
  if (
    (parsedUrl.protocol !== 'https:' && !localHttp)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || parsedUrl.pathname !== '/'
  ) {
    throw new Error('SUPABASE_URL must be an HTTPS project origin (HTTP is allowed for local Supabase only).');
  }
  return createClient(parsedUrl.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const supabase = createSupabaseClient();

function isAdminConfigured() {
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || '';
  return Boolean(
    process.env.ADMIN_USERNAME
    && !isSampleValue(process.env.ADMIN_USERNAME)
    && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i.test(hash)
    && Buffer.byteLength(sessionSecret) >= 32
    && !isSampleValue(sessionSecret),
  );
}

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const session = verifyAdminSession(getAdminSessionCookie(req), secret);
  if (!session || session.sub !== process.env.ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  req.adminSession = session;
  return next();
}

function safeEqualText(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && actualBytes.length > 0
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    databaseConfigured: Boolean(supabase),
  });
});

app.post('/api/enquiries', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many enquiries. Please try again later.' },
}), async (req, res) => {
  const parsed = enquirySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check your export enquiry details.' });
  }

  const data = parsed.data;
  if (data.website) {
    return res.status(202).json({ ok: true });
  }
  if (!supabase) {
    return res.status(503).json({ error: 'Export enquiry storage is not configured yet.' });
  }

  try {
    const { error } = await supabase.from('enquiries').insert({
      name: data.name,
      company: data.company,
      email: data.email,
      phone: data.phone,
      country: data.country,
      enquiry_type: data.type,
      product: data.product,
      quantity: data.qty,
      packaging: data.packaging,
      destination: data.destination,
      requirements: data.requirements,
      message: data.message,
    });
    if (error) {
      console.error(`Supabase enquiry insert failed: ${error.message}`);
      return res.status(500).json({ error: 'Could not save your enquiry. Please try again later.' });
    }
  } catch (error) {
    console.error(`Supabase enquiry insert threw: ${error.message}`);
    return res.status(500).json({ error: 'Could not save your enquiry. Please try again later.' });
  }

  return res.status(201).json({ ok: true });
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
});

app.post('/api/admin/login', loginRateLimit, async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enter a valid username and password.' });
  }
  if (!isAdminConfigured()) {
    return res.status(503).json({ error: 'Admin sign-in is not configured yet.' });
  }

  const usernameMatches = safeEqualText(parsed.data.username, process.env.ADMIN_USERNAME);
  let passwordMatches = false;
  try {
    passwordMatches = verifyPassword(parsed.data.password, process.env.ADMIN_PASSWORD_HASH);
  } catch (error) {
    console.error(`Admin password verification failed: ${error.message}`);
  }
  if (!usernameMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = createAdminSession(
    process.env.ADMIN_USERNAME,
    process.env.ADMIN_SESSION_SECRET,
  );
  setAdminSessionCookie(res, req, token);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    authenticated: true,
    expiresIn: adminSessionLifetimeSeconds,
  });
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authenticated: true, username: req.adminSession.sub });
});

app.post('/api/admin/logout', (_req, res) => {
  clearAdminSessionCookie(res, _req);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(204).end();
});

app.get('/api/admin/enquiries', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  const statusFilter = req.query.status
    ? enquiryStatusSchema.safeParse(req.query.status)
    : null;
  if (statusFilter && !statusFilter.success) {
    return res.status(400).json({ error: 'Invalid enquiry status filter.' });
  }

  try {
    let query = supabase
      .from('enquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (statusFilter?.success) query = query.eq('status', statusFilter.data);
    const { data, error } = await query;
    if (error) {
      console.error(`Supabase enquiry list failed: ${error.message}`);
      return res.status(500).json({ error: 'Failed to load enquiries' });
    }
    return res.json(data || []);
  } catch (error) {
    console.error(`Supabase enquiry list threw: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load enquiries' });
  }
});

app.patch('/api/admin/enquiries/:id', requireAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    return res.status(400).json({ error: 'Invalid enquiry ID.' });
  }
  const update = adminUpdateSchema.safeParse(req.body);
  if (!update.success) {
    return res.status(400).json({ error: 'Check the enquiry update details.' });
  }
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const changes = {
    ...update.data,
    updated_at: new Date().toISOString(),
  };
  if (update.data.status === 'contacted') {
    changes.last_contacted_at = new Date().toISOString();
  }

  try {
    const { data, error } = await supabase
      .from('enquiries')
      .update(changes)
      .eq('id', id.data)
      .select('id');
    if (error) {
      console.error(`Supabase enquiry update failed: ${error.message}`);
      return res.status(500).json({ error: 'Failed to update enquiry' });
    }
    if (!data?.length) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error(`Supabase enquiry update threw: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update enquiry' });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  if (err?.message === 'Origin not allowed') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error.' });
});

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const port = Number(process.env.PORT || 5000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`IMF Fisheries API listening on ${port}`);
  });
}

export { app };
