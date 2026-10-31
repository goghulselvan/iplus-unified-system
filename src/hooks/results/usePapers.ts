import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { copyPlan, readinessProblems, type ClassGroup, type QuestionRow } from "@/lib/results/paperRules";

export type PaperRow = Tables<"question_papers">;
export type SlotTemplate = Pick<Tables<"exam_slot_templates">, "id" | "slot_name" | "project_id" | "created_at">;
export type ClassRow = Tables<"classes">;
export type SkillRow = Tables<"result_skill_lists">;

const papersKey = (projectId?: string) => ["results", "papers", projectId] as const;
const paperKey = (paperId?: string) => ["results", "paper", paperId] as const;

const FRIENDLY = "That did not work. Please try again.";
const fail = (error: { message?: string; code?: string } | null, fallback = FRIENDLY): never => {
  if (error?.code === "23505") throw new Error("A paper for this class, subject and slot already exists");
  throw new Error(fallback);
};

export function useClasses() {
  return useQuery({
    queryKey: ["results", "classes"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("classes").select("code, display_name, question_count");
      if (error) fail(error, "We could not load the class list. Please refresh.");
      return data as ClassRow[];
    },
  });
}

export function useSlotTemplates(projectId?: string) {
  return useQuery({
    queryKey: ["results", "slots", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_slot_templates")
        .select("id, slot_name, project_id, created_at")
        .eq("project_id", projectId!)
        .order("slot_name", { ascending: true });
      if (error) fail(error, "We could not load the exam slots. Please refresh.");
      return data as SlotTemplate[];
    },
  });
}

export function useSkillLists() {
  return useQuery({
    queryKey: ["results", "skill-lists"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("result_skill_lists").select("*").order("sort_order");
      if (error) fail(error, "We could not load the skill list. Please refresh.");
      return data as SkillRow[];
    },
  });
}

export function skillsFor(all: SkillRow[] | undefined, olympiad: string, group: ClassGroup): string[] {
  return (all ?? []).filter((s) => s.olympiad_code === olympiad && s.class_group === group).map((s) => s.skill);
}

/** All live papers for a project, with how many questions have an answer / are entered. */
export function usePapers(projectId?: string) {
  return useQuery({
    queryKey: papersKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("question_papers")
        .select("*, questions(question_number, correct_answer, is_grace)")
        .eq("project_id", projectId!)
        .is("deleted_at", null);
      if (error) fail(error, "We could not load the question papers. Please refresh.");
      return (data ?? []).map((p) => {
        const { questions, ...paper } = p as PaperRow & {
          questions: Pick<QuestionRow, "question_number" | "correct_answer" | "is_grace">[];
        };
        return {
          ...(paper as PaperRow),
          entered: questions.length,
          answered: questions.filter((q) => q.is_grace || q.correct_answer).length,
        };
      });
    },
  });
}
export type PaperSummary = NonNullable<ReturnType<typeof usePapers>["data"]>[number];

export function usePaper(paperId?: string) {
  return useQuery({
    queryKey: paperKey(paperId),
    enabled: !!paperId,
    queryFn: async () => {
      const { data: paper, error } = await supabase
        .from("question_papers")
        .select("*")
        .eq("id", paperId!)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) fail(error, "We could not open this paper. Please try again.");
      if (!paper) return null;
      const { data: questions, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("paper_id", paperId!)
        .order("question_number");
      if (qErr) fail(qErr, "We could not load the questions. Please try again.");
      return { paper: paper as PaperRow, questions: (questions ?? []) as QuestionRow[] };
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (projectId?: string, paperId?: string) => {
    qc.invalidateQueries({ queryKey: ["results", "papers", projectId] });
    if (!projectId) qc.invalidateQueries({ queryKey: ["results", "papers"] });
    if (paperId) qc.invalidateQueries({ queryKey: paperKey(paperId) });
  };
}

export function useCreatePaper() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: Pick<TablesInsert<"question_papers">, "project_id" | "class_code" | "olympiad_code" | "slot_template_id" | "total_questions">) => {
      const { data, error } = await supabase.from("question_papers").insert(input).select("*").single();
      if (error) fail(error, "We could not create the paper. Please try again.");
      return data as PaperRow;
    },
    onSuccess: (p) => invalidate(p.project_id),
  });
}

