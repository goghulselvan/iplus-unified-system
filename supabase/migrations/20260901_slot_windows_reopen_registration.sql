-- ============================================================================
-- Re-open student registration + split the two exam-slot selection windows
--   iPlus Olympiads 2026 (project dd5de83d-64f8-4113-a231-27024058396b)  2026-09-01
--
-- (a) Student registration was closed (deadline 2026-08-31 18:29:59+00 = 01 Sep
--     00:00 IST), so the portal Register page is showing the off-season
--     "register your interest for 2027" form. Move the deadline to 30 Sep 2026
--     23:59:59 IST so schools can register again. The portal Register page reads
--     olympiad_projects.registration_deadline live (polled), and the
--     portal_registration_open(project_id) RLS gate added in 20260831 reads the
--     same column, so this single UPDATE re-opens both the UI and the writes.
--
-- (b) Slot 1 (13-15 Oct) exam-slot selection is closed to schools: set its
--     booking_deadline to a past date. is_active stays TRUE so CRM staff can
--     still assign Slot 1 as an override via apply_slot_template_to_school
--     (that RPC checks is_active, never the deadline).
--
-- (c) Slot 2 (10-12 Nov) selection stays open through 30 Sep 2026. The portal
--     now reads booking_deadline as end-of-day IST, so the bare date 2026-09-30
--     keeps Slot 2 selectable through all of Sep 30 IST.
-- ============================================================================

BEGIN;

UPDATE public.olympiad_projects
SET registration_deadline = TIMESTAMPTZ '2026-09-30 23:59:59+05:30'
WHERE id = 'dd5de83d-64f8-4113-a231-27024058396b';

UPDATE public.exam_slot_templates
SET booking_deadline = DATE '2026-08-31'
WHERE id = 'b6e13e39-d7a5-4468-bcde-097402c5cc28';

UPDATE public.exam_slot_templates
SET booking_deadline = DATE '2026-09-30'
WHERE id = '3d2c70e0-7ad5-41c8-9e77-554e1d0560a3';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901', 'slot_windows_reopen_registration')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- verification (last result set is what the CLI prints)
SELECT 'project'::text AS what,
       registration_deadline::text AS value
FROM public.olympiad_projects
WHERE id = 'dd5de83d-64f8-4113-a231-27024058396b'
UNION ALL
SELECT 'slot: ' || slot_name, booking_deadline::text
FROM public.exam_slot_templates
WHERE id IN ('b6e13e39-d7a5-4468-bcde-097402c5cc28',
             '3d2c70e0-7ad5-41c8-9e77-554e1d0560a3')
ORDER BY what;
