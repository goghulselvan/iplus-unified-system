-- WhatsApp inbound replies captured by wa-delivery-webhook
create table if not exists public.wa_replies (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  sender_name text,
  message_text text,
  message_type text,
  msg_wamid text unique,
  context_wamid text,
  campaign_school_id uuid references public.campaign_schools(id) on delete set null,
  received_at timestamptz not null default now(),
  raw jsonb
);

alter table public.wa_replies enable row level security;

create policy "Authenticated can read wa_replies"
  on public.wa_replies for select
  to authenticated
  using (true);

create index if not exists idx_wa_replies_phone on public.wa_replies(phone);
create index if not exists idx_wa_replies_received_at on public.wa_replies(received_at desc);

-- Match an inbound phone (last 10 digits) to the most recent campaign send.
-- Called by wa-delivery-webhook (service role) when a reply has no quoted-message context.
create or replace function public.match_campaign_school_by_phone(p_last10 text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cs.id
  from campaign_schools cs
  join prospect_schools ps on ps.id = cs.prospect_school_id
  where cs.wamid is not null
    and regexp_replace(coalesce(ps.mobile, ''), '\D', '', 'g') like '%' || p_last10
  order by cs.sent_at desc nulls last
  limit 1;
$$;

revoke execute on function public.match_campaign_school_by_phone(text) from public, anon, authenticated;
grant execute on function public.match_campaign_school_by_phone(text) to service_role;
