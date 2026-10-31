import { Card, CardContent } from "@/components/ui/card";
import { Hourglass } from "lucide-react";

interface Props {
  title: string;
  summary: string;
  headline?: string;
}

export default function ComingSoon({ title, summary, headline = "Coming in the next update" }: Props) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-10 sm:flex-row sm:items-center sm:gap-5">
        <div className="rounded-full bg-muted p-3" aria-hidden="true">
          <Hourglass className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-base font-medium text-foreground/80">{headline}</p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{summary}</p>
        </div>
      </CardContent>
    </Card>
  );
}
