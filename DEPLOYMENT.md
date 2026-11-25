# IMF Fisheries hosting and deployment guide

This guide describes the ₹0/month starting architecture prepared in this repository. It has not been deployed. The production domain remains with GoDaddy and no DNS records should be changed until the owner approves the final launch.

## Architecture and costs

| Service | Use | Starting cost | Limits that matter |
| --- | --- | ---: | --- |
| Cloudflare Pages Free | Static site, HTTPS, GitHub builds, same-origin API proxy | ₹0/month | No production uptime commitment; project build and function limits apply. Pages Functions run on the Workers platform. |
| Cloudflare Workers Free | Existing Express API through Cloudflare's Node HTTP compatibility adapter | ₹0/month | 100,000 requests/day, 10 ms CPU/request, 50 subrequests/request, and 128 MB memory. Hitting a quota can make requests fail. There is no production SLA on this tier. |
| Supabase Free | Existing Postgres database and RLS schema | ₹0/month | 500 MB database, 5 GB egress, no automatic backups, and projects with very low activity can pause after 7 days. No uptime guarantee. |
| GoDaddy | Domain registration and current DNS ownership | Existing registration cost | DNS remains unchanged during this preparation. |

Cloudflare's general terms do not impose a blanket ban on commercial use of Workers/Pages Free, and its Workers documentation describes a default free plan with published limits. However, Cloudflare's broader website plan page describes its Free plan as for personal or hobby projects that are not business-critical. I found no separate Workers/Pages term making this enquiry site categorically ineligible, but this is not an endorsed business-critical service tier. Cloudflare also prohibits processing payment card data on properties using Free Services; this site must not collect card data. Supabase's Free terms do not state a personal-only restriction, but its pricing page positions Free for small projects and it does not provide the operational protections needed for critical enquiry records.

The present zero-cost design is the best viable starting point under the approved budget, not a guarantee of reliable production service. Keep business-critical records in a separate, regularly exported system until a paid backup/availability budget is approved. At ₹0 there is no provider-backed recovery point or uptime commitment for the database/API.

Other free options are a poorer fit: Vercel Hobby is expressly restricted to personal/non-commercial use; Render says not to use Free instances for production, sleeps web services after 15 minutes, and its free Postgres expires after 30 days; Railway Free gives $1 of monthly resource usage, sleeps after 5–10 minutes without outbound activity, and stops when its credit is used. These constraints rule them out for this website's commercial enquiry path.

### Free-tier limitations and mitigations

- **Supabase pausing:** Supabase may pause a Free project after 7 days of very low activity. It says a few real database queries each day are typically enough but not guaranteed. This Worker includes a daily scheduled read-only query of one enquiry ID to reduce the chance of an inactivity pause. This is a best-effort mitigation, not a guarantee or an availability commitment. Monitor the Supabase dashboard and resume a paused project there.
- **Backups:** Supabase Free does not include automatic backups. Export the database regularly to a secure location outside Supabase and check that the export can be restored. Do not use the Worker activity check as a backup. A manual export is not a point-in-time recovery plan.
- **Worker CPU:** Free Workers have a 10 ms CPU limit per request. The existing synchronous scrypt verification is preserved. Admin login must be exercised on a Cloudflare preview using the actual runtime before production launch. If it exceeds the limit, the safe workaround is to use a paid Workers CPU allowance or migrate authentication to a supported managed identity provider; do not lower password hashing work to fit the free limit.
- **Rate limits:** The Express window counters are per Worker isolate. Cloudflare's simple rate-limit bindings add an edge burst limit (10/minute for enquiries and 5/minute for login), but Cloudflare documents these limits as approximate and scoped to a data center, not a strict global quota. They do not replace abuse monitoring.
- **Service continuity:** Free tiers have no production SLA, may change limits, and can reject traffic at quota. If a missed enquiry would cause material business loss, a paid production database/API plan with tested backups is the safe workaround. No paid option is enabled here.

## Compatibility and data safety

Cloudflare Workers supports the Node HTTP server adapter used in `backend/worker.js`; it can host this Express app without replacing its routes or the Supabase database. The Cloudflare adapter is enabled with `nodejs_compat`. The app retains `POST /api/enquiries`, admin login/session/logout/list/update routes, server-side Supabase access, validation, rate limits, signed HttpOnly admin cookies, and the existing SQL/RLS design.

The Pages Function at `frontend/functions/api/[[path]].js` proxies same-origin `/api/*` calls to the Worker. It requires a random `PROXY_SHARED_SECRET`, which is separately stored as a Pages Function secret and a Worker secret. The Worker rejects direct requests without that secret. Supabase service-role key, admin password hash, session signing key, and proxy token are server-side secrets only. Do not put them in GitHub, static frontend files, build variables, chat, or this guide.

`supabase/schema.sql` is the existing additive schema/migration. It enables RLS and does not add anonymous access policies. No schema is applied by deploying code. Do not run destructive SQL or replace the database as part of the launch.

## Cloudflare setup

The following steps use Cloudflare's dashboard. Start with preview hostnames only. They do not require a paid plan or a GoDaddy DNS change.

### 1. Create the Pages preview

