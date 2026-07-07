-- Track WhatsApp delivery status on one-off sends (send-ebrochure, send-whatsapp-template)
alter table public.communications
  add column if not exists wamid text,
  add column if not exists delivery_status text;

create index if not exists idx_communications_wamid
  on public.communications(wamid) where wamid is not null;
