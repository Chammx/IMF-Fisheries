function getBackendOrigin() {
  const value = process.env.IMF_API_URL?.trim();
  if (!value) throw new Error('Backend API is not configured.');

  const backend = new URL(value);
  if (
    backend.protocol !== 'https:'
    || backend.username
    || backend.password
    || backend.search
    || backend.hash
    || !['', '/'].includes(backend.pathname)
  ) {
    throw new Error('Backend API must be configured as an HTTPS origin.');
  }
  return backend.origin;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'OPTIONS'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, OPTIONS');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let target;
  try {
    const requestUrl = new URL(req.url, 'https://frontend.invalid');
    if (
      requestUrl.origin !== 'https://frontend.invalid'
      || !requestUrl.pathname.startsWith('/api/')
    ) {
      res.status(400).json({ error: 'Invalid API route.' });
      return;
    }
    target = new URL(`${requestUrl.pathname}${requestUrl.search}`, getBackendOrigin());
  } catch (error) {
    res.status(error.message === 'Backend API is not configured.' ? 503 : 500)
      .json({ error: 'Backend API is not configured.' });
    return;
  }

  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'origin', 'x-forwarded-for', 'x-forwarded-proto']) {
    const value = req.headers[name];
    if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'OPTIONS'
        ? {}
        : { body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    res.statusCode = upstream.status;
    for (const name of ['content-type', 'cache-control', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers', 'access-control-allow-methods']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (upstream.status === 204 || upstream.status === 304) {
      res.end();
      return;
    }
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`Backend proxy failed: ${error.message}`);
    res.status(502).json({ error: 'The enquiry service is temporarily unavailable.' });
  }
}
