# IMF Fisheries

International B2B seafood export enquiry website for overseas importers, distributors, wholesalers, food businesses, and sourcing companies. The original homepage design is preserved and extended with a product catalogue, RFQ capture, SEO product pages, Supabase-backed enquiry storage, and a session-protected admin dashboard.

## Project layout

- `frontend/` — public homepage, RFQ, product landing pages generated at build, admin dashboard, and Vercel API proxy.
- `backend/` — Express API, validation, server-side Supabase access, admin sessions, and Railway configuration.
- `supabase/schema.sql` — enquiry schema and upgrade-safe RFQ/admin tracking columns.

See `DEPLOYMENT.md` for environment setup and deployment. Product specifications, availability, certifications, approvals, and logistics commitments are not invented; confirm them before publishing verified company information.

### External setup still required

Public launch and live database testing require Supabase project credentials, the SQL schema to be applied, and Vercel/Railway account authorization. Keep all backend secrets in Railway environment variables and never in frontend code or Vercel public variables.
