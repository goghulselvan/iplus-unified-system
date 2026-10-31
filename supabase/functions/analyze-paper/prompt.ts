import { COGNITIVE_LEVELS } from "./parse.ts";

export type ClassGroup = "lkg_ukg" | "class_1_2" | "class_3_5" | "class_6_8";

export function classGroupOf(classCode: string): ClassGroup | null {
  if (classCode === "14" || classCode === "15") return "lkg_ukg";
  if (classCode === "01" || classCode === "02") return "class_1_2";
  if (["03", "04", "05"].includes(classCode)) return "class_3_5";
  if (["06", "07", "08"].includes(classCode)) return "class_6_8";
  return null;
}

export function classDisplayName(classCode: string): string {
  if (classCode === "14") return "LKG";
  if (classCode === "15") return "UKG";
  return `Class ${parseInt(classCode, 10)}`;
}

export const OLYMPIAD_NAMES: Record<string, string> = {
  EPO: "English",
  MPO: "Maths",
  SPO: "Science",
  GKSSPO: "GK & Social Studies",
  LRPO: "Logical Reasoning",
  KidsPO: "Kids",
};

export interface RequestInput {
  pdfBase64: string;
  className: string;
  olympiadCode: string;
  allowedSkills: string[];
  from: number;
  to: number;
}

export function buildRequestBody(i: RequestInput): Record<string, unknown> {
  const olympiad = `${OLYMPIAD_NAMES[i.olympiadCode] ?? i.olympiadCode} Olympiad (${i.olympiadCode})`;
  const system = [
    `You read question papers for the iPlus ${olympiad}, paper for ${i.className}.`,
    `Extract ONLY questions ${i.from} to ${i.to}, using the question numbers printed on the paper.`,
    `Rules:`,
    `- Copy the question text faithfully. You may summarise a long reading passage.`,
    `- Set has_figure to true when the question depends on a picture or diagram.`,
    `- Choose correct_answer by actually solving the question. If no option is correct, or the question cannot be answered, return null.`,
    `- confidence is a number from 0 to 1: your honest certainty that the answer is right.`,
    `- Never invent questions. Return one entry for each of questions ${i.from} to ${i.to}.`,
    `- skill_category must be exactly one of: ${i.allowedSkills.join("; ")}.`,
    `- skill_description is one short sentence on what the question tests.`,
    `- cognitive_level must be exactly one of: ${COGNITIVE_LEVELS.join(", ")}.`,
  ].join("\n");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "question_number", "question_text", "has_figure", "correct_answer",
            "skill_category", "skill_description", "cognitive_level", "confidence",
          ],
          properties: {
            question_number: { type: "integer" },
            question_text: { type: "string" },
            has_figure: { type: "boolean" },
            correct_answer: { anyOf: [{ type: "string", enum: ["A", "B", "C", "D"] }, { type: "null" }] },
            skill_category: { type: "string", enum: i.allowedSkills },
            skill_description: { type: "string" },
            cognitive_level: { type: "string", enum: [...COGNITIVE_LEVELS] },
            confidence: { type: "number" },
          },
        },
      },
    },
  };

  return {
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    system,
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: i.pdfBase64 },
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: `Extract questions ${i.from} to ${i.to} from this paper.` },
      ],
    }],
  };
}
