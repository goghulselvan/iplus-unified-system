-- Opening a WhatsApp thread runs
--   supabase.from('wa_replies').update({ status: 'read' }).in('id', unreadIds)
-- (src/components/messages/WhatsAppChat.tsx). RLS is enabled on wa_replies but
-- the only policy was SELECT, so that UPDATE matched zero rows every time and
-- returned success — PostgREST does not error when RLS filters every row away.
-- Goghul opened 15-20 messages and all 54 stayed 'unread'.
--
-- Table-level GRANTs were already wide (authenticated has UPDATE); RLS was the
-- thing denying it, so a policy is all that is needed.
CREATE POLICY crm_staff_update_wa_replies
  ON public.wa_replies
  FOR UPDATE
  USING (public.is_crm_user())
  WITH CHECK (public.is_crm_user());
