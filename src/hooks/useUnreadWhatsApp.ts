import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type IncomingMessage = {
  id: string;
  phone: string;
  sender_name: string | null;
  message_text: string | null;
  received_at: string;
};

// Only these roles get the pill and the popup. An accountant has no reason to
// be interrupted by an inbound school message.
const NOTIFY_ROLES = ['superadmin', 'manager'];

type UnreadState = {
  /** Shared unread total across all conversations — survives a refresh. */
  count: number;
  /** Messages that arrived while this tab was open and have not been dismissed. */
  incoming: IncomingMessage[];
  dismiss: (id: string) => void;
  refresh: () => void;
  enabled: boolean;
};

export const useUnreadWhatsAppState = (): UnreadState => {
  const { profile } = useAuth();
  const enabled = NOTIFY_ROLES.includes(profile?.role ?? '');

  const [count, setCount] = useState(0);
  const [incoming, setIncoming] = useState<IncomingMessage[]>([]);
  // Messages already on the table when this tab loaded must never pop up —
  // there is a standing backlog of unread that Goghul clears by hand.
  const openedAt = useRef<string>(new Date().toISOString());

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const { data } = await supabase.rpc('get_whatsapp_conversations' as any, { p_search: null });
    const rows = (data ?? []) as Array<{ unread_count: number | string }>;
    setCount(rows.reduce((n, r) => n + Number(r.unread_count ?? 0), 0));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();

    const channel = supabase
      .channel('wa-replies-inbound')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_replies' }, payload => {
        const row = payload.new as IncomingMessage & { status?: string };
        refresh();
        // Guard against a replayed or backfilled row surfacing as "new".
        if (row.received_at && row.received_at < openedAt.current) return;
        setIncoming(prev => (prev.some(m => m.id === row.id) ? prev : [row, ...prev]));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, refresh]);

  // Dismissal is per user and per browser: it only silences the popup, the
  // pill keeps showing the real shared unread count until someone replies.
  const dismiss = useCallback((id: string) => {
    setIncoming(prev => prev.filter(m => m.id !== id));
  }, []);

  return { count, incoming, dismiss, refresh, enabled };
};

export const UnreadWhatsAppContext = createContext<UnreadState | null>(null);

export const useUnreadWhatsApp = (): UnreadState =>
  useContext(UnreadWhatsAppContext) ?? {
    count: 0, incoming: [], dismiss: () => {}, refresh: () => {}, enabled: false,
  };
