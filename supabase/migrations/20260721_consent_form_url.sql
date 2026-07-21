-- Parent's Consent Form is a shared per-project document, same pattern as
-- brochure_url — one file, sent via WhatsApp document header + email link to
-- whichever school numbers staff selects (mirrors send-ebrochure).
ALTER TABLE public.olympiad_projects ADD COLUMN IF NOT EXISTS consent_form_url text;

UPDATE public.olympiad_projects
SET consent_form_url = 'https://eucjeggfclztkbbupaav.supabase.co/storage/v1/object/public/downloads/iPlus%20Olympiads%202026%20-%20Parent%20Consent%20Form.pdf'
WHERE id = 'dd5de83d-64f8-4113-a231-27024058396b';
