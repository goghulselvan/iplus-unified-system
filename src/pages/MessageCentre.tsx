import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquare, Mail, RefreshCw, History, PhoneIncoming, PhoneOutgoing,
  Bot, CheckCircle2, Inbox, Download, PlayCircle, Eye, EyeOff, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type FeedRow = {
  source: "communications" | "campaign_schools" | "wa_replies";
  event_id: string;
  when_at: string;
  channel: string;
  direction: string;
  party_name: string | null;
  party_kind: "CRM" | "Prospect";
  school_id: string | null;
  prospect_school_id: string | null;
  phone: string | null;
  status: string | null;
  message: string | null;
};

type ReplyRow = {
  id: string;
  phone: string;
  sender_name: string | null;
  message_text: string | null;
  received_at: string;
  status: string;
  campaign_school_id: string | null;
};

type TimelineEvent = {
  kind: "call" | "comm" | "reply";
  when: string;
  direction: string | null;
  title: string;
  detail: string | null;
  recordingUrl?: string | null;
};

type ReportData = {
  totals: { sent: number; delivered: number; read: number; replied: number };
  daily: { day: string; whatsapp: number; email: number; replies: number }[];
};

const last10 = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10);

const CHANNEL_ICON: Record<string, React.ElementType> = {
  WhatsApp: MessageSquare, whatsapp: MessageSquare, Email: Mail, email: Mail, "AI Call": Bot,
};

const STATUS_COLOR: Record<string, string> = {
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-indigo-100 text-indigo-700",
  read: "bg-green-100 text-green-700",
  replied: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  bounced: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-600",
  unread: "bg-amber-100 text-amber-800",
};

