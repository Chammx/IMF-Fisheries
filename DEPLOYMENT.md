# IMF Fisheries deployment

The original homepage remains the public landing page. Vercel builds a static buyer-facing site, product SEO pages, `robots.txt` and `sitemap.xml`; a same-origin Vercel API function forwards enquiry and admin requests to the Railway API.

## Supabase

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor. It creates the enquiry table and safely adds RFQ/admin-tracking columns to an existing table.
2. Keep row-level security enabled with no public policies. The API accesses the database with the service-role key, which belongs only in Railway's environment.
3. Supabase project credentials are required before storing real enquiries can be tested.

## Railway backend

- Connect the repository and set the service root directory to `backend`. Railway uses `backend/railway.toml`; the included `backend/Dockerfile` is an alternative.
- Set Railway variables using `backend/.env.example`: `NODE_ENV=production`, `PORT` (Railway supplies its assigned port), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, and `FRONTEND_ORIGIN`.
- Create an admin password verifier in a local terminal from the `backend` directory with `npm run hash-admin-password`. The password input is hidden; store the resulting scrypt hash in Railway as `ADMIN_PASSWORD_HASH`. Do not put the password itself in an environment file.
- Generate `ADMIN_SESSION_SECRET` with `openssl rand -hex 32`. Do not commit the generated secret.
- `FRONTEND_ORIGIN` must contain the exact deployed Vercel origin. Comma-separate only the specific trusted origins you need.
- Check `/api/health` after deployment. It reports whether Supabase credentials are present; it does not expose them.

## Vercel frontend and API proxy

- Import the repository and set the Vercel project root directory to `frontend`. `frontend/vercel.json` builds to `dist`.
- Set `IMF_API_URL` in the Vercel environment to the Railway HTTPS origin (for example `https://your-service.up.railway.app`). It is consumed by the serverless API proxy and is not written into browser configuration.
- Set `SITE_URL` to the canonical production frontend origin. If omitted on Vercel, the production project URL is used when available.
- Do not set or copy `SUPABASE_SERVICE_ROLE_KEY`, admin password, password hash, or session secret to Vercel.
- The Vercel API proxy forwards only `/api/*` requests and uses the configured backend origin. Admin session cookies are HTTP-only; they are not stored in local storage.

## Buyer RFQ and product content

The RFQ captures buyer and company details, business email, international phone, country, product, quantity, preferred packaging, destination, additional requirements, and message. Client/server validation, rate limiting, and a honeypot are in place. The database is the source of truth for successful submission confirmation.

The product catalogue is data-driven in `frontend/products.js`. The build creates individual product landing pages and sitemap entries; the local `frontend/product.html` displays the same data. Sizes, grades, processing formats, packaging, availability, certifications, market approvals, capacity, cold-chain and shipping terms are intentionally not asserted unless verified and confirmed for an individual offer.

Replace example or incomplete company contact details only with verified business information. This project currently makes no certification, destination-market approval, or logistics-service claims.

## Local checks

- Backend: `cd backend && npm test && npm audit --omit=dev`
- Frontend tests: `cd frontend && npm test`
- Static production build: `IMF_API_URL=https://api.example.test SITE_URL=https://site.example.test npm run build` from `frontend`. Use actual HTTPS origins for deployment, not these test domains.
- Local enquiry storage and database-backed admin management require valid Supabase credentials and the SQL schema.
