import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  PhoneIncoming, PhoneOutgoing, PhoneCall, RefreshCw, Link2, Plus, X, PlayCircle,
  MessageSquare, AlarmClock, CheckCircle2, Flame, UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type CallRow = {
  id: string;
  call_id: string | null;
  school_phone: string | null;
  status: string | null;
  call_duration: number | null;
  resource_url: string | null;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
  direction: string | null;
  created_by: string | null;
  staff_comment: string | null;
  disposition: string | null;
  school_id: string | null;
  prospect_school_id: string | null;
  school: { school_name: string } | null;
  prospect: { school_name: string } | null;
};

type QueueRow = {
  id: string;
  phone_last10: string;
  school_id: string | null;
  prospect_school_id: string | null;
  state: string;
  assigned_to: string | null;
  assigned_name: string | null;
  snoozed_until: string | null;
  school_name: string | null;
  missed_count: number;
  last_missed_at: string | null;
  outbound_attempts: number;
  followup_status: string;
  burst: boolean;
  after_hours: boolean;
  long_ring: boolean;
  priority: string;
  latest_comment: string | null;
};

type StaffProfile = { user_id: string; full_name: string | null; username: string };
type CallerHit = { source: "crm" | "prospect"; id: string; school_name: string; district: string | null; state: string | null };

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-100 text-green-700",
  answered: "bg-green-100 text-green-700",
  no_answer: "bg-amber-100 text-amber-700",
  ringing: "bg-blue-100 text-blue-700",
  initiated: "bg-gray-100 text-gray-600",
};

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  High: "bg-rose-100 text-rose-700",
  Medium: "bg-amber-100 text-amber-800",
};

const DISPOSITIONS: { value: string; label: string }[] = [
  { value: "connected_interested", label: "Connected – Interested" },
  { value: "connected_not_interested", label: "Connected – Not interested" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "call_later", label: "Call later…" },
];

const last10 = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10);