export type EditableQuestion = Pick<
  QuestionRow,
  "question_number" | "correct_answer" | "is_grace" | "skill_category" | "cognitive_level"
>;

/** Batch upsert of edited rows. Marks them as human-edited so re-analysis keeps them. */
export function useSaveQuestions(paperId: string, projectId?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (rows: EditableQuestion[]) => {
      if (!rows.length) return;
      const payload = rows.map((r) => ({
        paper_id: paperId,
        question_number: r.question_number,
        correct_answer: r.is_grace ? null : r.correct_answer,
        is_grace: r.is_grace,
        skill_category: r.skill_category,
        cognitive_level: r.cognitive_level,
        human_edited: true,
      }));
      const { error } = await supabase.from("questions").upsert(payload, { onConflict: "paper_id,question_number" });
      if (error) fail(error, "Your changes could not be saved. Please try again.");
    },
    onSuccess: () => invalidate(projectId, paperId),
  });
}

export function useSetPaperStatus(projectId?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ paperId, status }: { paperId: string; status: "draft" | "ready" }) => {
      if (status === "ready") {
        const { data: paper, error: pErr } = await supabase
          .from("question_papers").select("total_questions").eq("id", paperId).single();
        if (pErr) fail(pErr);
        const { data: qs, error: qErr } = await supabase
          .from("questions").select("question_number, correct_answer, is_grace, skill_category").eq("paper_id", paperId);
        if (qErr) fail(qErr);
        const problems = readinessProblems(qs ?? [], paper!.total_questions);
        if (problems.length) throw new Error(problems.join(". "));
      }
      const { error } = await supabase.from("question_papers").update({ status }).eq("id", paperId);
      if (error) fail(error, "The paper status could not be changed. Please try again.");
    },
    onSuccess: (_d, v) => invalidate(projectId, v.paperId),
  });
}

export function useCopyPaperFromSlot(sourceId: string, targetId: string, opts: { replace: boolean }, projectId?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (override?: { replace?: boolean }) => {
      const replace = override?.replace ?? opts.replace;
      const count = async (id: string) => {
        const { count: c, error } = await supabase
          .from("questions").select("id", { count: "exact", head: true }).eq("paper_id", id);
        if (error) fail(error);
        return c ?? 0;
      };
      const [sc, tc] = await Promise.all([count(sourceId), count(targetId)]);
      const plan = copyPlan({ questionCount: sc }, { questionCount: tc }, replace);

      const { data: src, error: sErr } = await supabase
        .from("question_papers").select("pdf_r2_key, pdf_file_name").eq("id", sourceId).single();
      if (sErr) fail(sErr);
      const { data: rows, error: rErr } = await supabase
        .from("questions").select("*").eq("paper_id", sourceId);
      if (rErr) fail(rErr);

      if (plan.replaceExisting) {
        const { error } = await supabase.from("questions").delete().eq("paper_id", targetId);
        if (error) fail(error, "The old questions could not be cleared. Please try again.");
      }
      const copies = (rows ?? []).map(({ id: _id, paper_id: _p, updated_at: _u, updated_by: _b, ...rest }) => ({
        ...rest,
        paper_id: targetId,
      }));
      const { error: iErr } = await supabase.from("questions").insert(copies);
      if (iErr) fail(iErr, "The questions could not be copied. Please try again.");
      const { error: uErr } = await supabase
        .from("question_papers")
        .update({ pdf_r2_key: src!.pdf_r2_key, pdf_file_name: src!.pdf_file_name, status: "draft" })
        .eq("id", targetId);
      if (uErr) fail(uErr);
      return plan.count;
    },
    onSuccess: () => invalidate(projectId, targetId),
  });
}

export function useSoftDeletePaper(projectId?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (paperId: string) => {
      const { error } = await supabase
        .from("question_papers").update({ deleted_at: new Date().toISOString() }).eq("id", paperId);
      if (error) fail(error, "The paper could not be deleted. Please try again.");
    },
    onSuccess: () => invalidate(projectId),
  });
}
