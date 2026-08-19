-- Correction: district_codes for Tamil Nadu, Andhra Pradesh, Telangana and
-- Karnataka were already fully seeded (an earlier same-day migration draft
-- wrongly assumed AP/Telangana/Karnataka were empty off a single failed lookup —
-- checked the full existing tables before writing this). The real gaps, found by
-- checking every real school's district against the existing reference tables:
--
-- 1. Andhra Pradesh reorganised from 26 to 28 districts on 2025-12-31 (Markapuram,
--    Polavaram) — reference table still has the old 26. No schools use the new two
--    yet, but a future AP school in either can't register without this.
-- 2. Karnataka added Vijayanagara (split from Ballari) — reference table has the
--    other 30 official districts but not this one.
-- 3. Exactly one real school's `district` doesn't match anything in its state's
--    reference list: "Belagavi Chikkodi" (Karnataka) — Chikkodi isn't a confirmed
--    standalone official district as of this writing; normalizing to the existing
--    canonical "Belagavi" rather than inventing an unconfirmed district code.
-- 4. Exactly one more: "Medchal Malkajgiri" (Telangana, space) vs the canonical
--    "Medchal-Malkajgiri" (hyphen) already in the reference table — same district,
--    just a formatting mismatch. Normalizing the school's stored value to match.

INSERT INTO district_codes (state_code, district_name, district_code, is_active)
VALUES
  ('28', 'Markapuram', '027', true),
  ('28', 'Polavaram', '028', true),
  ('29', 'Vijayanagara', '031', true)
ON CONFLICT (state_code, district_code) DO NOTHING;

UPDATE schools SET district = 'Belagavi' WHERE district = 'Belagavi Chikkodi' AND state = 'Karnataka';
UPDATE schools SET district = 'Medchal-Malkajgiri' WHERE district = 'Medchal Malkajgiri' AND state = 'Telangana';

-- Backfill part 1: rows where the CRM's CSV bulk-upload never set submitted_at
-- (separate frontend fix applied alongside this migration) — setting it now fires
-- the existing AFTER UPDATE OF submitted_at trigger, which assigns registration
-- numbers through the same safe, advisory-locked path as every other row.
UPDATE portal_student_enrollments
SET submitted_at = now()
WHERE submitted_at IS NULL;

-- Backfill part 2: rows where submitted_at was already set but the trigger's
-- silent catch-all swallowed a failure (no retry existed before this). Retry each
-- directly, one at a time so one still-bad row can't abort the rest, and report
-- what happened per row.
DO $$
DECLARE
  v_id uuid;
  v_ok integer := 0;
  v_failed integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM portal_student_enrollments
    WHERE submitted_at IS NOT NULL AND registration_number IS NULL
  LOOP
    BEGIN
      PERFORM assign_registration_number(v_id);
      v_ok := v_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'assign_registration_number still failing for enrollment %: %', v_id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Backfill complete: % succeeded, % still failing', v_ok, v_failed;
END $$;
