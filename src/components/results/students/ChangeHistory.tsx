import { useResultHistory } from "@/hooks/results/useEvaluations";
import { describeChange } from "./history";

export function ChangeHistory({ evaluationId }: { evaluationId?: string }) {
  const { data, isLoading, isError } = useResultHistory(evaluationId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading change history</p>;
  if (isError) return <p className="text-sm">We could not load the change history.</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No changes have been made to this result yet.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {data.map((e) => (
        <li key={e.id} className="p-3 text-sm">
          <p className="font-medium">{e.who} · {new Date(e.changed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {describeChange(e).map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
