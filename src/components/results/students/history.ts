import type { AuditEntry } from "@/hooks/results/useEvaluations";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "no answer" : String(v));

/** Plain-English lines for one audit row of a result. */
export function describeChange(e: Pick<AuditEntry, "action" | "before" | "after">): string[] {
  if (e.action === "INSERT") {
    return [e.after && (e.after as { status?: string }).status === "absent" ? "Marked absent" : "Result saved"];
  }
  if (e.action === "DELETE") return ["Result removed"];
  const b = (e.before ?? {}) as Record<string, unknown>;
  const a = (e.after ?? {}) as Record<string, unknown>;
  if (!b.deleted_at && a.deleted_at) return ["Result deleted"];
  if (b.deleted_at && !a.deleted_at) return ["Result restored"];
  const out: string[] = [];
  for (const key of ["answers", "marks"] as const) {
    const bv = b[key] as unknown[] | null | undefined;
    const av = a[key] as unknown[] | null | undefined;
    if (!av) continue;
    av.forEach((v, i) => {
      const old = bv?.[i] ?? null;
      if (String(old ?? "") !== String(v ?? "")) out.push(`Q${i + 1}: ${show(old)} → ${show(v)}`);
    });
  }
  if (b.status !== a.status && a.status) out.push(`Status: ${show(b.status)} → ${show(a.status)}`);
  return out.length ? out : ["Updated"];
}
