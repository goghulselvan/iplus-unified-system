import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BulkSendResult {
  schoolId: string;
  schoolName: string;
  mobile: string | null;
  status: "sent" | "failed" | "skipped";
  reason?: string;
}

export interface BulkSendProgress {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  done: boolean;
  results: BulkSendResult[];
}

const BATCH_SIZE = 50;

export const useBulkWhatsAppSend = () => {
  const [progress, setProgress] = useState<BulkSendProgress>({
    total: 0, sent: 0, failed: 0, skipped: 0, done: false, results: [],
  });
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setProgress({ total: 0, sent: 0, failed: 0, skipped: 0, done: false, results: [] });
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const sendOne = async (
    schoolId: string,
    templateKey: string,
    mobile: string | null,
  ): Promise<{ ok: boolean; reason?: string }> => {
    if (!mobile) return { ok: false, reason: "No mobile number" };
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-template", {
        body: { schoolId, templateKey, mobileOverride: mobile },
      });
      if (error) {
        let detail = error.message || "Send failed";
        try {
          const ctx: any = (error as any).context;
          if (ctx?.json) {
            const body = await ctx.json();
            detail = body?.error || body?.message || detail;
          }
        } catch { /* keep detail */ }
        return { ok: false, reason: String(detail).slice(0, 200) };
      }
      if (data?.success === false) {
        return { ok: false, reason: String(data.error || data.askeva?.message || "Failed").slice(0, 200) };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message || "Network error").slice(0, 200) };
    }
  };

  const run = useCallback(
    async (
      schools: Array<{ id: string; school_name: string; mobile1: string | null }>,
      templateKey: string,
    ) => {
      cancelRef.current = false;
      setRunning(true);
      const results: BulkSendResult[] = [];
      setProgress({ total: schools.length, sent: 0, failed: 0, skipped: 0, done: false, results: [] });

      let sent = 0, failed = 0, skipped = 0;
      for (let i = 0; i < schools.length; i += BATCH_SIZE) {
        if (cancelRef.current) break;
        const batch = schools.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (s) => {
            const res = await sendOne(s.id, templateKey, s.mobile1);
            const status: BulkSendResult["status"] =
              !s.mobile1 ? "skipped" : res.ok ? "sent" : "failed";
            return {
              schoolId: s.id,
              schoolName: s.school_name,
              mobile: s.mobile1,
              status,
              reason: res.ok ? undefined : res.reason,
            } as BulkSendResult;
          })
        );
        for (const r of batchResults) {
          if (r.status === "sent") sent++;
          else if (r.status === "skipped") skipped++;
          else failed++;
          results.push(r);
        }
        setProgress({ total: schools.length, sent, failed, skipped, done: false, results: [...results] });
      }

      setProgress({ total: schools.length, sent, failed, skipped, done: true, results });
      setRunning(false);
      return { total: schools.length, sent, failed, skipped, results };
    },
    []
  );

  return { progress, running, run, cancel, reset };
};
