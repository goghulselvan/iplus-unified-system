import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { MessageSquare, Download, RefreshCw, StopCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { useBulkWhatsAppSend } from "@/hooks/useBulkWhatsAppSend";
import { BulkWhatsAppConfirmDialog } from "@/components/communication/BulkWhatsAppConfirmDialog";
import { downloadCSV } from "@/utils/csvExport";

interface MatchedSchool {
  id: string;
  school_name: string;
  district: string;
  mobile1: string | null;
  registration_status: string | null;
  payment_status: string | null;
  registration_interest: string | null;
}

const REG_STATUSES = ["Pending", "Confirmed", "In Progress"] as const;
const PAY_STATUSES = ["Pending", "Partial", "Received"] as const;
const INTEREST_STATUSES = ["Interested", "Not Interested"] as const;

export function BulkWhatsAppSender({ category }: { category?: 'workflow' | 'marketing' } = {}) {
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;
  const { templates, loading: tplLoading } = useWhatsAppTemplates(projectId, category);
  const { progress, running, run, cancel, reset } = useBulkWhatsAppSend();

  const [templateKey, setTemplateKey] = useState<string>("");
  const [districts, setDistricts] = useState<string[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [boardOptions, setBoardOptions] = useState<string[]>([]);
  const [regStatuses, setRegStatuses] = useState<string[]>([]);
  const [payStatuses, setPayStatuses] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [requireMobile, setRequireMobile] = useState(true);
  const [matched, setMatched] = useState<MatchedSchool[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const activeTemplates = useMemo(() => templates.filter((t) => t.is_active), [templates]);
  const selectedTemplate = activeTemplates.find((t) => t.template_key === templateKey);

  // Load filter options (distinct districts + boards)
  useEffect(() => {
    const loadOptions = async () => {
      const [d, b] = await Promise.all([
        supabase.from("schools").select("district").not("district", "is", null).limit(2000),
        supabase.from("schools").select("board").not("board", "is", null).limit(2000),
      ]);
      if (d.data) setDistrictOptions(Array.from(new Set(d.data.map((r: any) => r.district).filter(Boolean))).sort());
      if (b.data) setBoardOptions(Array.from(new Set(b.data.map((r: any) => r.board).filter(Boolean))).sort());
    };
    loadOptions();
  }, []);

  const refreshPreview = async () => {
    if (!projectId) {
      toast({ title: "No active project", variant: "destructive" });
      return;
    }
    setPreviewLoading(true);
    try {
      // Build join query: school_project_workflow filtered to active project, with school join
      let q = supabase
        .from("school_project_workflow")
        .select(`
          registration_status, payment_status, registration_interest,
          schools!inner(id, school_name, district, board, mobile1)
        `)
        .eq("project_id", projectId)
        .order("school_id", { ascending: true });

      if (regStatuses.length) q = q.in("registration_status", regStatuses as any);
      if (payStatuses.length) q = q.in("payment_status", payStatuses as any);
      if (interests.length) q = q.in("registration_interest", interests as any);

      // Paginate in 1000-row pages with seenIds dedup (per project performance rule)
      const seen = new Set<string>();
      const all: MatchedSchool[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await q.range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data as any[]) {
          const s = row.schools;
          if (!s || seen.has(s.id)) continue;
          seen.add(s.id);
          // School-level filters (district/board/mobile)
          if (districts.length && !districts.includes(s.district)) continue;
          if (boards.length && !boards.includes(s.board)) continue;
          if (requireMobile && !s.mobile1) continue;
          all.push({
            id: s.id,
            school_name: s.school_name,
            district: s.district,
            mobile1: s.mobile1,
            registration_status: row.registration_status,
            payment_status: row.payment_status,
            registration_interest: row.registration_interest,
          });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      setMatched(all);
      toast({ title: `Matched ${all.length} schools` });
    } catch (e: any) {
      toast({ title: "Failed to load preview", description: e.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    setConfirmOpen(false);
    if (!templateKey || matched.length === 0) return;
    await run(matched, templateKey);
  };

  const exportResults = () => {
    if (!progress.results.length) return;
    const rows: (string | number | null)[][] = [
      ["School", "District", "Mobile", "Status", "Reason"],
      ...progress.results.map((r) => {
        const m = matched.find((x) => x.id === r.schoolId);
        return [r.schoolName, m?.district || "", r.mobile || "", r.status, r.reason || ""];
      }),
    ];
    downloadCSV(rows, `whatsapp-bulk-send-${Date.now()}.csv`);
  };

  const toggleArr = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const pct = progress.total > 0 ? Math.round(((progress.sent + progress.failed + progress.skipped) / progress.total) * 100) : 0;

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-green-600" />
            Bulk WhatsApp Send
          </h1>
          <p className="text-muted-foreground">
            Send an approved AskEVA template to a filtered list of schools. Sends are batched 50 at a time.
          </p>
        </div>

        {/* Step 1 - template */}
        <Card>
          <CardHeader>
            <CardTitle>1. Pick a template</CardTitle>
            <CardDescription>Only active WhatsApp templates for the current project are shown.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder={tplLoading ? "Loading…" : "Select template"} />
              </SelectTrigger>
              <SelectContent>
                {activeTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.template_key}>
                    {t.template_name} <span className="text-muted-foreground">({t.template_key} · {t.language_code})</span>
                  </SelectItem>
                ))}
                {activeTemplates.length === 0 && !tplLoading && (
                  <div className="p-3 text-sm text-muted-foreground">No active templates. Create one in Admin → WhatsApp Templates.</div>
                )}
              </SelectContent>
            </Select>
            {selectedTemplate && selectedTemplate.body_variables?.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                This template uses {selectedTemplate.body_variables.length} variable(s) — values are pulled per school by the send function.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 2 - filters */}
        <Card>
          <CardHeader>
            <CardTitle>2. Filter recipients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">Districts ({districts.length || "all"})</Label>
                <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                  {districtOptions.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}
                  {districtOptions.map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={districts.includes(d)} onCheckedChange={() => toggleArr(districts, setDistricts, d)} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Boards ({boards.length || "all"})</Label>
                <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                  {boardOptions.length === 0 && <p className="text-xs text-muted-foreground">Loading…</p>}
                  {boardOptions.map((b) => (
                    <label key={b} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={boards.includes(b)} onCheckedChange={() => toggleArr(boards, setBoards, b)} />
                      {b}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="mb-2 block">Registration status</Label>
                <div className="space-y-1">
                  {REG_STATUSES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={regStatuses.includes(s)} onCheckedChange={() => toggleArr(regStatuses, setRegStatuses, s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Payment status</Label>
                <div className="space-y-1">
                  {PAY_STATUSES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={payStatuses.includes(s)} onCheckedChange={() => toggleArr(payStatuses, setPayStatuses, s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Registration interest</Label>
                <div className="space-y-1">
                  {INTEREST_STATUSES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={interests.includes(s)} onCheckedChange={() => toggleArr(interests, setInterests, s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={requireMobile} onCheckedChange={(c) => setRequireMobile(!!c)} />
              Only schools that have a mobile1 on file (recommended)
            </label>

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={refreshPreview} disabled={previewLoading || !projectId}>
                <RefreshCw className={`h-4 w-4 mr-2 ${previewLoading ? "animate-spin" : ""}`} />
                {previewLoading ? "Loading…" : "Refresh preview"}
              </Button>
              <Badge variant="secondary" className="text-base px-3 py-1">
                Matched: {matched.length}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Step 3 - preview + send */}
        {matched.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>3. Preview & send</CardTitle>
              <CardDescription>Showing first 50 of {matched.length} schools.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded max-h-96 overflow-y-auto mb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>District</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Reg. Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matched.slice(0, 50).map((s, i) => (
                      <TableRow key={s.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{s.school_name}</TableCell>
                        <TableCell>{s.district}</TableCell>
                        <TableCell className="font-mono text-xs">{s.mobile1 || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{s.registration_status || "—"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Button
                size="lg"
                disabled={!templateKey || running}
                onClick={() => { reset(); setConfirmOpen(true); }}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <MessageSquare className="h-5 w-5 mr-2" />
                Send to {matched.length} school{matched.length === 1 ? "" : "s"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Progress / Results */}
        {(running || progress.total > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>{progress.done ? "Results" : "Sending…"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={pct} />
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge variant="outline">Total: {progress.total}</Badge>
                <Badge className="bg-green-600">Sent: {progress.sent}</Badge>
                <Badge variant="destructive">Failed: {progress.failed}</Badge>
                <Badge variant="secondary">Skipped: {progress.skipped}</Badge>
              </div>
              {running && (
                <Button variant="outline" onClick={cancel}>
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              )}
              {progress.done && progress.results.length > 0 && (
                <>
                  <Button variant="outline" onClick={exportResults}>
                    <Download className="h-4 w-4 mr-2" />
                    Download results CSV
                  </Button>
                  {progress.failed > 0 && (
                    <div className="border rounded max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>School</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {progress.results.filter((r) => r.status !== "sent").map((r) => (
                            <TableRow key={r.schoolId}>
                              <TableCell>{r.schoolName}</TableCell>
                              <TableCell>
                                <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{r.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <BulkWhatsAppConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          templateName={selectedTemplate?.template_name || ""}
          recipientCount={matched.length}
          onConfirm={handleSend}
        />
    </div>
  );
}

export default function BulkWhatsAppPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <BulkWhatsAppSender />
    </div>
  );
}
