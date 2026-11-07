// Pure message builders. No Deno or browser imports: the Release & Send page imports this
// file too, so the preview a superadmin approves is the exact text that gets sent.

export interface ResultsFile { key: string; label: string }
export interface Link { label: string; url: string }

export const LINK_DAYS = 7;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Dear X," never ends in punctuation twice and never renders blank. */
export function greetingName(...candidates: unknown[]): string {
  for (const c of candidates) {
    const cleaned = String(c ?? "").replace(/\s+/g, " ").replace(/[\s,;:.]+$/, "").trim();
    if (cleaned) return cleaned;
  }
  return "Sir/Madam";
}

export interface EmailInput {
  schoolName: string;
  contactName?: string | null;
  projectName?: string | null;
  links: Link[];
  testMode: boolean;
}

export function emailSubject(i: Pick<EmailInput, "schoolName" | "projectName" | "testMode">): string {
  const base = `${i.projectName ? i.projectName + " results" : "Results"} for ${i.schoolName}`.replace(/\s+/g, " ").trim();
  return (i.testMode ? "[TEST] " : "") + base;
}

export function buildEmail(i: EmailInput): { subject: string; html: string; text: string } {
  const hello = `Dear ${greetingName(i.contactName, i.schoolName)},`;
  const intro = `The results for ${i.schoolName} are ready${i.projectName ? ` for ${i.projectName}` : ""}. You can download them using the link${i.links.length === 1 ? "" : "s"} below.`;
  const expiry = `The link${i.links.length === 1 ? " works" : "s work"} for ${LINK_DAYS} days. If a link has stopped working, please write to us and we will send a fresh one.`;
  const sign = "Regards,\niPlus Olympiads\ncontact@iplusedu.in";
  const text = [hello, "", intro, "", ...i.links.map((l) => `${l.label}: ${l.url}`), "", expiry, "", sign].join("\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222">` +
    `<p>${esc(hello)}</p><p>${esc(intro)}</p>` +
    `<ul>${i.links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join("")}</ul>` +
    `<p>${esc(expiry)}</p><p>Regards,<br>iPlus Olympiads<br>contact@iplusedu.in</p></div>`;
  return { subject: emailSubject(i), html, text };
}

export interface WaVar { index: number; source: string; customText?: string }

/** Body parameters for the Meta-approved results template. Never empty (Meta fails the message on an empty one). */
export function buildWhatsAppParams(
  vars: WaVar[],
  i: { schoolName: string; contactName?: string | null; projectName?: string | null; links: Link[] },
): string[] {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  return [...vars].sort((a, b) => a.index - b.index).map((v) => {
    let t = "";
    switch (v.source) {
      case "school_name": t = i.schoolName; break;
      case "contact_person": t = greetingName(i.contactName, i.schoolName); break;
      case "project_name": t = i.projectName ?? ""; break;
      // One link only: several presigned URLs would exceed WhatsApp's parameter limit. Email carries them all.
      case "results_link": t = i.links[0]?.url ?? ""; break;
      case "custom": t = v.customText ?? ""; break;
    }
    return one(t) || "-";
  });
}
