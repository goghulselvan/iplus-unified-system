import { Badge } from '@/components/ui/badge';
import { School } from '@/types/database';
import { useWorkflow } from '@/hooks/useWorkflow';

interface WorkflowStatusBadgeProps {
  school: School;
}

const WorkflowStatusBadge = ({ school }: WorkflowStatusBadgeProps) => {
  const { getCurrentStatus } = useWorkflow();
  const status = getCurrentStatus(school);

  const getStatusVariant = (status: string) => {
    if (status.includes('Confirmed') || status.includes('Received') || status.includes('Sent')) {
      return 'default';
    }
    if (status.includes('Interested')) {
      return 'secondary';
    }
    if (status.includes('Not Interested') || status.includes('Returned')) {
      return 'destructive';
    }
    return 'outline';
  };

  return (
    <Badge variant={getStatusVariant(status)} className="text-xs">
      {status}
    </Badge>
  );
};

export default WorkflowStatusBadge;