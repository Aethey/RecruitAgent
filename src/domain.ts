import type { Locale } from "./locales.ts";
import type { ModelOutputs } from './contracts.ts';
import { modelValue } from './contract-validation.ts';
export const TOPICS = {
  array: "数组", string: "字符串", hash: "哈希表", "two-pointers": "双指针 / 滑动窗口",
  stack: "栈与队列", "linked-list": "链表", tree: "树", graph: "图",
  "binary-search": "二分查找", dp: "动态规划",
} as const;
export const DIFFICULTIES = { easy: "简单", medium: "中等", hard: "困难" } as const;
import type { LanguageDrill } from "./language.ts";
import type { InterviewJob, InterviewSet } from "./interview.ts";
import type { LibraryItem } from "./library.ts";
import type { KnowledgePoint, Card, StudyBatch } from "./study.ts";
import type { Training } from "./training.ts";
import type { ChatThread } from "./chat.ts";

export const LANGUAGES = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", java: "Java", kotlin: "Kotlin", dart: "Dart", swift: "Swift", go: "Go" } as const;
export type Topic = keyof typeof TOPICS;
export type Difficulty = keyof typeof DIFFICULTIES;
export type Language = keyof typeof LANGUAGES;
export type Selection = { topic: Topic; difficulty: Difficulty; language: Language };
export type ProblemContent = {
  title: string; description: string;
  examples: { input: string; output: string; explanation: string }[];
  constraints: string[]; starterCode: string;
};
export type Hint = { id: string; at: string; codeHash: string; observation: string; question: string; checkpoint: string };
export type ReviewContent = {
  verdict: "needs-work" | "promising" | "solid";
  score: number;
  dimensions: { correctness: number; complexity: number; edgeCases: number; clarity: number };
  summary: string; strengths: string[]; gaps: string[]; nextSteps: string[];
};
export type Review = ReviewContent & { id: string; at: string; code: string; hintsUsed: number };
export type Problem = Selection & ProblemContent & {
  id: string; createdAt: string; updatedAt: string; code: string; hints: Hint[]; reviews: Review[]; teacherHints?: number;
};
export type AnalysisContent = { summary: string; strengths: string[]; gaps: string[]; nextSteps: string[] };
export type Analysis = AnalysisContent & { at: string; basis: string; reviewedProblems: number };
export type TeacherSettings = { trigger: "idle" | "manual"; idleSeconds: number };
export const DEFAULT_TEACHER_SETTINGS: TeacherSettings = { trigger: "idle", idleSeconds: 20 };
export function teacherSettings(value: unknown): TeacherSettings {
  const input = object(value);
  if (input.trigger !== "idle" && input.trigger !== "manual") throw new AppError(400, "请选择有效的教师分析方式。");
  if (!Number.isInteger(input.idleSeconds) || Number(input.idleSeconds) < 1 || Number(input.idleSeconds) > 3600) throw new AppError(400, "停止输入等待时长须为 1–3600 秒的整数。");
  return { trigger: input.trigger, idleSeconds: Number(input.idleSeconds) };
}
export type InterviewMaterials = { resume: string[]; personal: string[]; study: string[] };
export type State = { interviewMaterials?: InterviewMaterials; version: 1; problems: Problem[]; languageDrills?: LanguageDrill[]; interviewJobs?: InterviewJob[]; interviews?: InterviewSet[]; library?: LibraryItem[]; trainings?: Training[]; studyPoints?: KnowledgePoint[]; studyCards?: Card[]; studyBatches?: StudyBatch[]; chats?: ChatThread[]; analysis?: Analysis; settings?: { model: string; visibleModels?: string[]; teacher?: TeacherSettings; uiLanguage?: Locale; userLanguage?: Locale } };
export const REVIEW_LABEL = "AI 静态代码评估，未执行代码或测试；分数是学习参考。";

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "数据格式不正确。");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 20000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError(400, "文本为空或过长。");
  return value;
}
function texts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new AppError(400, "列表格式不正确。");
  return value.map(v => text(v, 6000));
}
function score(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new AppError(400, "评分格式不正确。");
  return Math.round(value);
}
export function selection(value: unknown): Selection {
  const v = object(value);
  if (typeof v.topic !== "string" || !Object.hasOwn(TOPICS, v.topic) ||
      typeof v.difficulty !== "string" || !Object.hasOwn(DIFFICULTIES, v.difficulty) ||
      typeof v.language !== "string" || !Object.hasOwn(LANGUAGES, v.language)) throw new AppError(400, "请选择有效的题型、难度和语言。");
  return { topic: v.topic as Topic, difficulty: v.difficulty as Difficulty, language: v.language as Language };
}
export function codeInput(value: unknown): string {
  const code = object(value).code;
  if (typeof code !== "string" || code.length > 100000) throw new AppError(400, "代码不能超过 100,000 字符。");
  return code;
}
export function parseModelJson<K extends keyof ModelOutputs, T>(raw: string, kind: K, validate: (value: ModelOutputs[K]) => T): T {
  try {
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return validate(modelValue(kind, JSON.parse(clean)));
  } catch {
    throw new AppError(502, "Codex 返回的结构不完整，请重试。本次未写入结果。");
  }
}
export function problemContent(value: unknown): ProblemContent {
  const v = object(value);
  if (!Array.isArray(v.examples) || v.examples.length < 1 || v.examples.length > 6) throw new AppError(400, "例子格式不正确。");
  return {
    title: text(v.title, 150), description: text(v.description), starterCode: text(v.starterCode),
    constraints: texts(v.constraints),
    examples: v.examples.map(e => {
      const ex = object(e);
      return { input: text(ex.input, 6000), output: text(ex.output, 6000), explanation: text(ex.explanation, 6000) };
    }),
  };
}
export function hintContent(value: unknown): Pick<Hint, "observation" | "question" | "checkpoint"> {
  const v = object(value);
  return { observation: text(v.observation, 3000), question: text(v.question, 3000), checkpoint: text(v.checkpoint, 3000) };
}
export function reviewContent(value: unknown): ReviewContent {
  const v = object(value), d = object(v.dimensions);
  if (v.verdict !== "needs-work" && v.verdict !== "promising" && v.verdict !== "solid") throw new AppError(400, "评估格式不正确。");
  return {
    verdict: v.verdict, score: score(v.score), summary: text(v.summary, 6000),
    dimensions: { correctness: score(d.correctness), complexity: score(d.complexity), edgeCases: score(d.edgeCases), clarity: score(d.clarity) },
    strengths: texts(v.strengths), gaps: texts(v.gaps), nextSteps: texts(v.nextSteps),
  };
}
export function analysisContent(value: unknown): AnalysisContent {
  const v = object(value);
  return { summary: text(v.summary, 6000), strengths: texts(v.strengths), gaps: texts(v.gaps), nextSteps: texts(v.nextSteps) };
}
export function hintCount(problem: Problem) { return problem.hints.length + (problem.teacherHints ?? 0); }
export function evidenceBasis(problems: Problem[]): string {
  return JSON.stringify(problems.filter(p => p.reviews.length).map(p => [p.id, p.reviews.at(-1)!.id, hintCount(p)]).sort());
}
export function statistics(problems: Problem[]) {
  const reviewed = problems.filter(p => p.reviews.length);
  const topics = Object.entries(TOPICS).map(([id, label]) => {
    const samples = reviewed.filter(p => p.topic === id);
    return { id, label, count: samples.length,
      score: samples.length ? Math.round(samples.reduce((n, p) => n + p.reviews.at(-1)!.score, 0) / samples.length) : null,
      hints: samples.reduce((n, p) => n + p.reviews.at(-1)!.hintsUsed, 0),
    };
  });
  return { total: problems.length, reviewed: reviewed.length,
    solid: reviewed.filter(p => p.reviews.at(-1)!.verdict === "solid").length,
    hints: problems.reduce((n, p) => n + hintCount(p), 0),
    average: reviewed.length ? Math.round(reviewed.reduce((n, p) => n + p.reviews.at(-1)!.score, 0) / reviewed.length) : null,
    topics,
  };
}
