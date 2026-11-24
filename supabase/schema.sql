create extension if not exists pgcrypto;
create table if not exists public.enquiries (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 company text not null default '',
 email text not null,
 phone text not null default '',
 country text not null,
 enquiry_type text not null,
 product text not null default '',
 quantity text not null default '',
 packaging text not null default '',
 destination text not null default '',
 requirements text not null default '',
 message text not null,
 status text not null default 'new' check(status in ('new','contacted','quoted','closed')),
 internal_notes text not null default '',
 follow_up_at timestamptz,
 last_contacted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.enquiries
  add column if not exists packaging text not null default '',
  add column if not exists destination text not null default '',
  add column if not exists requirements text not null default '',
  add column if not exists internal_notes text not null default '',
  add column if not exists follow_up_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.enquiries enable row level security;
-- No public policies: all access is via server-side service-role API, never client-side keys.

create index if not exists enquiries_created_at_idx
  on public.enquiries (created_at desc);
create index if not exists enquiries_status_idx
  on public.enquiries (status);
create index if not exists enquiries_follow_up_at_idx
  on public.enquiries (follow_up_at)
  where follow_up_at is not null;
