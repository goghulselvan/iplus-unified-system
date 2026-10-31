import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

import PaperEditor, { type PaperEditorProps } from "./PaperEditor";

afterEach(cleanup);

const q = (n: number, over: Record<string, unknown> = {}) => ({
  id: `q${n}`, paper_id: "p1", question_number: n, question_text: `Question ${n}`, has_figure: false,
  correct_answer: "A", is_grace: false, skill_category: "Reasoning", skill_description: null,
  nep_skill_mapping: null, cognitive_level: "Apply", ai_confidence: 0.9, human_edited: false,
  updated_by: null, updated_at: "2026-10-31", ...over,
});

const base = (questions: ReturnType<typeof q>[], extra: Partial<PaperEditorProps> = {}): PaperEditorProps => ({
  paper: {
    id: "p1", project_id: "proj", class_code: "01", olympiad_code: "MPO", slot_template_id: "s1",
    total_questions: 5, pdf_r2_key: "proj/papers/p1.pdf", pdf_file_name: "a.pdf", status: "draft",
    analysis_status: "none", analysis_progress: 0, analysis_error: null, created_by: null,
    created_at: "", updated_by: null, updated_at: "", deleted_at: null,
  } as PaperEditorProps["paper"],
  paperName: "Class 1 · Maths · Slot 1",
  questions: questions as unknown as PaperEditorProps["questions"],
  skills: ["Reasoning"],
  onBack: vi.fn(), onSave: vi.fn(async () => {}), onSetStatus: vi.fn(async () => {}),
  onCopy: vi.fn(async () => {}), onChanged: vi.fn(),
  ...extra,
});

const five = (over: Record<number, Record<string, unknown>> = {}) =>
  [1, 2, 3, 4, 5].map((n) => q(n, over[n] ?? {}));

describe("PaperEditor", () => {
  it("disables the answer buttons when Grace is switched on", async () => {
    render(<PaperEditor {...base(five())} />);
    const group = screen.getByRole("group", { name: "Answer for question 2" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    await userEvent.click(screen.getByRole("switch", { name: "Grace for question 2" }));
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(screen.getByText("Every student gets this mark")).toBeTruthy();
  });

  it("explains what is missing when Mark as Ready is blocked", async () => {
    render(<PaperEditor {...base(five({ 4: { correct_answer: null } }))} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as Ready" }));
    expect(screen.getByText(/Questions 4 have no answer and are not marked as grace/)).toBeTruthy();
  });

  it("shows the count of unsaved changes", async () => {
    render(<PaperEditor {...base(five())} />);
    await userEvent.click(screen.getByRole("switch", { name: "Grace for question 1" }));
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("asks before re-analysing when corrections exist, with Keep my corrections focused", async () => {
    render(<PaperEditor {...base(five({ 2: { human_edited: true } }))} />);
    await userEvent.click(screen.getByRole("button", { name: "Analyse with AI" }));
    const keep = await screen.findByRole("button", { name: "Keep my corrections" });
    await waitFor(() => expect(document.activeElement).toBe(keep));
    expect(screen.getByText(/1 question has been corrected/)).toBeTruthy();
  });

  it("disables Analyse while there are unsaved edits", async () => {
    render(<PaperEditor {...base(five())} />);
    const btn = screen.getByRole("button", { name: "Analyse with AI" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    await userEvent.click(screen.getByRole("switch", { name: "Grace for question 1" }));
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("Save or discard your changes first")).toBeTruthy();
  });
});
