import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { useClasses } from "@/hooks/results/usePapers";
import {
  RANK_PAGE, fetchRankPage, useDistricts, useRankCombos, useRankList, useSchoolSummary, useStates,
  type RankRow,
} from "@/hooks/results/useResultsReads";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { downloadCsv, rankListCsv } from "@/lib/results/rankingsCsv";
import { RankTable } from "./RankTable";

const ALL = "all";
const PAGE = 100;

export function RankingsTab({ projectId }: { projectId: string }) {
  const { data: combos, isLoading: loadingCombos, isError: comboError } = useRankCombos(projectId);
  const { data: classes } = useClasses();
  const { data: states } = useStates();
  const { data: schools } = useSchoolSummary(projectId);
  const [pick, setPick] = useState<string>("");
  const [stateCode, setStateCode] = useState(ALL);
  const [districtKey, setDistrictKey] = useState(ALL);
  const [schoolId, setSchoolId] = useState(ALL);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);

  const { data: districts } = useDistricts(stateCode === ALL ? null : stateCode);
  const className = (code: string) => classes?.find((c) => c.code === code)?.display_name ?? `Class ${code}`;

  const options = useMemo(
    () => (combos ?? []).map(([c, o]) => ({ value: `${c}|${o}`, label: `${className(c)} · ${OLYMPIAD_NAMES[o as OlympiadCode]}` })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [combos, classes],
  );
  const selected = pick || options[0]?.value || "";
  const [classCode, olympiad] = selected ? selected.split("|") : [null, null];

  const filters = {
    stateCode: stateCode === ALL ? null : stateCode,
    districtKey: districtKey === ALL ? null : districtKey,
    schoolId: schoolId === ALL ? null : schoolId,
  };
  const { data: rows, isLoading, isError, error, isFetching } = useRankList(projectId, classCode, olympiad, filters, page, PAGE);
  const total = Number(rows?.[0]?.total_count ?? 0);
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  const schoolChoices = (schools ?? []).filter((s) => stateCode === ALL || s.state_code === stateCode);
  const reset = () => setPage(0);

  const download = async () => {
    if (!classCode || !olympiad) return;
    try {
      const all: RankRow[] = [];
      let count = total || 1;
      setExporting({ done: 0, total: count });
      for (let offset = 0; offset === 0 || offset < count; offset += RANK_PAGE) {
        const chunk = await fetchRankPage(projectId, classCode, olympiad, filters, RANK_PAGE, offset);
        if (chunk.length === 0) break;
        count = Number(chunk[0].total_count);
        all.push(...chunk);
        setExporting({ done: all.length, total: count });
      }
      downloadCsv(`rank-list-class-${classCode}-${olympiad}.csv`, rankListCsv(all));
      toast.success(`Rank list saved: ${all.length} students.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We could not prepare the rank list. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  if (loadingCombos) return <Skeleton className="h-48 w-full" />;
  if (comboError) return <Card><CardContent className="py-8 text-base">We could not load the rankings. Please refresh and try again.</CardContent></Card>;
  if (options.length === 0)
    return (
      <Card>
        <CardContent className="py-10 text-base">
          There are no scores yet. Rankings appear after you upload students' answers on the Upload Answers page.
        </CardContent>
      </Card>
    );

  const field = "flex min-w-[11rem] flex-1 flex-col gap-1.5";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className={field}>
          <Label htmlFor="rk-pick" className="text-sm">Class and olympiad</Label>
          <Select value={selected} onValueChange={(v) => { setPick(v); reset(); }}>
            <SelectTrigger id="rk-pick" className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label htmlFor="rk-state" className="text-sm">State</Label>
          <Select value={stateCode} onValueChange={(v) => { setStateCode(v); setDistrictKey(ALL); setSchoolId(ALL); reset(); }}>
            <SelectTrigger id="rk-state" className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {(states ?? []).map((s) => <SelectItem key={s.state_code} value={s.state_code}>{s.state_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label htmlFor="rk-district" className="text-sm">District</Label>
          <Select value={districtKey} onValueChange={(v) => { setDistrictKey(v); reset(); }} disabled={stateCode === ALL}>
            <SelectTrigger id="rk-district" className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All districts</SelectItem>
              {(districts ?? []).map((d) => <SelectItem key={d.key} value={d.key}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label htmlFor="rk-school" className="text-sm">School</Label>
          <Select value={schoolId} onValueChange={(v) => { setSchoolId(v); reset(); }}>
            <SelectTrigger id="rk-school" className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All schools</SelectItem>
              {schoolChoices.map((s) => <SelectItem key={s.school_id} value={s.school_id}>{s.school_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" className="min-h-11" onClick={download} disabled={!!exporting || total === 0}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Download rank list (CSV)
        </Button>
      </div>

      {exporting && (
        <ProgressPanel
          stage="Preparing the rank list"
          percent={(exporting.done * 100) / Math.max(exporting.total, 1)}
          detail={`${exporting.done} of ${exporting.total} students`}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <Card><CardContent className="py-8 text-base">{error instanceof Error ? error.message : "We could not load the rankings."}</CardContent></Card>
      ) : !rows || rows.length === 0 ? (
        <Card><CardContent className="py-8 text-base">No students match these choices.</CardContent></Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {total} students, showing {page * PAGE + 1} to {page * PAGE + rows.length}
          </p>
          <div className={isFetching ? "opacity-70" : undefined}><RankTable rows={rows} /></div>
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-sm">Page {page + 1} of {lastPage + 1}</span>
            <Button type="button" variant="outline" className="min-h-11" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