export default function MessageCentre() {
  const { toast } = useToast();
  const [tab, setTab] = useState("feed");

  // ── All Messages state ──────────────────────────────────────────────────────
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [fChannel, setFChannel] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [search, setSearch] = useState("");

  // ── Needs Reply state ────────────────────────────────────────────────────────
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(true);

  // ── Timeline state ──────────────────────────────────────────────────────────
  const [tlInput, setTlInput] = useState("");
  const [tlLoading, setTlLoading] = useState(false);
  const [tlLoaded, setTlLoaded] = useState(false);
  const [tlEvents, setTlEvents] = useState<TimelineEvent[]>([]);
  const [tlParty, setTlParty] = useState<{ name: string | null; source: string | null } | null>(null);

  // ── Reports state ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [repFrom, setRepFrom] = useState(monthAgo);
  const [repTo, setRepTo] = useState(today);
  const [repData, setRepData] = useState<ReportData | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  // ── Fetchers ─────────────────────────────────────────────────────────────────

  const fetchFeed = useCallback(async () => {
    setFeedLoading(true);
    const { data, error } = await supabase.rpc("get_message_feed", {
      p_from: fFrom || null, p_to: fTo || null, p_limit: 300,
    });
    if (error) toast({ title: "Failed to load messages", description: error.message, variant: "destructive" });
    setFeed((data as FeedRow[]) ?? []);
    setFeedLoading(false);
  }, [fFrom, fTo, toast]);

  const fetchReplies = useCallback(async () => {
    setRepliesLoading(true);
    const { data, error } = await supabase
      .from("wa_replies")
      .select("id, phone, sender_name, message_text, received_at, status, campaign_school_id")
      .eq("status", "unread")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) toast({ title: "Failed to load replies", description: error.message, variant: "destructive" });
    setReplies((data as ReplyRow[]) ?? []);
    setRepliesLoading(false);
  }, [toast]);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);
  useEffect(() => { fetchReplies(); }, [fetchReplies]);

  const refreshAll = () => { fetchFeed(); fetchReplies(); };

  // ── Needs Reply actions ──────────────────────────────────────────────────────

  const setReplyStatus = async (row: ReplyRow, status: string) => {
    try {
      const { error } = await supabase.from("wa_replies").update({ status }).eq("id", row.id);
      if (error) throw error;
      setReplies(prev => prev.filter(r => r.id !== row.id));
    } catch (e: any) {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    }
  };

  // ── Timeline ─────────────────────────────────────────────────────────────────

  const loadTimeline = async (raw: string) => {
    const val = raw.trim();
    if (!val) return;
    const isEmail = val.includes("@");
    setTlLoading(true);
    setTlLoaded(true);
    try {
      let schoolId: string | null = null;
      let prospectId: string | null = null;
      let phone: string | null = null;
      let partyName: string | null = null;
      let partySource: string | null = null;

      if (isEmail) {
        const { data: s } = await supabase.from("schools").select("id, school_name").eq("email", val).maybeSingle();
        if (s) { schoolId = s.id; partyName = s.school_name; partySource = "CRM"; }
        const { data: p } = await supabase.from("prospect_schools").select("id, school_name, mobile").eq("email", val).maybeSingle();
        if (p) {
          prospectId = p.id;
          phone = last10(p.mobile);
          if (!partyName) { partyName = p.school_name; partySource = "Prospect"; }
        }
      } else {
        const num = last10(val);
        if (num.length !== 10) { toast({ title: "Enter a 10-digit number or an email", variant: "destructive" }); setTlLoading(false); return; }
        phone = num;
        const { data: m } = await supabase.rpc("match_phone_all", { p_last10: num });
        const match = Array.isArray(m) ? m[0] : m;
        schoolId = match?.school_id ?? null;
        prospectId = match?.prospect_school_id ?? null;
        if (schoolId) {
          const { data: s } = await supabase.from("schools").select("school_name").eq("id", schoolId).maybeSingle();
          partyName = s?.school_name ?? null; partySource = "CRM";
        } else if (prospectId) {
          const { data: p } = await supabase.from("prospect_schools").select("school_name").eq("id", prospectId).maybeSingle();
          partyName = p?.school_name ?? null; partySource = "Prospect";
        }
      }
      setTlParty({ name: partyName, source: partySource });

      const events: TimelineEvent[] = [];

      if (schoolId || prospectId) {
        let callQ = supabase.from("bonvoice_call_logs")
          .select("status, call_duration, resource_url, created_at, start_time, direction")
          .order("created_at", { ascending: false }).limit(100);
        callQ = schoolId ? callQ.eq("school_id", schoolId) : callQ.eq("prospect_school_id", prospectId);
        const { data: callData } = await callQ;
        for (const c of (callData as any[]) ?? []) {
          events.push({
            kind: "call",
            when: c.start_time ?? c.created_at,
            direction: c.direction,
            title: `${c.direction === "outbound" ? "Outgoing" : "Incoming"} call — ${(c.status ?? "").replace("_", " ")}`,
            detail: c.call_duration > 0 ? `${Math.floor(c.call_duration / 60)}m ${c.call_duration % 60}s` : null,
            recordingUrl: c.resource_url,
          });
        }
      }

      if (schoolId) {
        const { data: c } = await supabase
          .from("communications")
          .select("communication_type, message, created_at, direction, delivery_status")
          .eq("school_id", schoolId)
          .in("communication_type", ["Email", "WhatsApp"])
          .order("created_at", { ascending: false })
          .limit(100);
        for (const row of (c as any[]) ?? []) {
          events.push({
            kind: "comm",
            when: row.created_at,
            direction: row.direction ?? "outbound",
            title: `${row.communication_type}${row.delivery_status ? ` — ${row.delivery_status}` : ""}`,
            detail: (row.message ?? "").slice(0, 200) || null,
          });
        }
      }

      if (phone) {
        const { data: r } = await supabase
          .from("wa_replies")
          .select("message_text, received_at, status")
          .like("phone", `%${phone}`)
          .order("received_at", { ascending: false })
          .limit(100);
        for (const row of (r as any[]) ?? []) {
          events.push({
            kind: "reply",
            when: row.received_at,
            direction: "inbound",
            title: `WhatsApp reply${row.status ? ` — ${row.status}` : ""}`,
            detail: row.message_text,
          });
        }
      }

      events.sort((a, b) => (a.when < b.when ? 1 : -1));
      setTlEvents(events);
    } catch (e: any) {
      toast({ title: "Failed to load timeline", description: e.message, variant: "destructive" });
    } finally { setTlLoading(false); }
  };

  const openTimeline = (phone: string | null) => {
    const num = last10(phone);
    if (num.length !== 10) return;
    setTab("timeline");
    setTlInput(num);
    loadTimeline(num);
  };

  // ── Reports ──────────────────────────────────────────────────────────────────

  const loadReports = useCallback(async () => {
    setRepLoading(true);
    const { data, error } = await supabase.rpc("get_message_reports", { p_from: repFrom, p_to: repTo });
    if (error) toast({ title: "Failed to load reports", description: error.message, variant: "destructive" });
    setRepData((data as ReportData) ?? null);
    setRepLoading(false);
  }, [repFrom, repTo, toast]);

  useEffect(() => { if (tab === "reports") loadReports(); }, [tab, loadReports]);

  const downloadCsv = (filename: string, headers: string[], rows: (string | number | null)[][]) => {
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const visible = feed.filter(f => {
    if (fChannel !== "all" && f.channel.toLowerCase() !== fChannel) return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      const name = (f.party_name ?? "").toLowerCase();
      const phoneDigits = (f.phone ?? "").replace(/\D/g, "");
      if (!name.includes(s) && !phoneDigits.includes(s.replace(/\D/g, "") || " ")) return false;
    }
    return true;
  });

  const fmtWhen = (iso: string | null) => iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-indigo-600" /> Message Centre
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Every WhatsApp and email sent or received, across CRM schools and prospects, in one place.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className={`h-3.5 w-3.5 ${feedLoading || repliesLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="feed">All Messages</TabsTrigger>
            <TabsTrigger value="replies">
              Needs Reply{replies.length > 0 ? ` (${replies.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* ══ TAB: ALL MESSAGES ══════════════════════════════════════════════ */}
          <TabsContent value="feed" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={fChannel} onValueChange={setFChannel}>
                <SelectTrigger className="w-36 h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <Input placeholder="Search number or school…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs bg-white flex-1 min-w-40" />
            </div>

            {feedLoading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : visible.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <Inbox className="h-9 w-9 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">No messages match these filters</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {visible.map(f => {
                  const Icon = CHANNEL_ICON[f.channel] ?? MessageSquare;
                  const isOut = f.direction === "outbound";
                  return (
                    <div key={`${f.source}-${f.event_id}`} className="px-4 py-3 flex items-center gap-3">
                      {f.source === "wa_replies"
                        ? <PhoneIncoming className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                        : isOut ? <Icon className="h-4 w-4 text-indigo-500 flex-shrink-0" /> : <Icon className="h-4 w-4 text-emerald-600 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {f.phone ? (
                            <button className="font-mono text-sm font-semibold text-gray-800 hover:text-indigo-600 hover:underline"
                              onClick={() => openTimeline(f.phone)} title="View timeline">
                              {f.phone}
                            </button>
                          ) : (
                            <span className="text-sm font-semibold text-gray-800">{f.party_name ?? "Unknown"}</span>
                          )}
                          {f.phone && <span className="text-xs text-gray-600 truncate">{f.party_name}{f.party_kind === "CRM" ? " (CRM)" : " (Prospect)"}</span>}
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            {f.channel}
                          </span>
                          {f.status && (
                            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[f.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {f.status}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtWhen(f.when_at)}</p>
                        {f.message && (
                          <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1 inline-block max-w-lg truncate">{f.message}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ══ TAB: NEEDS REPLY ═══════════════════════════════════════════════ */}
          <TabsContent value="replies" className="space-y-3">
            {repliesLoading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : replies.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <CheckCircle2 className="h-9 w-9 text-green-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">No unread replies — every WhatsApp reply has been handled 🎉</p>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
                  This stays empty until AskEVA forwards inbound message content — see the standing open item.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {replies.map(r => (
                  <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                    <MessageSquare className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="font-mono text-sm font-semibold text-gray-800 hover:text-indigo-600 hover:underline"
                          onClick={() => openTimeline(r.phone)} title="View timeline">
                          {r.phone}
                        </button>
                        {r.sender_name && <span className="text-xs text-gray-600">{r.sender_name}</span>}
                        <span className="text-xs text-gray-400">{fmtWhen(r.received_at)}</span>
                      </div>
                      {r.message_text && <p className="text-sm text-gray-700 mt-1">{r.message_text}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setReplyStatus(r, "read")} title="Mark read">
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50"
                        onClick={() => setReplyStatus(r, "replied")} title="Mark replied">
                        <CheckCircle2 className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setReplyStatus(r, "ignored")} title="Ignore">
                        <EyeOff className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ══ TAB: TIMELINE ══════════════════════════════════════════════════ */}
          <TabsContent value="timeline" className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Phone number or email…" value={tlInput}
                onChange={e => setTlInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") loadTimeline(tlInput); }}
                className="w-64 bg-white" />
              <Button size="sm" onClick={() => loadTimeline(tlInput)} disabled={tlLoading || !tlInput.trim()}>
                <History className="h-3.5 w-3.5 mr-1" />Load timeline
              </Button>
            </div>

            {tlLoading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : !tlLoaded ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <History className="h-9 w-9 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">Enter a number or email — or click any number in the other tabs</p>
                <p className="text-gray-400 text-xs mt-1">Shows every call, WhatsApp, and email exchanged with that school.</p>
              </div>
            ) : (
              <>
                <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="font-mono font-semibold text-gray-800">{tlInput}</span>
                  {tlParty?.name
                    ? <span className="text-sm text-gray-700">{tlParty.name} <span className="text-xs text-gray-400">({tlParty.source})</span></span>
                    : <span className="px-2 py-0.5 rounded-full text-[10px] border border-dashed border-gray-300 text-gray-500">Unidentified</span>}
                </div>
                {tlEvents.length === 0 ? (
                  <div className="text-center py-10 bg-white rounded-xl border border-gray-200 text-sm text-gray-400">
                    No interactions recorded with this number/email yet.
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                    {tlEvents.map((ev, i) => (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <span className="flex-shrink-0 mt-0.5">
                          {ev.kind === "call"
                            ? (ev.direction === "outbound"
                              ? <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                              : <PhoneIncoming className="h-4 w-4 text-emerald-600" />)
                            : ev.kind === "reply"
                              ? <MessageSquare className="h-4 w-4 text-green-600" />
                              : <Mail className="h-4 w-4 text-indigo-500" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-800">{ev.title}</span>
                            <span className="text-xs text-gray-400">{fmtWhen(ev.when)}</span>
                            {ev.recordingUrl && (
                              <a href={ev.recordingUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-0.5">
                                <PlayCircle className="h-3 w-3" />recording
                              </a>
                            )}
                          </div>
                          {ev.detail && <p className="text-xs text-gray-500 mt-0.5 break-words">{ev.detail}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ══ TAB: REPORTS ═══════════════════════════════════════════════════ */}
          <TabsContent value="reports" className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="date" value={repFrom} onChange={e => setRepFrom(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={repTo} onChange={e => setRepTo(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <Button size="sm" className="h-8 text-xs" onClick={loadReports} disabled={repLoading}>
                {repLoading ? "Loading…" : "Run report"}
              </Button>
            </div>

            {repData && (
              <>
                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 rounded-full text-xs bg-white border border-gray-200 text-gray-600">Sent: <b className="text-gray-900">{repData.totals.sent}</b></span>
                  <span className="px-3 py-1 rounded-full text-xs bg-white border border-gray-200 text-gray-600">Delivered: <b className="text-gray-900">{repData.totals.delivered}</b></span>
                  <span className="px-3 py-1 rounded-full text-xs bg-white border border-gray-200 text-gray-600">Read: <b className="text-gray-900">{repData.totals.read}</b></span>
                  <span className="px-3 py-1 rounded-full text-xs bg-emerald-50 border border-emerald-200 text-emerald-700">Replied: <b>{repData.totals.replied}</b></span>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-800">Daily volumes</h3>
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => downloadCsv(`messages_daily_${repFrom}_${repTo}.csv`,
                        ["Day", "WhatsApp", "Email", "Replies"],
                        repData.daily.map(d => [d.day, d.whatsapp, d.email, d.replies]))}>
                      <Download className="h-3 w-3 mr-1" />CSV
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-100">
                          <th className="text-left px-4 py-2 font-medium">Day</th>
                          <th className="text-right px-4 py-2 font-medium">WhatsApp</th>
                          <th className="text-right px-4 py-2 font-medium">Email</th>
                          <th className="text-right px-4 py-2 font-medium">Replies</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repData.daily.map(d => (
                          <tr key={d.day} className="border-b border-gray-50">
                            <td className="px-4 py-1.5 font-mono">{d.day}</td>
                            <td className="px-4 py-1.5 text-right">{d.whatsapp}</td>
                            <td className="px-4 py-1.5 text-right">{d.email}</td>
                            <td className="px-4 py-1.5 text-right">{d.replies}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
