import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MessageSquare, Send, Plus, ExternalLink, RefreshCw, Search } from "lucide-react";

interface ConversationRow {
  phone: string;
  display_name: string;
  school_id: string | null;
  prospect_school_id: string | null;
  last_message: string | null;
  last_at: string;
  last_direction: "in" | "out";
  last_status: string;
  unread_count: number;
}

interface ThreadEvent {
  id: string | null;
  message: string | null;
  at: string;
  direction: "in" | "out";
  status: string;
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const DAY_MS = 24 * 60 * 60 * 1000;

export function WhatsAppChat() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [receivedOnly, setReceivedOnly] = useState(false);

  const [selected, setSelected] = useState<ConversationRow | null>(null);
  const [thread, setThread] = useState<ThreadEvent[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const fetchConversations = useCallback(async () => {
    setConvLoading(true);
    const { data, error } = await supabase.rpc("get_whatsapp_conversations", { p_search: search.trim() || null });
    if (error) toast({ title: "Failed to load conversations", description: error.message, variant: "destructive" });
    setConversations((data as ConversationRow[]) ?? []);
    setConvLoading(false);
  }, [search, toast]);

  useEffect(() => {
    const t = setTimeout(fetchConversations, 250);
    return () => clearTimeout(t);
  }, [fetchConversations]);

  // Light live-ish refresh (no Supabase Realtime subscription here — this
  // aggregates three tables via a fairly involved RPC, a full postgres_changes
  // subscription across all three would fire far more often than the list
  // actually needs to move) so a reply that comes in while staff are sitting
  // on this tab still shows up without a manual reload.
  useEffect(() => {
    const interval = setInterval(fetchConversations, 20000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const selectConversation = useCallback(async (c: ConversationRow) => {
    setSelected(c);
    setThreadLoading(true);
    const { data, error } = await supabase.rpc("get_whatsapp_thread", { p_phone: c.phone });
    if (error) toast({ title: "Failed to load conversation", description: error.message, variant: "destructive" });
    const events = (data as ThreadEvent[]) ?? [];
    setThread(events);
    setThreadLoading(false);

    const unreadIds = events.filter((e) => e.direction === "in" && e.status === "unread" && e.id).map((e) => e.id!);
    if (unreadIds.length > 0) {
      await supabase.from("wa_replies").update({ status: "read" }).in("id", unreadIds);
      setConversations((prev) => prev.map((x) => (x.phone === c.phone ? { ...x, unread_count: 0 } : x)));
    }
  }, [toast]);

  const filtered = conversations.filter((c) => {
    if (receivedOnly && c.last_direction !== "in") return false;
    if (statusFilter === "unread" && c.unread_count === 0) return false;
    if (statusFilter === "delivered" && c.last_status !== "delivered") return false;
    if (statusFilter === "read" && c.last_status !== "read") return false;
    return true;
  });

  const lastInbound = [...thread].reverse().find((e) => e.direction === "in") ?? null;
  const withinWindow = lastInbound ? Date.now() - new Date(lastInbound.at).getTime() < DAY_MS : false;

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-reply", {
        body: { waReplyId: lastInbound?.id ?? null, phone: selected.phone, text: replyText.trim() },
      });
      if (error) {
        const detail = await (error as any)?.context?.json?.().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      setReplyText("");
      await selectConversation(selected);
      fetchConversations();
    } catch (e: any) {
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[75vh] min-h-[500px] border rounded-xl overflow-hidden bg-white">
      {/* LEFT — conversation list */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="Search name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm pl-8"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0 flex-shrink-0" onClick={() => setComposeOpen(true)} title="Compose new">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-7 text-xs w-[104px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={receivedOnly ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setReceivedOnly((v) => !v)}
            >
              Received only
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {convLoading ? (
            <div className="text-center py-10 text-gray-400"><RefreshCw className="h-4 w-4 animate-spin mx-auto" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-400">No conversations match.</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.phone}
                onClick={() => selectConversation(c)}
                className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${selected?.phone === c.phone ? "bg-indigo-50" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.display_name}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtWhen(c.last_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-xs text-gray-500 truncate">
                    {c.last_direction === "out" ? "You: " : ""}{c.last_message || "—"}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="bg-emerald-500 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 flex-shrink-0">
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT — thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageSquare className="h-10 w-10 mb-2 opacity-40" />
            <p className="text-sm">Select a conversation</p>
          </div>
        ) : (
          <>
            <div className="p-3 border-b flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{selected.display_name}</p>
                <p className="text-xs text-gray-400 font-mono">{selected.phone}</p>
              </div>
              {selected.school_id && (
                <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => navigate(`/schools/${selected.school_id}`)}>
                  View School <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
              {threadLoading ? (
                <div className="text-center py-10 text-gray-400"><RefreshCw className="h-4 w-4 animate-spin mx-auto" /></div>
              ) : thread.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-400">No messages yet.</div>
              ) : (
                thread.map((e, i) => (
                  <div key={i} className={`flex ${e.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${e.direction === "out" ? "bg-indigo-600 text-white" : "bg-white border border-gray-200"}`}>
                      <p className="whitespace-pre-wrap break-words">{e.message || "—"}</p>
                      <p className={`text-[10px] mt-1 ${e.direction === "out" ? "text-indigo-200" : "text-gray-400"}`}>
                        {fmtWhen(e.at)} · {e.status}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t flex-shrink-0">
              {withinWindow ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="Type a message…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !sending) sendReply(); }}
                    disabled={sending}
                  />
                  <Button onClick={sendReply} disabled={sending || !replyText.trim()}>
                    <Send className="h-4 w-4 mr-1" />{sending ? "Sending…" : "Send"}
                  </Button>
                </div>
              ) : (
                <div className="text-center text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-2.5 px-3">
                  Reply window closed — this conversation is history only.
                  {lastInbound && ` Last message from them: ${fmtWhen(lastInbound.at)}.`} A new template message is needed to start a fresh 24-hour window (use Compose New).
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        projectId={activeProject?.id ?? null}
        onSent={fetchConversations}
      />
    </div>
  );
}

// ── Compose New — starts a conversation with a number that has no open
// 24-hour window. WhatsApp's own platform rule (not a CRM limitation): only
// a pre-approved template can do this. Scoped to existing CRM schools —
// send-whatsapp-template only ever resolves a real `schools` row.
function ComposeDialog({
  open, onOpenChange, projectId, onSent,
}: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string | null; onSent: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; school_name: string; ss_no: number | null }[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<{ id: string; school_name: string } | null>(null);
  const [templates, setTemplates] = useState<{ template_key: string; template_name: string }[]>([]);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); setSelectedSchool(null); setTemplateKey(""); }
  }, [open]);

  useEffect(() => {
    if (!open || !projectId) return;
    supabase.from("whatsapp_templates")
      .select("template_key, template_name")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("template_name")
      .then(({ data }) => setTemplates(data ?? []));
  }, [open, projectId]);

  useEffect(() => {
    if (!query.trim() || selectedSchool) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("search_schools_for_invoice", { p_query: query.trim(), p_limit: 8 });
      setResults(((data ?? []) as any[]).filter((r) => r.source === "crm"));
    }, 250);
    return () => clearTimeout(t);
  }, [query, selectedSchool]);

  const handleSend = async () => {
    if (!selectedSchool || !templateKey) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-template", {
        body: { schoolId: selectedSchool.id, templateKey },
      });
      if (error) {
        const detail = await (error as any)?.context?.json?.().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      if (data?.error) throw new Error(data.error);
      toast({ title: "Message sent", description: `Sent to ${selectedSchool.school_name}` });
      onSent();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compose New</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">School</label>
            {selectedSchool ? (
              <div className="flex items-center justify-between mt-1 px-3 py-2 rounded-md border bg-gray-50 text-sm">
                <span>{selectedSchool.school_name}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setSelectedSchool(null); setQuery(""); }}>Change</Button>
              </div>
            ) : (
              <>
                <Input placeholder="Search school by name or SS No…" value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1" />
                {results.length > 0 && (
                  <div className="mt-1 border rounded-md divide-y max-h-40 overflow-y-auto">
                    {results.map((r) => (
                      <button
                        key={r.id}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
                        onClick={() => { setSelectedSchool({ id: r.id, school_name: r.school_name }); setResults([]); }}
                      >
                        {r.school_name}{r.ss_no != null && <span className="text-gray-400"> (SS {r.ss_no})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Template</label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a template…" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.template_key} value={t.template_key}>{t.template_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {templates.length === 0 && <p className="text-xs text-gray-400 mt-1">No active templates for this project.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={!selectedSchool || !templateKey || sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
