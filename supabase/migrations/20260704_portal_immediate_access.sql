-- Portal Immediate Access: remove approval gate so schools land on dashboard right after registration.
-- Staff role changes from "approving" to "linking" (matching registration to CRM school).

-- 1. Make school_id nullable so portal accounts can exist before staff links to a CRM school
ALTER TABLE public.school_portal_accounts
  ALTER COLUMN school_id DROP NOT NULL;

-- 2. Ensure unique constraint on user_id (required for ON CONFLICT in trigger below)
CREATE UNIQUE INDEX IF NOT EXISTS idx_spa_user_id
  ON public.school_portal_accounts (user_id);

-- 3. Drop old welcome trigger on schools (fired when registration_status = 'In Progress')
--    Welcome is now sent immediately at registration, not at staff approval.
DROP TRIGGER IF EXISTS trg_welcome_on_registration_start ON public.schools;
DROP TRIGGER IF EXISTS trg_fn_welcome_on_registration_start ON public.schools;
DROP FUNCTION IF EXISTS public.trg_fn_welcome_on_registration_start();

-- 4. Drop old invite-portal-user trigger on school_portal_registrations
--    Account creation is now handled by the new INSERT trigger below.
DROP TRIGGER IF EXISTS trg_invite_portal_user ON public.school_portal_registrations;
DROP FUNCTION IF EXISTS public.trg_fn_invite_portal_user();

-- 5. New trigger: create portal account + fire welcome immediately on registration INSERT
CREATE OR REPLACE FUNCTION public.trg_fn_on_portal_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Skip if auth user not created yet (user_id set by complete-school-registration edge fn)
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Grant portal access immediately (school_id left null until staff links)
  INSERT INTO public.school_portal_accounts (user_id, school_id, is_active, linked_at)
  VALUES (NEW.user_id, NULL, true, now())
  ON CONFLICT (user_id) DO NOTHING;

  -- Fire welcome WA + email async (pg_net — non-blocking)
  PERFORM net.http_post(
    url     := 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/notify-registration-welcome',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4'
    ),
    body    := jsonb_build_object('registration_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_portal_registration_insert ON public.school_portal_registrations;
CREATE TRIGGER trg_on_portal_registration_insert
  AFTER INSERT ON public.school_portal_registrations
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_on_portal_registration_insert();

-- 6. Backfill: grant access to schools that registered before this migration
INSERT INTO public.school_portal_accounts (user_id, school_id, is_active, linked_at)
SELECT spr.user_id, NULL, true, now()
FROM   public.school_portal_registrations spr
WHERE  spr.user_id IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1 FROM public.school_portal_accounts spa WHERE spa.user_id = spr.user_id
  )
ON CONFLICT (user_id) DO NOTHING;
