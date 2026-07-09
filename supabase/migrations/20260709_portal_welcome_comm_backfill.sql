-- Portal welcome (WA + email) fires before any CRM school row exists, so it
-- was never logged to communications (school_id is NOT NULL there). Record
-- what was sent + when on the registration row, then backfill into
-- communications the moment it gets linked to a real CRM school.

alter table public.school_portal_registrations
  add column if not exists welcome_email_sent_at timestamptz,
  add column if not exists welcome_whatsapp_sent_at timestamptz;

create or replace function public.trg_fn_backfill_welcome_comms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  if NEW.matched_school_id is null or OLD.matched_school_id is not null then
    return NEW;
  end if;

  v_project_id := coalesce(
    NEW.project_id,
    (select id from olympiad_projects where is_active = true limit 1)
  );
  if v_project_id is null then
    return NEW;
  end if;

  if NEW.welcome_email_sent_at is not null then
    insert into communications (school_id, project_id, communication_type, message, contacted_person_name, user_id, created_at)
    values (NEW.matched_school_id, v_project_id, 'Email', 'Portal welcome email sent on registration',
            NEW.contact_name, '8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc', NEW.welcome_email_sent_at);
  end if;

  if NEW.welcome_whatsapp_sent_at is not null then
    insert into communications (school_id, project_id, communication_type, message, contacted_mobile_no, user_id, created_at)
    values (NEW.matched_school_id, v_project_id, 'WhatsApp', 'Portal welcome WhatsApp sent on registration',
            NEW.phone, '8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc', NEW.welcome_whatsapp_sent_at);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_backfill_welcome_comms on public.school_portal_registrations;
create trigger trg_backfill_welcome_comms
  after update on public.school_portal_registrations
  for each row execute function public.trg_fn_backfill_welcome_comms();
