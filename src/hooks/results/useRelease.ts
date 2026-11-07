// All access to the release / send database objects lives here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/results/friendlyError";
import type { ResultsFile } from "../../../supabase/functions/results-send/message";

export const NOT_SUPERADMIN = "Only a superadmin can release or send results.";
export const WA_TEMPLATE_KEY = "results_released";

export interface SendBatch {
  id: string; project_id: string; channel: "email" | "whatsapp"; test_target: string | null;
  status: "staged" | "sending" | "done"; created_at: string; approved_at: string | null;
}
export interface SendItem {
  id: string; batch_id: string; school_id: string | null; target: string | null;
  payload: { schoolName?: string; ssNo?: string; contactName?: string | null; projectName?: string | null; files?: ResultsFile[]; testMode?: boolean };
  status: "pending" | "sending" | "sent" | "failed" | "unknown"; error: string | null; sent_at: string | null; attempts: number;
}
export interface ResendFlag { id: string; school_id: string; reason: string; created_at: string; school_name: string | null }
export interface SendSummary { sent: number; failed: number; skipped: number }

/** True only for a superadmin. Servers re-check every call; this just hides the controls. */
export function useIsSuperadmin() {
  const { profile, loading } = useAuth();
  return { loading, isSuperadmin: profile?.role === "superadmin" };
}

const dbError = (e: { message?: string } | null, fallback: string) => friendlyError(e, fallback);

export function useResendFlags(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ["results", "resend-flags", projectId],
    enabled: !!projectId && enabled,
    queryFn: async (): Promise<ResendFlag[]> => {
      const { data, error } = await supabase.from("result_resend_flags")
        .select("id, school_id, reason, created_at, schools(school_name)")
        .eq("project_id", projectId).is("cleared_at", null).order("created_at");
      if (error) throw dbError(error, "We could not load the resend flags.");
      return (data ?? []).map((r: { id: string; school_id: string; reason: string; created_at: string; schools?: { school_name?: string } | null }) =>
        ({ id: r.id, school_id: r.school_id, reason: r.reason, created_at: r.created_at, school_name: r.schools?.school_name ?? null }));
    },
  });
}

export function useWhatsAppTemplate(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ["results", "wa-template", projectId],
    enabled: !!projectId && enabled,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from("whatsapp_templates").select("id")
        .eq("project_id", projectId).eq("template_key", WA_TEMPLATE_KEY).eq("is_active", true).limit(1);
      if (error) return false;
      return (data?.length ?? 0) > 0;
    },
  });
}

export function useSendBatches(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: ["results", "send-batches", projectId],
    enabled: !!projectId && enabled,
    refetchInterval: (q: { state: { data?: SendBatch[] } }) => (q.state.data?.some((b) => b.status === "sending") ? 5000 : false),
    queryFn: async (): Promise<SendBatch[]> => {
      const { data, error } = await supabase.from("result_send_batches")
        .select("id, project_id, channel, test_target, status, created_at, approved_at")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(30);
      if (error) throw dbError(error, "We could not load the send history.");
      return (data ?? []) as SendBatch[];
    },
  });
}

export function useSendItems(batchId?: string | null) {
  return useQuery({
    queryKey: ["results", "send-items", batchId],
    enabled: !!batchId,
    queryFn: async (): Promise<SendItem[]> => {
      const { data, error } = await supabase.from("result_send_items")
        .select("id, batch_id, school_id, target, payload, status, error, sent_at, attempts").eq("batch_id", batchId).order("created_at");
      if (error) throw dbError(error, "We could not load this send.");
      return (data ?? []) as unknown as SendItem[];
    },
  });
}

/** schools.ss_no for the folder name of each school's files. */
export async function fetchSsNumbers(schoolIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < schoolIds.length; i += 100) {
    const { data, error } = await supabase.from("schools").select("id, ss_no").in("id", schoolIds.slice(i, i + 100));
    if (error) throw dbError(error, "We could not look up the schools' numbers.");
    for (const r of data ?? []) out.set(r.id as string, String(r.ss_no ?? ""));
  }
  return out;
}

export function useReleaseActions(projectId?: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["results"] });
  const release = useMutation({
    mutationFn: async (schoolIds: string[]): Promise<number> => {
      const { data, error } = await supabase.rpc("results_release_schools", { p_project_id: projectId, p_school_ids: schoolIds, p_notes: null });
      if (error) throw dbError(error, "The results could not be released.");
      return Number(data ?? 0);
    },
    onSuccess: refresh,
  });
  const unrelease = useMutation({
    mutationFn: async (schoolId: string) => {
      const { error } = await supabase.rpc("results_unrelease_school", { p_project_id: projectId, p_school_id: schoolId });
      if (error) throw dbError(error, "The release could not be taken back.");
    },
    onSuccess: refresh,
  });
  const clearFlag = useMutation({
    mutationFn: async (flagId: string) => {
      const { error } = await supabase.rpc("results_clear_resend_flag", { p_flag_id: flagId });
      if (error) throw dbError(error, "The flag could not be cleared.");
    },
    onSuccess: refresh,
  });
  return { release, unrelease, clearFlag };
}

/** Stages a batch. NOTHING is sent. */
export async function stageSend(projectId: string, channel: "email" | "whatsapp", schoolIds: string[], testTarget: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("results_stage_send", {
    p_project_id: projectId, p_channel: channel, p_school_ids: schoolIds, p_test_target: testTarget?.trim() || null,
  });
  if (error) throw dbError(error, "The send could not be prepared.");
  return String(data);
}

export const SEND_MAY_RUN = "The send may still be running. Check the history in a minute before doing anything else.";

async function callSend<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("results-send", { body });
  if (error) {
    let msg: string | undefined;
    try { msg = (await (error as { context?: Response }).context?.json?.())?.error; } catch { /* ignore */ }
    // No readable reply on a send: it may have started, so never say "try again".
    throw new Error(msg || (body.action === "send" ? SEND_MAY_RUN : "We could not reach the sending service. Please try again."));
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export const attachFiles = (batchId: string, files: Record<string, ResultsFile[]>) =>
  callSend<{ ok: boolean; attached: number }>({ action: "attach", batchId, files });
/** The ONLY call that sends. Requires a staged batch (or explicit failed rows to retry). */
export const sendBatch = (batchId: string, retryItemIds?: string[]) =>
  callSend<SendSummary>({ action: "send", batchId, ...(retryItemIds ? { retryItemIds } : {}) });

/** Superadmin: close a send stuck in "sending" for 15+ minutes. Rows left "sending" become unknown. */
export const closeStuckSend = (batchId: string) =>
  callSend<{ unknown: number; notSent: number }>({ action: "close", batchId });

/** Contact name the email will greet, for the preview before staging. */
export async function fetchContactName(schoolId: string): Promise<string | null> {
  const { data } = await supabase.from("schools").select("contact_person_name, principal_name").eq("id", schoolId).maybeSingle();
  return data?.contact_person_name || data?.principal_name || null;
}
