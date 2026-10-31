import { describe, it, expect } from "vitest";
import {
  generateScoreSheet, generateSkillReport, generateSchoolSummary, generateSchoolRanking, generateAwardLetter,
  type StudentBlock,
} from "../pdf";

const student: StudentBlock = {
  name: "Aarav K S", regNo: "2-33-03-06-01-020", className: "Class 6",
  olympiad: "Maths Olympiad", schoolName: "St. Mary's Matriculation", examLabel: "Slot 1 - 13 Oct 2026",
};
const rk = { rank: 3, of: 41 };

async function pagesOf(b: Blob): Promise<number> {
  const text = Buffer.from(await b.arrayBuffer()).toString("latin1");
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}
function expectPdf(b: Blob) {
  expect(b).toBeInstanceOf(Blob);
  expect(b.type).toBe("application/pdf");
  expect(b.size).toBeGreaterThan(1000);
}

describe("pdf generators", () => {
  it("score sheet, 120 questions spans several pages", async () => {
    const questions = Array.from({ length: 120 }, (_, i) => ({
      number: i + 1, studentAnswer: i % 7 === 0 ? null : "B", correctAnswer: i % 11 === 0 ? "Grace" : "C",
      result: (["✓", "✗", "½"] as const)[i % 3], skill: "Logical Reasoning",
    }));
    const b = await generateScoreSheet({
      student, questions,
      score: { total: 84, max: 120, percentage: 70, ranks: { school: rk, district: rk, state: rk, allIndia: { rank: null, of: null } } },
    });
    expectPdf(b);
    expect(await pagesOf(b)).toBeGreaterThan(1);
  });

  it("skill report renders with and without feedback", async () => {
    const skills = [{ skill: "Algebra", correct: 4, total: 5, percentage: 80 }];
    const plain = await generateSkillReport({ student, skills });
    expectPdf(plain);
    const withFb = await generateSkillReport({
      student, skills,
      feedback: { overall: "Good effort overall.", strengths: [{ skill: "Algebra", feedback: "Solid." }], focus_areas: [{ skill: "Geometry", feedback: "Practise." }], tips: ["Revise daily"], goals: ["Reach 90%"] },
    });
    expectPdf(withFb);
    expect(withFb.size).toBeGreaterThan(plain.size);
  });

  it("school summary", async () => {
    expectPdf(await generateSchoolSummary({
      school: { name: "St. Mary's", city: "Madurai", state: "Tamil Nadu" },
      tiles: { enrolled: 100, evaluated: 90, absent: 10, averagePct: 62.5, stateAveragePct: 55 },
      rows: [{ className: "Class 6", olympiad: "Maths", enrolled: 50, evaluated: 45, averagePct: 60, stateAveragePct: null }],
      aiAnalysis: "Strong in maths.\nNeeds work in reasoning.",
    }));
  });

  it("school ranking, long table", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      name: `Student ${i}`, regNo: "2-33-03-06-01-020", className: "Class 6", olympiad: "Maths", score: "40 / 50",
      percentage: 80, grade: "A", schoolRank: i + 1, districtRank: 5, stateRank: null, allIndiaRank: 900,
    }));
    const b = await generateSchoolRanking({ school: { name: "St. Mary's" }, rows });
    expectPdf(b);
    expect(await pagesOf(b)).toBeGreaterThan(1);
  });

  it("award letter", async () => {
    expectPdf(await generateAwardLetter({
      school: { name: "St. Mary's", city: "Madurai" },
      awardees: [{ name: "Aarav", className: "Class 6", olympiad: "Maths", award: "Gold Medal" }],
    }));
  });
});
