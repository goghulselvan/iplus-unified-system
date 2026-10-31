import { Card, CardContent } from "@/components/ui/card";

const TILES = ["Question papers ready", "Students evaluated", "Awaiting release", "Schools"];

export default function ResultsDashboard() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {TILES.map((label) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <p className="text-3xl font-bold tabular-nums" aria-label={`${label}: no data yet`}>—</p>
              <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Numbers appear once papers and answers are uploaded.</p>
    </div>
  );
}