export default function CallCenter() {
  const { toast } = useToast();
  const { profile: currentProfile } = useAuth();

  // ── All Calls state ─────────────────────────────────────────────────────────
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fDirection, setFDirection] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fStaff, setFStaff] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [onlyLeads, setOnlyLeads] = useState(false);
  const [search, setSearch] = useState("");

  // ── Queue state ─────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [profiles, setProfiles] = useState<StaffProfile[]>([]);
  const [busy, setBusy] = useState(false);

  // ── Link dialog state (ported from IncomingCalls) ──────────────────────────
  const [linkingRow, setLinkingRow] = useState<CallRow | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [hits, setHits] = useState<CallerHit[]>([]);
  const [searching, setSearching] = useState(false);

  // ── Comment dialog ──────────────────────────────────────────────────────────
  const [commentTarget, setCommentTarget] = useState<{ callId: string; schoolId: string | null; direction: string | null; callRefId: string | null } | null>(null);
  const [commentText, setCommentText] = useState("");

  // ── Snooze dialog (also used by disposition "call_later") ───────────────────
  const [snoozeTarget, setSnoozeTarget] = useState<{ phone: string; schoolId: string | null; prospectId: string | null } | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");

  // ── Done dialog ─────────────────────────────────────────────────────────────
  const [doneTarget, setDoneTarget] = useState<QueueRow | null>(null);
  const [doneNote, setDoneNote] = useState("");

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("bonvoice_call_logs")
      .select("id, call_id, school_phone, status, call_duration, resource_url, created_at, start_time, end_time, direction, created_by, staff_comment, disposition, school_id, prospect_school_id, school:schools(school_name), prospect:prospect_schools(school_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (fDirection !== "all") q = q.eq("direction", fDirection);
    if (fStatus !== "all") q = q.eq("status", fStatus);
    if (fStaff !== "all") q = q.eq("created_by", fStaff);
    if (fFrom) q = q.gte("created_at", `${fFrom}T00:00:00`);
    if (fTo) q = q.lte("created_at", `${fTo}T23:59:59`);
    const { data } = await q;
    setRows((data as unknown as CallRow[]) ?? []);
    setLoading(false);
  }, [fDirection, fStatus, fStaff, fFrom, fTo]);

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    const { data, error } = await supabase.rpc("get_followup_queue");
    if (error) toast({ title: "Failed to load follow-up queue", description: error.message, variant: "destructive" });
    setQueue((data as QueueRow[]) ?? []);
    setQueueLoading(false);
  }, [toast]);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("user_id, full_name, username").not("user_id", "is", null);
    setProfiles((data as StaffProfile[]) ?? []);
  }, []);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);
  useEffect(() => { fetchQueue(); fetchProfiles(); }, [fetchQueue, fetchProfiles]);

  const refreshAll = () => { fetchCalls(); fetchQueue(); };

  // ── Link / create lead (ported from IncomingCalls) ─────────────────────────

  const searchCallers = async (q: string) => {
    setLinkSearch(q);
    if (q.trim().length < 2) { setHits([]); return; }
    setSearching(true);
    const { data } = await supabase.rpc("search_callers_by_name", { p_query: q.trim(), p_limit: 6 });
    setHits((data as CallerHit[]) ?? []);
    setSearching(false);
  };

  const linkToHit = async (hit: CallerHit) => {
    if (!linkingRow?.school_phone) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("link_incoming_number", {
        p_last10: last10(linkingRow.school_phone),
        p_school_id: hit.source === "crm" ? hit.id : null,
        p_prospect_id: hit.source === "prospect" ? hit.id : null,
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Number linked", description: "Saved on the record — future calls will match automatically." });
      setLinkingRow(null); setLinkSearch(""); setHits([]);
      refreshAll();
    } catch (e: any) {
      toast({ title: "Link failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const createNewLead = async (row: CallRow, name: string) => {
    const num = last10(row.school_phone);
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data: created, error } = await supabase
        .from("prospect_schools")
        .insert({ school_name: name.trim(), mobile: num, stage: "interested" })
        .select("id").single();
      if (error) throw error;
      await supabase.rpc("link_incoming_number", { p_last10: num, p_prospect_id: created.id });
      toast({ title: "Lead created", description: `${name} saved to prospect schools.` });
      setLinkingRow(null); setLinkSearch(""); setHits([]);
      refreshAll();
    } catch (e: any) {
      toast({ title: "Failed to create lead", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  // ── Call back ───────────────────────────────────────────────────────────────

  const callBack = async (phone: string | null, prospectId?: string | null) => {
    const num = last10(phone);
    if (!/^[6-9]\d{9}$/.test(num)) { toast({ title: "Invalid number", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("bonvoice-click2call", {
        body: { type: "click2call", school_phone: num, prospect_school_id: prospectId ?? undefined },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Call bridging started", description: "Your phone will ring first, then the caller is connected." });
    } catch (e: any) {
      toast({ title: "Call failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  // ── Comments ────────────────────────────────────────────────────────────────

  const openCommentForCall = (row: CallRow) => {
    setCommentTarget({ callId: row.id, schoolId: row.school_id, direction: row.direction, callRefId: row.call_id });
    setCommentText(row.staff_comment ?? "");
  };

  // Queue rows carry no call id — comment lands on the number's most recent call.
  const openCommentForNumber = async (q: QueueRow) => {
    const { data } = await supabase
      .from("bonvoice_call_logs")
      .select("id, call_id, school_id, direction, staff_comment")
      .like("school_phone", `%${q.phone_last10}`)
      .order("created_at", { ascending: false })
      .limit(1);
    const call = (data as any[])?.[0];
    if (!call) { toast({ title: "No call row found for this number", variant: "destructive" }); return; }
    setCommentTarget({ callId: call.id, schoolId: call.school_id ?? q.school_id, direction: call.direction, callRefId: call.call_id });
    setCommentText(call.staff_comment ?? q.latest_comment ?? "");
  };

  const saveComment = async () => {
    if (!commentTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("bonvoice_call_logs")
        .update({ staff_comment: commentText.trim(), commented_by: currentProfile?.user_id ?? null, commented_at: new Date().toISOString() })
        .eq("id", commentTarget.callId);
      if (error) throw error;
      if (commentTarget.schoolId && commentText.trim()) {
        await supabase.from("communications").insert({
          school_id: commentTarget.schoolId,
          user_id: currentProfile?.user_id ?? null,
          communication_type: "Phone",
          direction: commentTarget.direction,
          message: `Call note: ${commentText.trim()}`,
          bonvoice_call_id: commentTarget.callRefId,
        } as any);
      }
      toast({ title: "Comment saved" });
      setCommentTarget(null); setCommentText("");
      refreshAll();
    } catch (e: any) {
      toast({ title: "Failed to save comment", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  // ── Dispositions ────────────────────────────────────────────────────────────

  const setDisposition = async (row: CallRow, value: string) => {
    try {
      const { error } = await supabase.from("bonvoice_call_logs").update({ disposition: value }).eq("id", row.id);
      if (error) throw error;
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, disposition: value } : r));
      if (value === "call_later") {
        setSnoozeTarget({ phone: last10(row.school_phone), schoolId: row.school_id, prospectId: row.prospect_school_id });
        setSnoozeDate("");
      }
    } catch (e: any) {
      toast({ title: "Failed to save disposition", description: e.message, variant: "destructive" });
    }
  };

  // ── Follow-up actions ───────────────────────────────────────────────────────

  const saveSnooze = async () => {
    if (!snoozeTarget || !snoozeDate) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("call_followups").upsert({
        phone_last10: snoozeTarget.phone,
        state: "snoozed",
        snoozed_until: `${snoozeDate}T09:00:00+05:30`,
        school_id: snoozeTarget.schoolId,
        prospect_school_id: snoozeTarget.prospectId,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "phone_last10" });
      if (error) throw error;
      toast({ title: "Snoozed", description: `Will reappear in the queue on ${snoozeDate} at 9 AM.` });
      setSnoozeTarget(null); setSnoozeDate("");
      fetchQueue();
    } catch (e: any) {
      toast({ title: "Failed to snooze", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const assignTo = async (q: QueueRow, userId: string) => {
    try {
      const value = userId === "unassigned" ? null : userId;
      const { error } = await supabase.from("call_followups")
        .update({ assigned_to: value, updated_at: new Date().toISOString() })
        .eq("id", q.id);
      if (error) throw error;
      const name = profiles.find(p => p.user_id === value)?.full_name ?? null;
      setQueue(prev => prev.map(r => r.id === q.id ? { ...r, assigned_to: value, assigned_name: name } : r));
    } catch (e: any) {
      toast({ title: "Failed to assign", description: e.message, variant: "destructive" });
    }
  };

  const markDone = async () => {
    if (!doneTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("call_followups").update({
        state: "done",
        resolution: "manual",
        resolution_note: doneNote.trim() || null,
        resolved_by: currentProfile?.user_id ?? null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", doneTarget.id);
      if (error) throw error;
      toast({ title: "Marked done", description: doneTarget.phone_last10 });
      setDoneTarget(null); setDoneNote("");
      fetchQueue();
    } catch (e: any) {
      toast({ title: "Failed to mark done", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const visible = rows.filter(r => {
    if (onlyLeads && (r.school_id || r.prospect_school_id)) return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      const name = (r.school?.school_name ?? r.prospect?.school_name ?? "").toLowerCase();
      if (!(r.school_phone ?? "").includes(s.replace(/\D/g, "") || " ") && !name.includes(s)) return false;
    }
    return true;
  });
  const leadCount = rows.filter(r => !r.school_id && !r.prospect_school_id).length;

  const criticalCount = queue.filter(q => q.priority === "Critical").length;
  const highCount = queue.filter(q => q.priority === "High").length;
  const mediumCount = queue.filter(q => q.priority === "Medium").length;
  const unassignedCount = queue.filter(q => !q.assigned_to).length;

  const fmtWhen = (iso: string | null) => iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-indigo-600" /> Call Center
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Every call in and out of 08065453052 — with a follow-up queue so no lead is missed.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading || queueLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Tabs defaultValue="calls">
          <TabsList>
            <TabsTrigger value="calls">All Calls</TabsTrigger>
            <TabsTrigger value="queue">
              Follow-up Queue{queue.length > 0 ? ` (${queue.length})` : ""}
            </TabsTrigger>
          </TabsList>

          {/* ══ TAB: ALL CALLS ══════════════════════════════════════════════════ */}
          <TabsContent value="calls" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={fDirection} onValueChange={setFDirection}>
                <SelectTrigger className="w-32 h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All directions</SelectItem>
                  <SelectItem value="inbound">Incoming</SelectItem>
                  <SelectItem value="outbound">Outgoing</SelectItem>
                </SelectContent>
              </Select>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger className="w-32 h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="answered">Answered</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="no_answer">No answer</SelectItem>
                  <SelectItem value="ringing">Ringing</SelectItem>
                  <SelectItem value="initiated">Initiated</SelectItem>
                </SelectContent>
              </Select>
              <Select value={fStaff} onValueChange={setFStaff}>
                <SelectTrigger className="w-36 h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <Button variant={onlyLeads ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setOnlyLeads(v => !v)}>
                New leads {leadCount > 0 ? `(${leadCount})` : ""}
              </Button>
              <Input placeholder="Search number or school…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs bg-white flex-1 min-w-40" />
            </div>

            {loading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : visible.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <PhoneCall className="h-9 w-9 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">No calls match these filters</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {visible.map(r => {
                  const matchedName = r.school?.school_name ?? r.prospect?.school_name;
                  const isLead = !r.school_id && !r.prospect_school_id;
                  const when = r.start_time ?? r.created_at;
                  const isOut = r.direction === "outbound";
                  const staffName = profiles.find(p => p.user_id === r.created_by)?.full_name;
                  return (
                    <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                      {isOut
                        ? <PhoneOutgoing className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        : <PhoneIncoming className="h-4 w-4 text-emerald-600 flex-shrink-0" />}
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
                          {fmtWhen(when)}
                          {r.call_duration != null && r.call_duration > 0 && ` · ${Math.floor(r.call_duration / 60)}m ${r.call_duration % 60}s`}
                          {isOut && staffName && ` · by ${staffName}`}
                          {r.resource_url && (
                            <a href={r.resource_url} target="_blank" rel="noopener noreferrer"
                              className="ml-2 text-indigo-600 hover:underline inline-flex items-center gap-0.5">
                              <PlayCircle className="h-3 w-3" />recording
                            </a>
                          )}
                        </p>
                        {r.staff_comment && (
                          <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1 inline-block">💬 {r.staff_comment}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                        {isOut && (
                          <Select value={r.disposition ?? undefined} onValueChange={v => setDisposition(r, v)}>
                            <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Disposition…" /></SelectTrigger>
                            <SelectContent>
                              {DISPOSITIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {isLead && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                            onClick={() => { setLinkingRow(r); setLinkSearch(""); setHits([]); }}>
                            <Link2 className="h-3 w-3 mr-1" />Link / Add lead
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => openCommentForCall(r)} title="Add comment">
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                          disabled={busy} onClick={() => callBack(r.school_phone, r.prospect_school_id)}>
                          <PhoneCall className="h-3 w-3 mr-1" />Call
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ══ TAB: FOLLOW-UP QUEUE ═══════════════════════════════════════════ */}
          <TabsContent value="queue" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 rounded-full text-xs bg-red-50 text-red-700 border border-red-200">Critical: <b>{criticalCount}</b></span>
              <span className="px-3 py-1 rounded-full text-xs bg-rose-50 text-rose-700 border border-rose-200">High: <b>{highCount}</b></span>
              <span className="px-3 py-1 rounded-full text-xs bg-amber-50 text-amber-800 border border-amber-200">Medium: <b>{mediumCount}</b></span>
              <span className="px-3 py-1 rounded-full text-xs bg-gray-50 text-gray-600 border border-gray-200">Unassigned: <b>{unassignedCount}</b></span>
            </div>

            {queueLoading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : queue.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <CheckCircle2 className="h-9 w-9 text-green-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">Queue is clear — every missed caller has been handled 🎉</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {queue.map(q => (
                  <div key={q.id} className="px-4 py-3 flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 mt-0.5 ${PRIORITY_COLOR[q.priority] ?? "bg-gray-100 text-gray-600"}`}>
                      {q.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-gray-800">{q.phone_last10}</span>
                        {q.school_name
                          ? <span className="text-xs text-gray-600 truncate">{q.school_name}{q.school_id ? " (CRM)" : " (Prospect)"}</span>
                          : <span className="px-2 py-0.5 rounded-full text-[10px] border border-dashed border-gray-300 text-gray-500">Unidentified</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs ${q.followup_status === "never_tried" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                          {q.followup_status === "never_tried" ? "Never called back" : "Attempted, not connected"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{q.missed_count} missed · last {fmtWhen(q.last_missed_at)}</span>
                        {q.burst && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium inline-flex items-center gap-0.5"><Flame className="h-2.5 w-2.5" />Burst</span>}
                        {q.long_ring && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium">Long ring</span>}
                        {q.after_hours && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px] font-medium">After-hours</span>}
                        {q.outbound_attempts > 0 && <span>{q.outbound_attempts} callback attempt{q.outbound_attempts > 1 ? "s" : ""}</span>}
                      </p>
                      {q.latest_comment && (
                        <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1 inline-block">💬 {q.latest_comment}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      <Select value={q.assigned_to ?? "unassigned"} onValueChange={v => assignTo(q, v)}>
                        <SelectTrigger className="h-7 w-32 text-xs">
                          <UserRound className="h-3 w-3 mr-1 text-gray-400" /><SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {profiles.map(p => (
                            <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.username}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => openCommentForNumber(q)} title="Add comment">
                        <MessageSquare className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                        onClick={() => { setSnoozeTarget({ phone: q.phone_last10, schoolId: q.school_id, prospectId: q.prospect_school_id }); setSnoozeDate(""); }} title="Snooze">
                        <AlarmClock className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy}
                        onClick={() => { setDoneTarget(q); setDoneNote(""); }} title="Mark done">
                        <CheckCircle2 className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                        disabled={busy} onClick={() => callBack(q.phone_last10, q.prospect_school_id)}>
                        <PhoneCall className="h-3 w-3 mr-1" />Call back
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* ── Link / create lead dialog (ported from IncomingCalls) ───────────── */}
        {linkingRow && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
            onClick={() => setLinkingRow(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-gray-800">
                  Who is {linkingRow.school_phone}?
                </h3>
                <button onClick={() => setLinkingRow(null)}><X className="h-4 w-4 text-gray-400" /></button>
              </div>
              <Input autoFocus placeholder="Search school name (CRM + Prospect)…" value={linkSearch}
                onChange={e => searchCallers(e.target.value)} />
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                {searching && <p className="text-xs text-gray-400 py-3 text-center">Searching…</p>}
                {!searching && hits.map(h => (
                  <button key={`${h.source}-${h.id}`} disabled={busy} onClick={() => linkToHit(h)}
                    className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 rounded-lg flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{h.school_name}</p>
                      <p className="text-xs text-gray-400 truncate">{[h.district, h.state].filter(Boolean).join(", ")}</p>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      h.source === "crm" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>
                      {h.source === "crm" ? "CRM" : "Prospect"}
                    </span>
                  </button>
                ))}
                {!searching && linkSearch.trim().length >= 2 && hits.length === 0 && (
                  <p className="text-xs text-gray-400 py-3 text-center">No match for "{linkSearch}"</p>
                )}
              </div>
              {linkSearch.trim().length >= 2 && (
                <button disabled={busy} onClick={() => createNewLead(linkingRow, linkSearch.trim())}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 flex items-center gap-2 text-sm text-indigo-700">
                  <Plus className="h-3.5 w-3.5 flex-shrink-0" />
                  Create new prospect lead: "{linkSearch.trim()}"
                </button>
              )}
              <p className="text-[11px] text-gray-400">
                The number is saved on the record — every future call from it will attach automatically.
              </p>
            </div>
          </div>
        )}

        {/* ── Comment dialog ──────────────────────────────────────────────────── */}
        <Dialog open={!!commentTarget} onOpenChange={open => { if (!open) { setCommentTarget(null); setCommentText(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4" /> Call comment
              </DialogTitle>
            </DialogHeader>
            <Textarea autoFocus rows={4} placeholder="What happened on this call? (saved to the school's communication history when linked)"
              value={commentText} onChange={e => setCommentText(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCommentTarget(null)}>Cancel</Button>
              <Button onClick={saveComment} disabled={busy || !commentText.trim()}>{busy ? "Saving…" : "Save comment"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Snooze dialog ───────────────────────────────────────────────────── */}
        <Dialog open={!!snoozeTarget} onOpenChange={open => { if (!open) { setSnoozeTarget(null); setSnoozeDate(""); } }}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <AlarmClock className="h-4 w-4" /> Call later — pick a date
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="snooze-date">Reappears in the queue at 9 AM on</Label>
              <Input id="snooze-date" type="date" value={snoozeDate} min={new Date().toISOString().slice(0, 10)}
                onChange={e => setSnoozeDate(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSnoozeTarget(null)}>Cancel</Button>
              <Button onClick={saveSnooze} disabled={busy || !snoozeDate}>{busy ? "Saving…" : "Snooze"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Done dialog ─────────────────────────────────────────────────────── */}
        <Dialog open={!!doneTarget} onOpenChange={open => { if (!open) { setDoneTarget(null); setDoneNote(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Mark {doneTarget?.phone_last10} as done
              </DialogTitle>
            </DialogHeader>
            <Textarea rows={3} placeholder="Optional note — how was this resolved?"
              value={doneNote} onChange={e => setDoneNote(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDoneTarget(null)}>Cancel</Button>
              <Button onClick={markDone} disabled={busy}>{busy ? "Saving…" : "Mark done"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
