import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy } from "lucide-react";

interface Props {
  schoolId: string;
}

export const SchoolResultsSummary = ({ schoolId }: Props) => (
  <Card>
    <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Trophy className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">Results for 2026 will appear here after evaluation.</p>
      </div>
      <Button asChild variant="outline">
        <Link to={`/results/schools/${schoolId}`}>Open full results</Link>
      </Button>
    </CardContent>
  </Card>
);
