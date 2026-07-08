import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneIncoming, PhoneCall, RefreshCw, Link2, UserPlus, X, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type CallRow = {
  id: string;
  call_id: string | null;
  school_phone: string | null;
  status: string | null;
  call_duration: number | null;
  resource_url: string | null;
  created_at: string;
  start_time: string | null;
  school_id: string | null;
  prospect_school_id: string | null;
  school: { school_name: string } | null;
  prospect: { school_name: string } | null;
};

type SchoolHit = { id: string; school_name: string; district: string | null };

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  answered: "bg-green-100 text-green-700",
  no_answer: "bg-amber-100 text-amber-700",
  ringing: "bg-blue-100 text-blue-700",
};

export default function IncomingCalls() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyLeads, setOnlyLeads] = useState(false);

  // Link dialog state
  const [linkingRow, setLinkingRow] = useState<CallRow | null>(null);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SchoolHit[]>([]);
  const [busy, setBusy] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bonvoice_call_logs")
      .select("id, call_id, school_phone, status, call_duration, resource_url, created_at, start_time, school_id, prospect_school_id, school:schools(school_name), prospect:prospect_schools(school_name)")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data as unknown as CallRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const searchSchools = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) { setHits([]); return; }
    const { data } = await supabase
      .from("schools")
      .select("id, school_name, district")
      .ilike("school_name", `%${q.trim()}%`)
      .limit(8);
    setHits((data as SchoolHit[]) ?? []);
  };

  const linkToSchool = async (schoolId: string) => {
    if (!linkingRow?.school_phone) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("link_incoming_number", {
        p_last10: linkingRow.school_phone.replace(/\D/g, "").slice(-10),
        p_school_id: schoolId,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Number linked", description: "Saved on the school — future calls will match automatically." });
      setLinkingRow(null); setSearch(""); setHits([]);
      await fetchRows();
    } catch (e: any) {
      toast({ title: "Link failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const createLead = async (row: CallRow) => {
    const num = (row.school_phone ?? "").replace(/\D/g, "").slice(-10);
    const name = window.prompt("Name for this lead (school / caller):", `Lead — caller ${num}`);
    if (!name) return;
    setBusy(true);
    try {
      const { data: created, error } = await supabase
        .from("prospect_schools")
        .insert({ school_name: name.trim(), mobile: num, stage: "interested" })
        .select("id").single();
      if (error) throw error;
      await supabase.rpc("link_incoming_number", { p_last10: num, p_prospect_id: created.id });
      toast({ title: "Lead created", description: `${name} saved to prospect schools.` });
      await fetchRows();
    } catch (e: any) {
      toast({ title: "Failed to create lead", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const callBack = async (row: CallRow) => {
    const num = (row.school_phone ?? "").replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(num)) { toast({ title: "Invalid number", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("bonvoice-click2call", {
        body: { type: "click2call", school_phone: num, prospect_school_id: row.prospect_school_id ?? undefined },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Call bridging started", description: "Your phone will ring first, then the caller is connected." });
    } catch (e: any) {
      toast({ title: "Call failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const visible = onlyLeads ? rows.filter(r => !r.school_id && !r.prospect_school_id) : rows;
  const leadCount = rows.filter(r => !r.school_id && !r.prospect_school_id).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <PhoneIncoming className="h-5 w-5 text-emerald-600" /> Incoming Calls
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Every inbound call to 08065453052 — known schools attach automatically; unknown numbers are leads.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant={onlyLeads ? "default" : "outline"} size="sm" onClick={() => setOnlyLeads(v => !v)}>
              New leads {leadCount > 0 ? `(${leadCount})` : ""}
            </Button>
            <Button variant="outline" size="sm" onClick={fetchRows}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <PhoneIncoming className="h-9 w-9 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 font-medium text-sm">
              {onlyLeads ? "No unlinked callers" : "No inbound calls logged yet"}
            </p>
            <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
              Calls appear here automatically once Bonvoice enables call notifications for the account.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {visible.map(r => {
              const matchedName = r.school?.school_name ?? r.prospect?.school_name;
              const isLead = !r.school_id && !r.prospect_school_id;
              const when = r.start_time ?? r.created_at;
              return (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-800">{r.school_phone}</span>
                      {isLead
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">New lead</span>
                        : <span className="text-xs text-gray-600 truncate">{matchedName}{r.school_id ? " (CRM)" : " (Prospect)"}</span>}
                      {r.status && (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {r.status.replace("_", " ")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {r.call_duration != null && r.call_duration > 0 && ` · ${Math.floor(r.call_duration / 60)}m ${r.call_duration % 60}s`}
                      {r.resource_url && (
                        <a href={r.resource_url} target="_blank" rel="noopener noreferrer"
                          className="ml-2 text-indigo-600 hover:underline inline-flex items-center gap-0.5">
                          <PlayCircle className="h-3 w-3" />recording
                        </a>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {isLead && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                          onClick={() => { setLinkingRow(r); setSearch(""); setHits([]); }}>
                          <Link2 className="h-3 w-3 mr-1" />Link
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                          onClick={() => createLead(r)}>
                          <UserPlus className="h-3 w-3 mr-1" />Save lead
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                      disabled={busy} onClick={() => callBack(r)}>
                      <PhoneCall className="h-3 w-3 mr-1" />Call back
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Link-to-school dialog */}
        {linkingRow && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
            onClick={() => setLinkingRow(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-gray-800">
                  Link {linkingRow.school_phone} to a school
                </h3>
                <button onClick={() => setLinkingRow(null)}><X className="h-4 w-4 text-gray-400" /></button>
              </div>
              <Input autoFocus placeholder="Search CRM schools by name…" value={search}
                onChange={e => searchSchools(e.target.value)} />
              <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                {hits.map(h => (
                  <button key={h.id} disabled={busy} onClick={() => linkToSchool(h.id)}
                    className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-800">{h.school_name}</p>
                    {h.district && <p className="text-xs text-gray-400">{h.district}</p>}
                  </button>
                ))}
                {search.length >= 2 && hits.length === 0 && (
                  <p className="text-xs text-gray-400 py-3 text-center">No schools match "{search}"</p>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                The number is saved on the school record — every future call from it will attach automatically.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
