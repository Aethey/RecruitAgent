import { formatMessage } from './generated/localizations.ts';
import { createHash, randomUUID } from "node:crypto";
import { AppError, object, statistics, text } from "./domain.ts";
import { publicInterview } from "./interview.ts";
import { librarySummary } from "./library.ts";
import { publicBatch } from "./study.ts";
import { Store } from "./store.ts";
import { publicTraining } from "./training.ts";

export type PageContext = {
  route: string; title: string; visibleText: string; selectedText: string;
  fields: { label: string; value: string }[]; editor?: string; pdfPage?: number;
  record?: string; capturedAt: string;
};
export type ChatTurn = {
  id: string; user: string; assistant: string; model: string; context: PageContext;
  status: "streaming" | "done" | "error" | "aborted"; error?: string;
  createdAt: string; updatedAt: string;
  teacher?: { trigger: "observe" | "check" | "question"; codeHash: string; revision: number };
};
export type ChatThread = { id: string; title: string; createdAt: string; updatedAt: string; turns: ChatTurn[]; mode?: "teacher"; problemId?: string };
const now = () => new Date().toISOString();
const excerpt = (value: string, max: number) => value.length <= max ? value : value.slice(0, max) + "\n[内容过长，后续已截取]";

export class Chat {
  private live = new Map<string, { turnId: string; assistant: string }>();
  constructor(private store: Store) {}
  async recover() {
    if (!this.store.snapshot().chats?.some(thread => thread.turns.some(turn => turn.status === "streaming"))) return;
    await this.store.update(state => {
      for (const thread of state.chats ?? []) for (const turn of thread.turns) if (turn.status === "streaming") {
        turn.status = "aborted"; turn.error = formatMessage('zh', "chat.restarted");
        turn.updatedAt = thread.updatedAt = now();
      }
    });
  }
  list() {
    return (this.store.snapshot().chats ?? []).filter(thread => thread.mode !== "teacher").map(({ turns, ...thread }) => ({
      ...thread, turnCount: turns.length, preview: turns.at(-1)?.user.slice(0, 100) ?? "",
      pageTitle: turns.at(-1)?.context.title ?? "", status: turns.at(-1)?.status,
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string) {
    const thread = this.store.snapshot().chats?.find(item => item.id === id);
    if (!thread) throw new AppError(404, formatMessage('zh', "ui.theConversationDoesNotExist"));
    const live = this.live.get(id), turn = live && thread.turns.find(item => item.id === live.turnId);
    if (turn && live) turn.assistant = live.assistant;
    return thread;
  }
  async create() {
    const thread: ChatThread = { id: randomUUID(), title: formatMessage('zh', "chat.defaultTitle"), createdAt: now(), updatedAt: now(), turns: [] };
    await this.store.update(state => { (state.chats ??= []).push(thread); });
    return thread;
  }
  async teacher(problemId: string) {
    const problem = this.store.problem(problemId);
    let id = "";
    await this.store.update(state => {
      let thread = state.chats?.find(thread => thread.mode === "teacher" && thread.problemId === problemId);
      if (!thread) {
        thread = { id: randomUUID(), mode: "teacher", problemId, title: problem.title, createdAt: now(), updatedAt: now(), turns: [] };
        (state.chats ??= []).push(thread);
      }
      id = thread.id;
    });
    return this.getTeacher(id);
  }
  getTeacher(id: string) {
    const thread = this.get(id);
    if (thread.mode !== "teacher" || !thread.problemId) throw new AppError(404, formatMessage('zh', "ui.theTeacherRecordDoesNotExist"));
    this.store.problem(thread.problemId);
    return thread;
  }
  prepareTeacher(id: string, value: unknown): ChatTurn {
    const thread = this.getTeacher(id), input = object(value), problem = this.store.problem(thread.problemId!);
    const turnId = text(input.id, 100);
    if (!/^[\w-]+$/.test(turnId)) throw new AppError(400, formatMessage('zh', "ui.invalidMessageNumber"));
    if (thread.turns.some(turn => turn.id === turnId)) throw new AppError(409, formatMessage('zh', "ui.thisTeacherRequestHasAlreadyBeenSent"));
    if (thread.turns.at(-1)?.status === "streaming") throw new AppError(409, formatMessage('zh', "ui.pleaseStopTheCurrentGuideFirst"));
    if (typeof input.code !== "string" || input.code.length > 100000) throw new AppError(400, formatMessage('zh', "ui.answerCodeFormatIsInvalidOrTooLong"));
    if (!["observe", "check", "question"].includes(input.trigger as string)) throw new AppError(400, formatMessage('zh', "ui.invalidTeacherRequestType"));
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new AppError(400, formatMessage('zh', "ui.invalidCodeVersion"));
    const trigger = input.trigger as NonNullable<ChatTurn["teacher"]>["trigger"];
    const codeHash = createHash("sha256").update(input.code).digest("hex");
    const last = thread.turns.at(-1);
    if (trigger === "observe" && last?.status === "done" && last.teacher?.codeHash === codeHash) throw new AppError(409, formatMessage('zh', "ui.theCurrentCodeAlreadyIncludesGuidanceContinueObserving"));
    const user = trigger === "question" ? text(input.message, 4000).trim() : "看看当前代码，给我下一步的思考提示。";
    if (!user) throw new AppError(400, formatMessage('zh', "ui.pleaseWriteTheFollowUpQuestion"));
    const context: PageContext = {
      route: `#practice/${problem.id}`, title: problem.title, visibleText: problem.description,
      selectedText: "", fields: [], editor: input.code, capturedAt: now(),
      record: JSON.stringify({ title: problem.title, language: problem.language, topic: problem.topic, difficulty: problem.difficulty, description: problem.description, examples: problem.examples, constraints: problem.constraints }),
    };
    return { id: turnId, user, assistant: "", model: "", context, teacher: { trigger, codeHash, revision: Number(input.revision) }, status: "streaming", createdAt: now(), updatedAt: now() };
  }
  teacherPrompt(id: string, turn: ChatTurn) {
    const previous = this.getTeacher(id).turns.filter(item => item.id !== turn.id).slice(-6).map(item => ({
      user: item.user, assistant: excerpt(item.assistant, 4000), status: item.status,
      code: excerpt(item.context.editor ?? "", 10000),
    }));
    return `这是同一道算法题的实时教学。历史引导（可能基于旧代码）：${JSON.stringify(previous)}\n最新一轮：${JSON.stringify({ user: turn.user, trigger: turn.teacher!.trigger, page: turn.context })}\n依据最新完整代码，只给一个当前最有帮助的思考方向。`;
  }
  async delete(id: string) {
    this.get(id);
    await this.store.update(state => { state.chats = state.chats?.filter(thread => thread.id !== id); });
  }
  context(value: unknown): PageContext {
    const input = object(value), route = text(input.route, 160);
    if (!/^#(?:practice|history|analysis|language|interview|library|training|study|breadth|entertainment|voice|settings)(?:\/[\w-]+)?$/.test(route)) throw new AppError(400, formatMessage('zh', "ui.thePageContextURLIsInvalid"));
    function optional(value: unknown, max: number) {
      if (value === undefined) return "";
      if (typeof value !== "string" || value.length > max) throw new AppError(400, formatMessage('zh', "ui.thePageContextIsTooLongOrHas"));
      return value;
    }
    if (!Array.isArray(input.fields) || input.fields.length > 50) throw new AppError(400, formatMessage('zh', "ui.thePageInputContextIsInvalid"));
    const fields = input.fields.map(value => {
      const field = object(value);
      return { label: text(field.label, 160), value: optional(field.value, 20000) };
    });
    if (fields.reduce((n, field) => n + field.value.length, 0) > 40000) throw new AppError(400, formatMessage('zh', "ui.thePageInputContextIsTooLong"));
    const context: PageContext = { route, title: text(input.title, 250),
      visibleText: optional(input.visibleText, 30000), selectedText: optional(input.selectedText, 6000),
      fields, capturedAt: now(), ...(input.editor === undefined ? {} : { editor: optional(input.editor, 100000) }),
    };
    if (input.pdfPage !== undefined) {
      if (!Number.isInteger(input.pdfPage) || Number(input.pdfPage) < 1 || Number(input.pdfPage) > 200) throw new AppError(400, formatMessage('zh', "ui.invalidPDFPageNumber"));
      context.pdfPage = Number(input.pdfPage);
    }
    // Rehydrate only the current record; never expose hidden references or unrelated personal data.
    const [page, id] = route.slice(1).split("/"), state = this.store.snapshot();
    let record: unknown;
    if (id) {
      if (page === "practice") record = this.store.problem(id);
      if (page === "language") {
        const drill = this.store.languageDrill(id);
        const { templateCode, exercises, ...rest } = drill;
        record = drill.revealedAt ? drill : { ...rest, exercises: exercises.map(({ explanation, benefits, pitfalls, ...exercise }) => exercise) };
      }
      if (page === "interview") record = publicInterview(this.store.interview(id));
      if (page === "training") record = publicTraining(this.store.training(id));
      if (page === "study" || page === "breadth") {
        const batch = state.studyBatches?.find(item => item.id === id);
        if (!batch) throw new AppError(404, formatMessage('zh', "ui.quickQuizNotFound"));
        record = publicBatch(batch);
      }
      if (page === "library") {
        const item = state.library?.find(item => item.id === id);
        if (!item) throw new AppError(404, formatMessage('zh', "ui.materialNotFound"));
        const page = context.pdfPage && item.pages?.find(page => page.number === context.pdfPage);
        record = { ...librarySummary(item), extractedText: excerpt(page ? page.text : item.extractedText, 45000) };
      }
    } else if (page === "analysis") record = { analysis: state.analysis, stats: statistics(state.problems) };
    if (record) context.record = excerpt(JSON.stringify(record), 65000);
    return context;
  }
  prepare(id: string, value: unknown, retry = false) {
    const thread = this.get(id), input = object(value);
    if (thread.mode === "teacher") throw new AppError(400, formatMessage('zh', "ui.pleaseUseTheRealTimeTeacherEntryPoint"));
    if (retry) {
      const turn = thread.turns.at(-1);
      if (!turn || turn.id !== input.turnId || !["error", "aborted"].includes(turn.status)) throw new AppError(400, formatMessage('zh', "ui.youCanOnlyRetryTheLastFailedOr"));
      return { ...turn, assistant: "", status: "streaming" as const, error: undefined, updatedAt: now() };
    }
    const turnId = text(input.id, 100);
    if (!/^[\w-]+$/.test(turnId)) throw new AppError(400, formatMessage('zh', "ui.invalidMessageNumber"));
    if (thread.turns.some(turn => turn.id === turnId)) throw new AppError(409, formatMessage('zh', "ui.thisMessageHasAlreadyBeenSentPleaseRefresh"));
    if (thread.turns.at(-1)?.status === "streaming") throw new AppError(409, formatMessage('zh', "ui.pleaseWaitForOrStopTheCurrentReply"));
    return { id: turnId, user: text(input.message, 20000).trim(), assistant: "", model: "",
      context: this.context(input.context), status: "streaming" as const, createdAt: now(), updatedAt: now() };
  }
  prompt(id: string, turn: ChatTurn) {
    const previous = this.get(id).turns.filter(item => item.id !== turn.id);
    // Keep all dialogue; earlier page excerpts are bounded, while the latest context stays complete.
    const history = previous.map(item => ({ user: item.user, assistant: item.assistant,
      status: item.status, page: { ...item.context, visibleText: excerpt(item.context.visibleText, 4000),
        record: item.context.record ? excerpt(item.context.record, 8000) : undefined, editor: item.context.editor ? excerpt(item.context.editor, 8000) : undefined },
    }));
    const prompt = `以下是连续对话历史（较早页面的长内容可能截取）：${JSON.stringify(history)}\n最新一轮：${JSON.stringify({ user: turn.user, page: turn.context })}\n直接回答最新一轮问题，使用 Markdown。`;
    if (prompt.length > 350000) throw new AppError(400, formatMessage('zh', "ui.thisConversationIsVeryLongPleaseCreateA"));
    return prompt;
  }
  async begin(id: string, turn: ChatTurn, retry: boolean) {
    await this.store.update(state => {
      const thread = state.chats!.find(thread => thread.id === id)!;
      if (retry) thread.turns[thread.turns.length - 1] = turn;
      else thread.turns.push(turn);
      if (thread.turns.length === 1 && thread.mode !== "teacher") thread.title = turn.user.slice(0, 44);
      thread.updatedAt = now();
    });
    this.live.set(id, { turnId: turn.id, assistant: "" });
  }
  stream(id: string, turnId: string, assistant: string) { this.live.set(id, { turnId, assistant }); }
  async save(id: string, turnId: string, patch: Partial<ChatTurn>) {
    await this.store.update(state => {
      const thread = state.chats?.find(thread => thread.id === id), turn = thread?.turns.find(turn => turn.id === turnId);
      if (!thread || !turn) return;
      if (thread.mode === "teacher" && patch.status === "done" && turn.status !== "done") {
        const problem = state.problems.find(problem => problem.id === thread.problemId);
        if (problem) problem.teacherHints = (problem.teacherHints ?? 0) + 1;
      }
      Object.assign(turn, patch); turn.updatedAt = thread.updatedAt = now();
    });
    if (patch.status && patch.status !== "streaming") this.live.delete(id);
  }
}
