import { ReactNode } from 'react';
import { UnreadWhatsAppContext, useUnreadWhatsAppState } from '@/hooks/useUnreadWhatsApp';

// Mounted once, above the router, so the whole app shares a single realtime
// subscription instead of one per component that wants the badge.
export const UnreadWhatsAppProvider = ({ children }: { children: ReactNode }) => (
  <UnreadWhatsAppContext.Provider value={useUnreadWhatsAppState()}>
    {children}
  </UnreadWhatsAppContext.Provider>
);
