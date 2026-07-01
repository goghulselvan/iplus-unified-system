-- Sync only schools that have registrations (optimized to avoid timeout)
UPDATE public.schools s
SET total_participants = sub.cnt, updated_at = now()
FROM (
  SELECT sr.school_id, COUNT(*) as cnt
  FROM public.student_subjects ss
  INNER JOIN public.student_registrations sr ON ss.registration_id = sr.id
  WHERE COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%'
  GROUP BY sr.school_id
) sub
WHERE s.id = sub.school_id;