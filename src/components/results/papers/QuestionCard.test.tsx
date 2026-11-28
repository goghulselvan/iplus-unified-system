import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

import { QuestionCard } from "./QuestionCard";
import PaperEditor from "./PaperEditor";

afterEach(cleanup);

const q = (n: number, over: Record<string, unknown> = {}) => ({
  id: `q${n}`, paper_id: "p1", question_number: n, question_text: `Question text ${n}`, has_figure: false,
  correct_answer: "B", is_grace: false, skill_category: "Reasoning", skill_description: null,
  nep_skill_mapping: null, cognitive_level: "Apply", ai_confidence: 0.9, human_edited: false,
  updated_by: null, updated_at: "2026-10-31",
  option_a: "Red", option_b: "Green", option_c: "Blue", option_d: "Yellow",
  key_answer: "B", ai_answer: "B", ai_reason: null, recheck_answer: null, recheck_confidence: null,
  recheck_reason: null, rechecked_at: null, figure_page: null, figure_box: null, check_status: "confirmed",
  ...over,
}) as never;

const card = (question: ReturnType<typeof q>, onChange = vi.fn(), onNav = vi.fn()) =>
  render(<QuestionCard question={question} skills={["Reasoning"]} pdf={null} onChange={onChange} onNav={onNav} />);