1. Sign in to Cloudflare and open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select `Chammx/IMF-Fisheries` and use `frontend` as the root directory.
3. Set the build command to `npm run build` and output directory to `dist`.
4. Add the build variable `SITE_URL=https://imf-fisheries.pages.dev` for the first build. The frontend calls same-origin `/api` routes; the backend origin is configured only in the Pages Function runtime settings later.
5. Deploy the preview and note its exact `*.pages.dev` hostname. Do not attach `imffisheries.com` yet.

### 2. Create the Worker API

1. In **Workers & Pages → Create → Worker**, connect the same GitHub repository and configure `backend` as the root directory.
2. Set install command to `npm ci --include=dev` and deploy command to `npm run deploy:worker`. Alternatively, from the `backend` directory, install dependencies and run `npm run deploy:worker` locally.
3. Keep the generated `*.workers.dev` hostname enabled for the Pages Function upstream. Do not configure a custom domain.
4. In the Worker settings, set the following as **secrets**, never plain vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, and `PROXY_SHARED_SECRET`.
5. Generate a strong random value with a password manager for `PROXY_SHARED_SECRET` and enter the same value into the Pages Function secret manager. Do not paste the value in chat or into source files. Generate the scrypt password hash locally with `npm run hash-admin-password` in `backend`; enter only its output into the Worker secret manager.
6. Set the Worker plain variable `FRONTEND_ORIGIN` to the exact Pages preview origin, for example `https://imf-fisheries.pages.dev`. `NODE_ENV=production` and the rate-limit bindings are in `backend/wrangler.toml`.
7. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the existing Supabase project. Do not create a replacement project or run a schema migration unless separately reviewed and approved.

### 3. Connect the Pages Function

1. In Pages **Settings → Functions → Runtime variables**, set `IMF_API_URL` to the Worker `*.workers.dev` origin and add the same `PROXY_SHARED_SECRET` as a secret.
2. Trigger a new Pages deployment so it includes `frontend/functions/api/[[path]].js`.
3. Confirm the Function forwards the API routes, cookies, trusted client IP, and HTTPS state. Its backend origin must be an HTTPS origin, with no path, credentials, query, or fragment.
4. If the Pages project name differs from `imf-fisheries`, update `SITE_URL` and the preview URL in `backend/wrangler.toml`/Worker `FRONTEND_ORIGIN` to match the actual preview. Deploy the Worker again after changing the config.

### 4. Preview checks before production

Use only a clearly marked test enquiry and remove it only after confirming it is not business data. Verify all of the following on the preview hostname:

1. Homepage, product pages, mobile navigation, and assets load over HTTPS.
2. `GET /api/health` returns HTTP 200. `databaseConfigured` only confirms configuration; it does not prove a live database round-trip.
3. Submit a test enquiry and confirm it is stored in the existing Supabase table and visible in the admin dashboard.
4. Check invalid input, oversized JSON, unauthenticated admin access, login throttling, session cookie flags, status update, and logout.
5. Check the Cloudflare Worker logs for errors and observe CPU time for admin login. Test from mobile and desktop.
6. Verify the public built files and browser network requests contain no service-role key, password hash, signing secret, or proxy secret.

Production deployment and the final end-to-end enquiry test are not complete until these checks pass. A local Worker dry run does not prove the remote Cloudflare runtime, Supabase credentials, RLS, or admin login.

## GoDaddy domain and HTTPS

The domain remains on GoDaddy and DNS has not been changed. After preview verification, attach `imffisheries.com` and any chosen `www` hostname in Cloudflare Pages. Cloudflare will show the exact DNS records it requires. Review those records and obtain explicit owner approval before changing them in GoDaddy. Do not delete existing mail records; preserve Google Workspace/Gmail MX, SPF, DKIM, and DMARC records. Cloudflare issues HTTPS after domain validation and DNS propagation. Verify both the apex and chosen `www` behavior before publishing the canonical URL.

## Database migration, backups, and rollback

- The Worker uses the existing Supabase project; it does not create, migrate, or delete database data during deployment.
- Inspect `supabase/schema.sql` and current project schema before applying any migration. Back up/export first. Do not drop/rename columns while an older application version may still run.
- Create a regular encrypted export outside Supabase and keep access limited. Test a restore in a separate non-production database before relying on it. Free Supabase does not automate this for you.
- Cloudflare keeps deployable Worker/Pages versions for rollback, but a code rollback does not reverse database writes. Roll back frontend and Worker versions together if needed; preserve current database contents before any data recovery action.
- Check Cloudflare usage and logs, Supabase storage/egress, and paused-project notices regularly. Free quotas are not an uptime guarantee.

## Local commands and deployment checks

```sh
cd backend
npm ci
npm test
npm audit
npm run worker:dev
```

```sh
cd frontend
npm test
SITE_URL=https://site.example.test npm run build
```

The source tests use fixtures and do not connect to or mutate the live Supabase database. `wrangler deploy --dry-run` validates the Worker bundle without deploying. A safe preview deployment still requires Cloudflare account authorization and secrets to be entered directly into Cloudflare's secret manager.

## Checked provider terms and documentation

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Express on Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/)
- [Cloudflare Node HTTP adapters](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [Cloudflare rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare Terms of Service](https://www.cloudflare.com/terms/)
- [Vercel Hobby terms](https://vercel.com/legal/terms)
- [Render Free service limits](https://render.com/docs/free)
- [Railway Free plan limits](https://docs.railway.com/pricing/free-plan)
- [Supabase Free plan pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase Free plan backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase pricing](https://supabase.com/pricing)
