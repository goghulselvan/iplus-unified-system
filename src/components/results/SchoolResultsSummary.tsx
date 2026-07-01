import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Users, TrendingUp, AlertCircle } from "lucide-react";
import {
  useSourceSchoolBySsNo,
  useSchoolClassSubjectStats,
  useSchoolAwards,
} from "@/hooks/useOlympiadResults";

interface Props {
  ssNo: number | string;
}

export const SchoolResultsSummary = ({ ssNo }: Props) => {
  const schoolQ = useSourceSchoolBySsNo(ssNo);
  const sourceSchoolId = schoolQ.data?.id;
  const statsQ = useSchoolClassSubjectStats(sourceSchoolId);
  const awardsQ = useSchoolAwards(sourceSchoolId);

  if (schoolQ.isLoading) return <Skeleton className="h-40 w-full" />;

  if (!schoolQ.data) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          <span>This school has no matching record in the Olympiad system yet.</span>
        </CardContent>
      </Card>
    );
  }

  const awards = awardsQ.data ?? [];
  const stats = (statsQ.data ?? []) as Array<Record<string, unknown>>;
  const totalEvaluated = stats.reduce(
    (sum, s) => sum + (Number(s.evaluated_count) || 0),
    0,
  );
  const avgPct = stats.length
    ? Math.round(
        stats.reduce((sum, s) => sum + (Number(s.avg_percentage) || 0), 0) /
          stats.length,
      )
    : 0;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> Evaluated Students
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalEvaluated}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Avg Percentage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{avgPct}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4" /> Total Awards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{awards.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Awards summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Award Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {awardsQ.isLoading ? (
            <Skeleton className="h-12" />
          ) : awards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No awards yet for this school.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(
                awards.reduce<Record<string, number>>((acc, a) => {
                  acc[a.award_type] = (acc[a.award_type] || 0) + 1;
                  return acc;
                }, {}),
              ).map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-sm">
                  {type}: {count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Class/Subject grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per Class & Subject</CardTitle>
        </CardHeader>
        <CardContent>
          {statsQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evaluations yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Class</th>
                    <th className="py-2 pr-4">Subject</th>
                    <th className="py-2 pr-4">Evaluated</th>
                    <th className="py-2 pr-4">Avg %</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">{String(s.class_code ?? "—")}</td>
                      <td className="py-2 pr-4">{String(s.subject_code ?? "—")}</td>
                      <td className="py-2 pr-4">{Number(s.evaluated_count) || 0}</td>
                      <td className="py-2 pr-4">
                        {Math.round(Number(s.avg_percentage) || 0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
