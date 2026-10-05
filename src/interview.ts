import { AppError, object, text } from "./domain.ts";
import type { VoiceSettings } from "./voice-options.ts";
import type { Locale } from "./locales.ts";

export const INTERVIEW_TYPES = { common: "共通 · 经验与表达", technical: "共通技术 · 简历深挖", position: "职位定制 · 简历 × JD" } as const;
export const INTERVIEW_TOPICS = {
  common: { all: "综合轮练", introduction: "自我介绍与优势", success: "成功、成就感与结果", failure: "失败、压力与复盘", teamwork: "协作、沟通与分歧", learning: "学习、主动性与担当外", career: "职业方向与动机" },
  technical: { all: "综合轮练", architecture: "架构、BLoC 与状态建模", mobile: "移动端与生命周期", language: "语言、并发与异步", sdk: "SDK、原生与 BLE", quality: "测试、性能与安全", api: "API、存储与可靠性", ai: "AI、RAG 与自动化", delivery: "重构、取舍与交付" },
  position: { all: "按完整 JD 综合出题", motivation: "公司动机与岗位匹配", requirements: "必须条件与技术追问", scenarios: "岗位情境与取舍" },
} as const;
export type InterviewType = keyof typeof INTERVIEW_TYPES;
export type InterviewSelection = { type: InterviewType; topic: string; count: number; jobId?: string };
export type Source = { id: string; title: string; kind: "resume" | "personal" | "study" | "job"; content: string };
export type JobSource = Source & { url?: string; fetchedAt: string };
export type InterviewJob = { id: string; title: string; createdAt: string; sources: JobSource[]; warnings: string[] };
export type Question = { id: string; question: string; kind: "behavioral" | "technical" | "motivation"; focus: string; tips?: string[]; keywords: string[]; answerBasis: "experience" | "knowledge" | "needs-detail"; evidenceNote: string; sourceIds: string[] };
export type InterviewContent = { title: string; introduction: string; questions: Question[] };
export type AnswerReview = { questionId: string; assessment: "clear" | "needs-focus" | "needs-evidence"; summary: string;
  dimensions: { relevance: string; conciseness: string; structure: string; evidence: string }; strengths: string[]; gaps: string[]; cuts: string[]; improvedKeywords: string[]; followUp: string };
export type InterviewReviewContent = { summary: string; items: AnswerReview[] };
export type InterviewReview = InterviewReviewContent & { id: string; at: string; answers: Record<string, string> };
export type VoiceInterviewRound = { questionId: string; question: string; tipsShown: boolean; answer: string; feedback: string; at: string; completedAt?: string };
export type VoiceInterviewAttempt = { id: string; at: string; endedAt?: string; synthetic?: boolean; settings: Omit<VoiceSettings, 'language'> & { language?: Locale }; status: "active" | "completed" | "stopped" | "failed" | "interrupted"; rounds: VoiceInterviewRound[] };
export type VoiceQuestion = { id: string; question: string; tips: string[] };
export type VoiceContent = { language: Locale; basis: string; questions: VoiceQuestion[] };
export type InterviewSet = InterviewSelection & InterviewContent & { id: string; createdAt: string; updatedAt: string; jobTitle?: string; language?: Locale; answers: Record<string, string>; reviews: InterviewReview[]; sources: Source[]; voiceSettings?: Omit<VoiceSettings, 'language'> & { language?: Locale }; voiceAttempts?: VoiceInterviewAttempt[]; voiceContents?: Partial<Record<Locale,VoiceContent>> };

