-- Voice templates: reusable Sarvam-generated audio messages for operational school calls
create table if not exists public.voice_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language_code text not null default 'en-IN',
  speaker text not null default 'anushka',
  source_script text,
  final_script text not null,
  wav_path text,
  mulaw_path text,
  duration_seconds integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.voice_templates enable row level security;

create policy "Authenticated manage voice_templates"
  on public.voice_templates for all
  to authenticated
  using (true)
  with check (true);

-- Public bucket: Bonvoice must be able to fetch audio by URL for call playback
insert into storage.buckets (id, name, public)
values ('voice-templates', 'voice-templates', true)
on conflict (id) do nothing;

create policy "Authenticated delete voice-template audio"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'voice-templates');
