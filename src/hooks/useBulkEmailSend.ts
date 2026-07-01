import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BulkEmailResult {
  schoolId: string;
  schoolName: string;
  email: string | null;
  status: "sent" | "failed" | "skipped";
  reason?: string;
}

export interface BulkEmailProgress {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  done: boolean;
  results: BulkEmailResult[];
}

const BATCH_SIZE = 20;

export const useBulkEmailSend = () => {
  const [progress, setProgress] = useState<BulkEmailProgress>({
    total: 0, sent: 0, failed: 0, skipped: 0, done: false, results: [],
  });
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setProgress({ total: 0, sent: 0, failed: 0, skipped: 0, done: false, results: [] });
  }, []);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  const sendOne = async (
    schoolId: string,
    templateType: string,
    userId: string | undefined,
  ): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("send-template-email", {
        body: { schoolId, templateType, userId },
      });
      if (error) return { ok: false, reason: error.message?.slice(0, 200) };
      if (data?.success === false) return { ok: false, reason: String(data.error || "Failed").slice(0, 200) };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message || "Network error").slice(0, 200) };
    }
  };

  const run = useCallback(async (
    schools: Array<{ id: string; school_name: string; email: string | null }>,
    templateType: string,
  ) => {
    cancelRef.current = false;
    setRunning(true);
    const { data: { user } } = await supabase.auth.getUser();
    const results: BulkEmailResult[] = [];
    setProgress({ total: schools.length, sent: 0, failed: 0, skipped: 0, done: false, results: [] });

    let sent = 0, failed = 0, skipped = 0;
    for (let i = 0; i < schools.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = schools.slice(i, i + BATCH_SIZE);
      // Sequential within batch to avoid Resend rate limits
      for (const s of batch) {
        if (cancelRef.current) break;
        if (!s.email) {
          skipped++;
          results.push({ schoolId: s.id, schoolName: s.school_name, email: null, status: "skipped", reason: "No email address" });
        } else {
          const res = await sendOne(s.id, templateType, user?.id);
          if (res.ok) sent++;
          else failed++;
          results.push({ schoolId: s.id, schoolName: s.school_name, email: s.email, status: res.ok ? "sent" : "failed", reason: res.reason });
        }
        setProgress({ total: schools.length, sent, failed, skipped, done: false, results: [...results] });
      }
      // Small delay between batches to respect Resend rate limits
      if (i + BATCH_SIZE < schools.length) await new Promise(r => setTimeout(r, 500));
    }

    setProgress({ total: schools.length, sent, failed, skipped, done: true, results });
    setRunning(false);
    return { total: schools.length, sent, failed, skipped, results };
  }, []);

  return { progress, running, run, cancel, reset };
};
