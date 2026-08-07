-- Staff list for AI voicebot live call transfer (Call Center page).
-- trigger-human-transfer picks a random active row instead of a single
-- hardcoded TRANSFER_PHONE secret.

create table public.transfer_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transfer_staff enable row level security;

create policy crm_all_transfer_staff on public.transfer_staff
  for all using (is_crm_user()) with check (is_crm_user());
