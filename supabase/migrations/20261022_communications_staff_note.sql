-- A Click2Call row is written by the system the moment the call is dialled
-- ("Click2Call initiated to 9360226654 via Bonvoice"), before anyone has
-- spoken. Staff were then logging a SECOND communication to record what was
-- actually said, which double-counts the call in every timeline and report.
--
-- staff_note lets them annotate the existing row instead.
--
-- Deliberately NOT reusing two columns that already exist:
--   outcome    — rendered in the UI as a short capitalised label
--                ("Outcome: no answer"); free text would read badly there.
--   ai_summary — rendered in its own purple box and means "written by the AI
--                agent". A human note in it would misattribute authorship.
--
-- Additive and nullable, so nothing existing changes. No policy needed:
-- crm_all_communications is already FOR ALL.
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS staff_note text;

COMMENT ON COLUMN public.communications.staff_note IS
  'Free-text note added by staff after the fact, e.g. what was said on a Click2Call. Distinct from ai_summary (AI-written) and outcome (short status label).';
