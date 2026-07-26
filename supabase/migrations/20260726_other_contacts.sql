-- "Other Contacts" — a small directory for numbers that call in (visible on the
-- brochure) but aren't schools: couriers, delivery, vendors, personal, spam.
-- Tagging a number here permanently stops it from ever creating/reopening a
-- Follow-up Queue entry, and remembers who they are for future calls.

CREATE TABLE public.other_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_last10 text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Courier', 'Delivery', 'Vendor', 'Personal', 'Spam', 'Other')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.other_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_all_other_contacts" ON public.other_contacts
  FOR ALL USING (public.is_crm_user()) WITH CHECK (public.is_crm_user());

CREATE OR REPLACE FUNCTION public.tag_as_other_contact(
  p_last10 text, p_name text, p_category text, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_last10 !~ '^[6-9]\d{9}$' THEN
    RETURN jsonb_build_object('error', 'invalid number');
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'name is required');
  END IF;

  INSERT INTO public.other_contacts (phone_last10, name, category, notes, created_by)
  VALUES (p_last10, trim(p_name), p_category, NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid())
  ON CONFLICT (phone_last10) DO UPDATE
    SET name = EXCLUDED.name, category = EXCLUDED.category, notes = EXCLUDED.notes, updated_at = now();

  -- Immediately clear it out of the Follow-up Queue rather than waiting for
  -- the next missed-call cycle.
  UPDATE public.call_followups
  SET state = 'done', resolution = 'other_contact', resolution_note = trim(p_name),
      resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
  WHERE phone_last10 = p_last10 AND state <> 'done';

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.untag_other_contact(p_last10 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.other_contacts WHERE phone_last10 = p_last10;
  RETURN jsonb_build_object('success', true);
END;
$function$;

-- Suppress: a tagged number never creates or reopens a follow-up again.
CREATE OR REPLACE FUNCTION public.handle_call_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last10 text;
BEGIN
  v_last10 := right(regexp_replace(coalesce(NEW.school_phone,''), '\D', '', 'g'), 10);
  IF length(v_last10) < 10 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.other_contacts WHERE phone_last10 = v_last10) THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'inbound' AND NEW.status = 'no_answer' THEN
    INSERT INTO call_followups (phone_last10, school_id, prospect_school_id)
    VALUES (v_last10, NEW.school_id, NEW.prospect_school_id)
    ON CONFLICT (phone_last10) DO UPDATE
      SET state           = CASE WHEN call_followups.state = 'done' THEN 'open' ELSE call_followups.state END,
          resolved_at     = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolved_at END,
          resolved_by     = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolved_by END,
          resolution      = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolution END,
          resolution_note = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolution_note END,
          school_id           = COALESCE(call_followups.school_id, EXCLUDED.school_id),
          prospect_school_id  = COALESCE(call_followups.prospect_school_id, EXCLUDED.prospect_school_id),
          updated_at = now();
  ELSIF NEW.status IN ('answered','completed') AND COALESCE(NEW.call_duration, 0) > 0 THEN
    UPDATE call_followups
      SET state = 'done', resolution = 'connected', resolved_at = now(), updated_at = now()
      WHERE phone_last10 = v_last10 AND state <> 'done';
  END IF;

  RETURN NEW;
END;
$function$;
