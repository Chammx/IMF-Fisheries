function getBackendOrigin(value) {
  if (!value?.trim()) throw new Error('Backend API is not configured.');

  const backend = new URL(value.trim());
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

export async function onRequest({ request, env }) {
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'OPTIONS'].includes(method)) {
    return Response.json({ error: 'Method not allowed.' }, {
      status: 405,
      headers: { Allow: 'GET, POST, PATCH, OPTIONS' },
    });
  }

  let target;
  try {
    const requestUrl = new URL(request.url);
    if (!requestUrl.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Invalid API route.' }, { status: 400 });
    }
    target = new URL(`${requestUrl.pathname}${requestUrl.search}`, getBackendOrigin(env.IMF_API_URL));
  } catch (error) {
    const status = error.message === 'Backend API is not configured.' ? 503 : 500;
    return Response.json({ error: 'Backend API is not configured.' }, { status });
  }

  const proxySecret = env.PROXY_SHARED_SECRET?.trim();
  if (!proxySecret) {
    return Response.json({ error: 'Backend API is not configured.' }, { status: 503 });
  }

  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'origin']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-imf-proxy-token', proxySecret);
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    headers.set('x-imf-client-ip', clientIp);
    headers.set('x-forwarded-for', clientIp);
  }
  headers.set('x-forwarded-proto', 'https');

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: request.body }),
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  } catch (error) {
    console.error(`Backend proxy failed: ${error.message}`);
    return Response.json({ error: 'The enquiry service is temporarily unavailable.' }, { status: 502 });
  }
}
