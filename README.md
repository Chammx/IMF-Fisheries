# IMF Fisheries

International B2B seafood export enquiry website for overseas importers, distributors, wholesalers, food businesses, and sourcing companies. The original homepage design is preserved and extended with a product catalogue, RFQ capture, SEO product pages, Supabase-backed enquiry storage, and a session-protected admin dashboard.

## Project layout

- `frontend/` — public homepage, RFQ, product landing pages generated at build, admin dashboard, and same-origin Vercel/Cloudflare API proxies.
- `backend/` — Express API, validation, server-side Supabase access, admin sessions, Railway configuration, and Cloudflare Workers entry/configuration.
- `supabase/schema.sql` — enquiry schema and upgrade-safe RFQ/admin tracking columns.

See `DEPLOYMENT.md` for the ₹0/month Cloudflare Pages + Workers + existing Supabase starting architecture, its actual limits, setup instructions, and launch checks. Free tiers do not provide a production uptime commitment or automatic Supabase backups; export enquiry data regularly and do not rely on this setup for records that cannot be lost. Product specifications, availability, certifications, approvals, and logistics commitments are not invented; confirm them before publishing verified company information.

### External setup still required

Preview deployment and live database testing require Cloudflare account access and existing Supabase credentials entered directly into Cloudflare's secret manager. The production domain remains on GoDaddy; changing DNS, publishing the domain, or applying database migrations requires separate approval. Keep all backend secrets in server-side secret managers and never in frontend code or public frontend build variables.
