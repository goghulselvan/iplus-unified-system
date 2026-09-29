import { useState, useEffect, useCallback } from "react";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageSquare, Mail, RefreshCw, Inbox, Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppChat } from "@/components/messages/WhatsAppChat";

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

type ReportData = {
  totals: { sent: number; delivered: number; read: number; replied: number };
  daily: { day: string; whatsapp: number; email: number; replies: number }[];
};

const STATUS_COLOR: Record<string, string> = {
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-indigo-100 text-indigo-700",
  read: "bg-green-100 text-green-700",
  replied: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  bounced: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-600",
};

export default function MessageCentre() {
  const { toast } = useToast();
  const [tab, setTab] = useState("whatsapp");

  // ── Email tab state ──────────────────────────────────────────────────────────
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [search, setSearch] = useState("");

  // ── Reports state ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [repFrom, setRepFrom] = useState(monthAgo);
  const [repTo, setRepTo] = useState(today);
  const [repData, setRepData] = useState<ReportData | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  const fetchFeed = useCallback(async () => {
    setFeedLoading(true);
    const { data, error } = await supabase.rpc("get_message_feed", {
      p_from: fFrom || null, p_to: fTo || null, p_limit: 300,
    });
    if (error) toast({ title: "Failed to load messages", description: error.message, variant: "destructive" });
    setFeed((data as FeedRow[]) ?? []);
    setFeedLoading(false);
  }, [fFrom, fTo, toast]);

  useEffect(() => { if (tab === "email") fetchFeed(); }, [tab, fetchFeed]);

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

  const emailRows = feed.filter(f => {
    if (f.channel.toLowerCase() !== "email") return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      const name = (f.party_name ?? "").toLowerCase();
      if (!name.includes(s)) return false;
    }
    return true;
  });

  const fmtWhen = (iso: string | null) => iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

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
          <Button variant="outline" size="sm" onClick={() => { fetchFeed(); }}>
            <RefreshCw className={`h-3.5 w-3.5 ${feedLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="whatsapp"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />WhatsApp</TabsTrigger>
            <TabsTrigger value="email"><Mail className="h-3.5 w-3.5 mr-1.5" />Email</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          {/* ══ TAB: WHATSAPP ══════════════════════════════════════════════════ */}
          <TabsContent value="whatsapp">
            <WhatsAppChat />
          </TabsContent>

          {/* ══ TAB: EMAIL ═════════════════════════════════════════════════════ */}
          <TabsContent value="email" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <span className="text-xs text-gray-400">to</span>
              <Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} className="w-36 h-8 text-xs bg-white" />
              <Input placeholder="Search school name…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs bg-white flex-1 min-w-40" />
            </div>

            {feedLoading ? (
              <div className="text-center py-14 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : emailRows.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <Mail className="h-9 w-9 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 font-medium text-sm">No emails match these filters</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {emailRows.map(f => {
                  const isOut = f.direction === "outbound";
                  return (
                    <div key={`${f.source}-${f.event_id}`} className="px-4 py-3 flex items-center gap-3">
                      <Mail className={`h-4 w-4 flex-shrink-0 ${isOut ? "text-indigo-500" : "text-emerald-600"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{f.party_name ?? "Unknown"}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${f.party_kind === "CRM" ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-700"}`}>
                            {f.party_kind}
                          </span>
                          <span className="text-xs text-gray-400">{fmtWhen(f.when_at)}</span>
                          {f.status && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[f.status.toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>
                              {f.status}
                            </span>
                          )}
                        </div>
                        {f.message && <p className="text-sm text-gray-600 mt-0.5 truncate">{f.message}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
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