export function interviewSelection(value: unknown): InterviewSelection {
  const v = object(value);
  if (typeof v.type !== "string" || !Object.hasOwn(INTERVIEW_TYPES, v.type)) throw new AppError(400, "请选择面试练习类型。");
  const type = v.type as InterviewType;
  if (typeof v.topic !== "string" || !Object.hasOwn(INTERVIEW_TOPICS[type], v.topic) || ![3, 5, 8].includes(v.count as number)) throw new AppError(400, "请选择有效的练习方向和题数。");
  const jobId = v.jobId === undefined || v.jobId === "" ? undefined : text(v.jobId, 100);
  if (type === "position" && !jobId) throw new AppError(400, "请先保存并选择职位资料。");
  return { type, topic: v.topic, count: v.count as number, ...(jobId ? { jobId } : {}) };
}
export function jobInput(value: unknown) {
  const v = object(value), title = text(v.title, 150).trim();
  const description = v.description === undefined ? "" : typeof v.description === "string" && v.description.length <= 60000 ? v.description.trim() : null;
  if (description === null || !Array.isArray(v.urls) || v.urls.length > 5) throw new AppError(400, "JD 最多 60,000 字符，最多 5 个链接。");
  const urls = [...new Set(v.urls.map(u => text(u, 2000).trim()))];
  if (!description && !urls.length) throw new AppError(400, "请粘贴职位原文或输入职位链接。");
  return { title, description, urls };
}
function strings(value: unknown, min: number, max: number, length: number) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AppError(400, "面试要点格式不正确。");
  return value.map(s => text(s, length).trim());
}
export function interviewContent(value: unknown, count: number, sources: Source[], type?: InterviewType): InterviewContent {
  const v = object(value), sourceIds = new Set(sources.map(s => s.id));
  if (!Array.isArray(v.questions) || v.questions.length !== count) throw new AppError(400, "面试题数量不正确。");
  const questions = v.questions.map((value, i) => {
    const q = object(value);
    if (!["behavioral", "technical", "motivation"].includes(q.kind as string) || !["experience", "knowledge", "needs-detail"].includes(q.answerBasis as string)) throw new AppError(400, "题目依据不正确。");
    if (type === "common" && q.kind === "technical") throw new AppError(400, "共通练习混入技术题，请重新生成。");
    if (type === "technical" && q.kind !== "technical") throw new AppError(400, "共通技术练习包含非技术题，请重新生成。");
    const refs = strings(q.sourceIds, 1, 6, 150);
    if (refs.some(id => !sourceIds.has(id))) throw new AppError(400, "题目引用了不存在的资料。");
    if (type === "position" && !refs.some(id => sources.find(s => s.id === id)!.kind === "job")) throw new AppError(400, "职位题缺少当前 JD 依据，请重新生成。");
    if (q.answerBasis === "experience" && !refs.some(id => ["resume", "personal"].includes(sources.find(s => s.id === id)!.kind))) throw new AppError(400, "经历答案缺少履历或本人陈述依据。");
    return { id: `q${i + 1}`, question: text(q.question, 400), kind: q.kind as Question["kind"], focus: text(q.focus, 200),
      ...(q.tips === undefined ? {} : { tips: strings(q.tips, 1, 3, 100) }),
      keywords: strings(q.keywords, 3, 5, 80), answerBasis: q.answerBasis as Question["answerBasis"], evidenceNote: text(q.evidenceNote, 240), sourceIds: refs };
  });
  return { title: text(v.title, 150), introduction: text(v.introduction, 400), questions };
}
export function interviewAnswers(value: unknown, set: InterviewSet, requireAnswer = false) {
  const v = object(object(value).answers), valid = new Set(set.questions.map(q => q.id));
  const answers: Record<string, string> = {};
  for (const [id, answer] of Object.entries(v)) {
    if (!valid.has(id) || typeof answer !== "string" || answer.length > 10000) throw new AppError(400, "回答编号无效或回答超过 10,000 字符。");
    if (!requireAnswer || answer.trim()) answers[id] = answer;
  }
  if (requireAnswer && !Object.keys(answers).length) throw new AppError(400, "请先写至少一道题的回答。");
  return answers;
}
export function interviewReviewContent(value: unknown, ids: string[]): InterviewReviewContent {
  const v = object(value);
  if (!Array.isArray(v.items) || v.items.length !== ids.length) throw new AppError(400, "评价范围不正确。");
  const seen = new Set<string>();
  const items = v.items.map(value => {
    const r = object(value), questionId = text(r.questionId, 100), d = object(r.dimensions);
    if (!ids.includes(questionId) || seen.has(questionId) || !["clear", "needs-focus", "needs-evidence"].includes(r.assessment as string)) throw new AppError(400, "评价题号不正确。");
    seen.add(questionId);
    return { questionId, assessment: r.assessment as AnswerReview["assessment"], summary: text(r.summary, 300),
      dimensions: { relevance: text(d.relevance, 180), conciseness: text(d.conciseness, 180), structure: text(d.structure, 180), evidence: text(d.evidence, 180) },
      strengths: strings(r.strengths, 0, 3, 200), gaps: strings(r.gaps, 0, 3, 200), cuts: strings(r.cuts, 0, 3, 200),
      improvedKeywords: strings(r.improvedKeywords, 3, 5, 80), followUp: text(r.followUp, 240) };
  });
  return { summary: text(v.summary, 400), items };
}
export function publicInterview(set: InterviewSet) {
  return { ...set, sources: set.sources.map(({ content: _, ...source }) => source) };
}
