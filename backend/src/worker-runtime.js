import { timingSafeEqual } from 'node:crypto';

const burstPolicies = new Map([
  ['/api/enquiries', { binding: 'ENQUIRY_BURST_LIMIT', message: 'Too many enquiries. Please try again shortly.' }],
  ['/api/admin/login', { binding: 'ADMIN_LOGIN_BURST_LIMIT', message: 'Too many sign-in attempts. Please try again shortly.' }],
]);

export function createWorkerFetchHandler(dispatch, logger = console) {
  return async (request, env) => {
    const expectedToken = env.PROXY_SHARED_SECRET || '';
    const receivedToken = request.headers.get('x-imf-proxy-token') || '';
    const expectedBytes = Buffer.from(expectedToken);
    const receivedBytes = Buffer.from(receivedToken);
    if (
      !expectedBytes.length
      || expectedBytes.length !== receivedBytes.length
      || !timingSafeEqual(expectedBytes, receivedBytes)
    ) {
      return Response.json({ error: 'Unauthorized API proxy.' }, {
        status: expectedBytes.length ? 403 : 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const url = new URL(request.url);
    const policy = request.method === 'POST' ? burstPolicies.get(url.pathname) : null;
    if (policy) {
      const limiter = env[policy.binding];
      if (limiter) {
        const ip = request.headers.get('x-imf-client-ip') || request.headers.get('cf-connecting-ip') || 'unknown';
        try {
          const result = await limiter.limit({ key: `imf-fisheries:${url.pathname}:${ip}` });
          if (!result.success) {
            return Response.json({ error: policy.message }, {
              status: 429,
              headers: { 'Cache-Control': 'no-store' },
            });
          }
        } catch (error) {
          // The Express window limiter remains active if Cloudflare's burst
          // limiter is unavailable. Do not turn a control-plane outage into
          // an enquiry outage.
          logger.error(`Cloudflare burst limiter failed: ${error.message}`);
        }
      }
    }
    return dispatch(request);
  };
}

export function createScheduledHandler(checkDatabaseActivity, logger = console) {
  return (_controller, _env, context) => {
    context.waitUntil(Promise.resolve()
      .then(checkDatabaseActivity)
      .then(() => logger.info('Supabase activity check completed.'))
      .catch((error) => {
        logger.error(`Supabase activity check failed (${error.name || 'Error'}).`);
      }));
  };
}
