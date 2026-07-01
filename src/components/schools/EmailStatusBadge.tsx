import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { emailSchema } from "@/lib/security";

interface EmailStatusBadgeProps {
  email?: string | null;
}

export const EmailStatusBadge = ({ email }: EmailStatusBadgeProps) => {
  if (!email) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Missing
      </Badge>
    );
  }

  try {
    emailSchema.parse(email);
    return (
      <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700">
        <CheckCircle className="h-3 w-3" />
        Valid
      </Badge>
    );
  } catch {
    return (
      <Badge variant="secondary" className="gap-1 bg-yellow-600 hover:bg-yellow-700">
        <AlertCircle className="h-3 w-3" />
        Invalid Format
      </Badge>
    );
  }
};
