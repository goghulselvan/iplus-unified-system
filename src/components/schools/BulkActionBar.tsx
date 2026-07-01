import { MessageSquare, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface Props {
  count: number;
  onStage: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onStage, onClear }: Props) {
  const navigate = useNavigate();
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl bg-indigo-700 text-white border border-indigo-500">
      <span className="text-sm font-semibold mr-1 whitespace-nowrap">
        {count} selected
      </span>
      <div className="w-px h-5 bg-indigo-500 mx-1" />
      <Button
        size="sm"
        variant="ghost"
        className="text-white hover:bg-indigo-600 gap-1.5"
        onClick={() => navigate('/bulk-messaging')}
      >
        <MessageSquare className="h-4 w-4" />
        Send Message
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-white hover:bg-indigo-600 gap-1.5"
        onClick={onStage}
      >
        <RefreshCw className="h-4 w-4" />
        Update Stage
      </Button>
      <div className="w-px h-5 bg-indigo-500 mx-1" />
      <button onClick={onClear} className="text-indigo-300 hover:text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
