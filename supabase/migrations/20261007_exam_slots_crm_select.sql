-- exam_slots was readable only by superadmin (superadmin_all_es) plus the
-- portal school reading its own row. Every staff-facing surface that shows slot
-- data until now went through SECURITY DEFINER RPCs (get_olympiad_stats,
-- get_olympiad_participations, apply_slot_template_to_school), which bypass RLS
-- entirely — so the gap never surfaced.
--
-- The campaign recipient filter reads the table directly to map school -> slot.
-- Without this policy a manager or accountant gets zero rows, every school
-- falls into the "not assigned" bucket, and a Slot 1 campaign silently matches
-- nothing instead of erroring. Read-only: writes stay superadmin-only via
-- superadmin_all_es, and exam_slot_templates already grants is_crm_user().

CREATE POLICY crm_select_exam_slots
  ON public.exam_slots
  FOR SELECT
  USING (public.is_crm_user());
