-- Prospect Schools and CRM Schools are separate tables with no automatic
-- sync. Staff adding a phone/email in Prospect Schools (the natural place
-- to record it when a school calls in or gets contacted) never reached the
-- linked CRM school row — so WhatsApp/email sends kept failing with
-- "missing recipient" even after the number was added, just in the wrong
-- table. Fill the gap only (never overwrite an existing school value).

create or replace function public.trg_fn_sync_prospect_contact_to_school()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.mobile is distinct from OLD.mobile and NEW.mobile is not null and NEW.mobile <> '' then
    update schools set mobile1 = NEW.mobile
    where prospect_school_id = NEW.id and (mobile1 is null or mobile1 = '');
  end if;

  if NEW.email is distinct from OLD.email and NEW.email is not null and NEW.email <> '' then
    update schools set email = NEW.email
    where prospect_school_id = NEW.id and (email is null or email = '');
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_prospect_contact_to_school on public.prospect_schools;
create trigger trg_sync_prospect_contact_to_school
  after update on public.prospect_schools
  for each row execute function public.trg_fn_sync_prospect_contact_to_school();