describe("QuestionCard", () => {
  it("shows all four options and marks the correct one", () => {
    card(q(1));
    for (const l of ["A", "B", "C", "D"]) expect(screen.getByTestId(`option-1-${l}`)).toBeTruthy();
    expect(screen.getByText("Yellow")).toBeTruthy();
    expect(screen.getByTestId("option-1-B").getAttribute("data-correct")).toBe("true");
    expect(within(screen.getByTestId("option-1-B")).getByText("Correct answer")).toBeTruthy();
    expect(screen.getByTestId("option-1-A").getAttribute("data-correct")).toBe("false");
    expect(screen.getByText("Key: B")).toBeTruthy();
    expect(screen.getByText("AI: B (90% sure)")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("shows the strong prompt and the three decision buttons for a strong mismatch", async () => {
    const onChange = vi.fn();
    card(q(2, { ai_answer: "D", recheck_answer: "D", recheck_confidence: 0.94, rechecked_at: "t", recheck_reason: "Yellow is the colour of the sun", ai_reason: "The sun is yellow", check_status: "mismatch_strong" }), onChange);
    expect(screen.getByText("AI strongly disagrees")).toBeTruthy();
    expect(screen.getByText(/94% sure the answer is D, but the answer key says B/)).toBeTruthy();
    expect(screen.getByText(/Yellow is the colour of the sun/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use AI's answer (D)" }));
    expect(onChange).toHaveBeenCalledWith(2, { correct_answer: "D", is_grace: false, check_status: "resolved", also_correct: null });
    await userEvent.click(screen.getByRole("button", { name: "Keep key (B)" }));
    expect(onChange).toHaveBeenLastCalledWith(2, { correct_answer: "B", is_grace: false, check_status: "resolved", also_correct: null });
    await userEvent.click(screen.getByRole("button", { name: "Both correct (B and D)" }));
    expect(onChange).toHaveBeenLastCalledWith(2, { correct_answer: "B", is_grace: false, check_status: "resolved", also_correct: "D" });
    await userEvent.click(screen.getByRole("button", { name: "Mark grace" }));
    expect(onChange).toHaveBeenLastCalledWith(2, { is_grace: true, correct_answer: "B", check_status: "resolved", also_correct: null });
  });

  it("marks a second letter as also correct and shows both options green", async () => {
    const onChange = vi.fn();
    card(q(4, { also_correct: "A" }), onChange);
    expect(screen.getByTestId("option-4-A").getAttribute("data-correct")).toBe("true");
    expect(screen.getByTestId("option-4-B").getAttribute("data-correct")).toBe("true");
    expect(screen.getByText("Also correct", { selector: "span" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "Other answers also correct for question 4" });
    const btn = (l: string) => Array.from(group.querySelectorAll("button")).find((b) => b.textContent === l)!;
    expect(btn("B").hasAttribute("disabled")).toBe(true);
    await userEvent.click(btn("C"));
    expect(onChange).toHaveBeenLastCalledWith(4, { also_correct: "AC" });
    await userEvent.click(btn("A"));
    expect(onChange).toHaveBeenLastCalledWith(4, { also_correct: null });
  });

  it("clears the flag when a second letter is accepted on a flagged question", async () => {
    const onChange = vi.fn();
    card(q(5, { ai_answer: "A", check_status: "mismatch" }), onChange);
    const group = screen.getByRole("group", { name: "Other answers also correct for question 5" });
    await userEvent.click(Array.from(group.querySelectorAll("button")).find((x) => x.textContent === "A")!);
    expect(onChange).toHaveBeenLastCalledWith(5, { also_correct: "A", check_status: "resolved" });
  });

  it("sets the answer with the A to D keys and moves with the arrows", async () => {
    const onChange = vi.fn();
    const onNav = vi.fn();
    card(q(3), onChange, onNav);
    screen.getByRole("article", { name: /Question 3/ }).focus();
    await userEvent.keyboard("d");
    expect(onChange).toHaveBeenCalledWith(3, { correct_answer: "D", also_correct: null });
    await userEvent.keyboard("g");
    expect(onChange).toHaveBeenLastCalledWith(3, { is_grace: true, correct_answer: null, also_correct: null });
    await userEvent.keyboard("{ArrowDown}");
    expect(onNav).toHaveBeenLastCalledWith(3, 1);
    await userEvent.keyboard("{Enter}");
    expect(onNav).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{ArrowUp}");
    expect(onNav).toHaveBeenLastCalledWith(3, -1);
  });
});

describe("QuestionCard keyboard guards", () => {
  it("ignores letters typed in a select and events from outside the card", async () => {
    const onChange = vi.fn();
    card(q(3), onChange);
    const select = screen.getByRole("combobox", { name: "Skill for question 3" });
    select.focus();
    await userEvent.keyboard("d");
    expect(onChange).not.toHaveBeenCalled();
    const article = screen.getByRole("article", { name: /Question 3/ });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    // A portal child bubbles through React but is not inside the card's DOM.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.keyDown(outside, { key: "d" });
    expect(onChange).not.toHaveBeenCalled();
    expect(article).toBeTruthy();
    outside.remove();
  });
});

describe("PaperEditor answer key", () => {
  const props = (questions: ReturnType<typeof q>[]) => ({
    paper: { id: "p1", project_id: "proj", class_code: "01", olympiad_code: "MPO", slot_template_id: "s1", total_questions: 3,
      pdf_r2_key: null, pdf_file_name: null, status: "draft", analysis_status: "none", analysis_progress: 0, analysis_error: null } as never,
    paperName: "Class 1 · Maths", questions: questions as never, skills: ["Reasoning"],
    onBack: vi.fn(), onSave: vi.fn(async () => {}), onSaveKey: vi.fn(async () => {}), onSetStatus: vi.fn(async () => {}),
    onCopy: vi.fn(async () => {}), onChanged: vi.fn(),
  });

  it("blocks Ready and names the questions that need a decision", async () => {
    const p = props([q(1), q(2, { ai_answer: "D", check_status: "mismatch" }), q(3, { ai_answer: "A", recheck_answer: "A", recheck_confidence: 0.95, rechecked_at: "t", check_status: "mismatch_strong" })]);
    render(<PaperEditor {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as Ready" }));
    expect(screen.getByText(/Questions 2, 3 need your decision/)).toBeTruthy();
    expect(p.onSetStatus).not.toHaveBeenCalled();
  });

  it("summarises and filters", async () => {
    render(<PaperEditor {...props([q(1), q(2, { ai_answer: "D", check_status: "mismatch" }), q(3, { key_answer: null, ai_answer: "A", check_status: "unchecked" })])} />);
    expect(screen.getByTestId("key-summary").textContent).toMatch(/1 confirmed · 1 needs your decision · 0 key only · 1 no key/);
    await userEvent.click(screen.getByRole("button", { name: /Need decision/ }));
    expect(screen.queryByRole("article", { name: /Question 1,/ })).toBeNull();
    expect(screen.getByRole("article", { name: /Question 2,/ })).toBeTruthy();
  });
});

describe("PaperEditor save and recheck", () => {
  const props = (questions: ReturnType<typeof q>[]) => ({
    paper: { id: "p1", project_id: "proj", class_code: "01", olympiad_code: "MPO", slot_template_id: "s1", total_questions: 3,
      pdf_r2_key: null, pdf_file_name: null, status: "draft", analysis_status: "none", analysis_progress: 0, analysis_error: null } as never,
    paperName: "Class 1 · Maths", questions: questions as never, skills: ["Reasoning"],
    onBack: vi.fn(), onSave: vi.fn(async () => {}), onSaveKey: vi.fn(async () => {}), onSetStatus: vi.fn(async () => {}),
    onCopy: vi.fn(async () => {}), onChanged: vi.fn(),
  });

  it("saves a decision and a plain edit together, every row carrying check_status", async () => {
    const p = props([q(1), q(2, { ai_answer: "D", check_status: "mismatch" }), q(3)]);
    render(<PaperEditor {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep key (B)" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Skill for question 3" }), "");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const rows = (p.onSave.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.check_status)).toEqual(["resolved", "confirmed"]);
  });

  it("offers a Recheck button whenever a question still needs one", () => {
    render(<PaperEditor {...props([q(1), q(2, { ai_answer: "D", check_status: "mismatch" }), q(3, { ai_answer: "C", check_status: "mismatch" })])} />);
    expect(screen.getByRole("button", { name: "Recheck 2 questions" })).toBeTruthy();
  });

  it("shows no Recheck button when nothing needs one", () => {
    render(<PaperEditor {...props([q(1), q(2)])} />);
    expect(screen.queryByRole("button", { name: /^Recheck/ })).toBeNull();
  });
});
