import { useNavigate } from 'react-router-dom';
import { MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUnreadWhatsApp } from '@/hooks/useUnreadWhatsApp';

// A school replied on WhatsApp. Shown only to superadmin and manager, and only
// for messages that arrive while the tab is open — the standing backlog of
// unread must never pop up. One card at a time, newest first, so a burst of
// replies does not bury the screen.
export const IncomingMessageToast = () => {
  const navigate = useNavigate();
  const { incoming, dismiss, enabled } = useUnreadWhatsApp();

  if (!enabled || incoming.length === 0) return null;
  const msg = incoming[0];

  const replyNow = () => {
    dismiss(msg.id);
    navigate(`/messages?phone=${encodeURIComponent(msg.phone)}`);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-emerald-200 bg-white shadow-lg">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <MessageSquare className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            New WhatsApp message
            {incoming.length > 1 && (
              <span className="ml-1.5 text-xs font-normal text-gray-500">
                +{incoming.length - 1} more
              </span>
            )}
          </p>
          <p className="truncate text-xs text-gray-500">
            {msg.sender_name?.trim() || msg.phone}
          </p>
          {msg.message_text && (
            <p className="mt-1 line-clamp-3 text-sm text-gray-700">{msg.message_text}</p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={replyNow}>Reply now</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(msg.id)}>Dismiss</Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismiss(msg.id)}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
