import { translateSource } from "./ui-messages.ts";
import type { Locale } from "./locales.ts";
import { createHash, randomUUID } from 'node:crypto';
import { AppError, LANGUAGES, TOPICS, object, text, type Language, type State } from './domain.ts';
import { LANGUAGE_SYLLABUS } from './language.ts';
import { Store } from './store.ts';
import { BREADTH_DOMAINS, BREADTH_GROUPS, BREADTH_POINTS, type BreadthScope } from './breadth.ts';

export const STUDY_CATEGORIES = { algorithm: '算法知识', language: '语言写法', concept: '概念与方法', tools: '工程工具与 CLI', expression: '重点表达' } as const;
export const STUDY_FACETS = { recall: '理解与记忆', write: '写法与命令', apply: '场景应用', explain: '简洁表达' } as const;
export type Category = keyof typeof STUDY_CATEGORIES;
export type Facet = keyof typeof STUDY_FACETS;
export type SourceRef = { kind: 'library' | 'problem' | 'language' | 'training'; id: string; title: string };
export type KnowledgePoint = { id: string; title: string; category: Category; topic: string; language?: Language; description: string; facets: Facet[]; source?: SourceRef; createdAt?: string; breadth?: { domain: Exclude<BreadthScope['domain'],'all'>; group: Exclude<BreadthScope['group'],'all'> }; references?: {title:string;url:string}[] };
export type Schedule = { dueAt: string; lastAt?: string; intervalDays: number; stage: number; ease: number; independentStreak: number; reviews: number; lapses: number };
export type Card = { id: string; pointId: string; facet: Facet; schedule: Schedule };
export type Reference = { keywords: string[]; explanation: string; code: string; requirements: string[] };
export type QuizItem = { id: string; cardId: string; pointId: string; title: string; category: Category; facet: Facet; language?: Language; prompt: string; starterCode: string; reference: Reference; source?: SourceRef; references?: KnowledgePoint['references']; revealedAt?: string; skippedAt?: string; feedback?: Feedback };
export type Feedback = { at: string; model: string; answer: string; verdict: 'correct' | 'partial' | 'incorrect'; summary: string; gaps: string[]; assisted: boolean; rating: 'again' | 'hard' | 'good'; schedule: Schedule };
export type StudyBatch = { id: string; createdAt: string; title: string; model: string; selection: StudySelection; items: QuizItem[]; drafts: Record<string, string> };
export type StudySelection = { category: Category | 'all'; language: Language; count: number; facet: Facet | 'auto'; pointId?: string; weakOnly: boolean; breadth?: BreadthScope };
export type Slot = { point: KnowledgePoint; facet: Facet; cardId: string; reason: 'due' | 'weak' | 'new' | 'selected' };
const DAY = 86400000;
const STEPS = [1, 3, 7, 14, 30];
const idFor = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 20);
export const cardId = (pointId: string, facet: Facet) => `${pointId}:${facet}`;
export function initialSchedule(at: Date): Schedule { return { dueAt: at.toISOString(), intervalDays: 0, stage: 0, ease: 2, independentStreak: 0, reviews: 0, lapses: 0 }; }
// An adaptive interval ladder. This is a review estimate, not a measured forgetting probability.
export function advanceSchedule(previous: Schedule, verdict: Feedback['verdict'], assisted: boolean, at: Date): { rating: Feedback['rating']; schedule: Schedule } {
  const rating = assisted || verdict === 'incorrect' ? 'again' : verdict === 'partial' ? 'hard' : 'good';
  const next = { ...previous, reviews: previous.reviews + 1, lastAt: at.toISOString() };
  if (rating === 'again') {
    Object.assign(next, { dueAt: new Date(at.getTime() + 600000).toISOString(), intervalDays: 0, stage: 0, ease: Math.max(1.3, previous.ease - .2), independentStreak: 0, lapses: previous.lapses + 1 });
  } else if (rating === 'hard') {
    const days = Math.max(1, Math.min(3, Math.round(previous.intervalDays * .6)));
    Object.assign(next, { dueAt: new Date(at.getTime() + days * DAY).toISOString(), intervalDays: days, stage: Math.max(0, previous.stage - 1), ease: Math.max(1.3, previous.ease - .15), independentStreak: 0 });
  } else {
    const days = previous.stage < STEPS.length ? STEPS[previous.stage] : Math.min(180, Math.max(31, Math.round(previous.intervalDays * previous.ease)));
    Object.assign(next, { dueAt: new Date(at.getTime() + days * DAY).toISOString(), intervalDays: days, stage: previous.stage + 1, ease: Math.min(2.6, previous.ease + .05), independentStreak: previous.independentStreak + 1 });
  }
  return { rating, schedule: next };
}
function makePoint(category: Category, topic: string, title: string, facets: Facet[], language?: Language): KnowledgePoint {
  return { id: `builtin-${idFor([category, topic, title, language ?? ''].join('|'))}`, title, category, topic, facets, ...(language ? { language } : {}), description: '以简短解释、写法或小场景检查这个知识点。' };
}
const algorithmConcepts: Record<string, string[]> = {
  array: ['索引与空数组边界', '前缀和与区间计算', '局部状态与全局结果', '时间和空间复杂度'],
  string: ['字符与编码边界', '字符串遍历与计数', '子串与子序列', '字符串拼接复杂度'],
  hash: ['哈希表与键相等规则', '计数与查重', '碰撞与平均复杂度', 'Map 和 Set 的选用'],
  'two-pointers': ['双指针的不变量', '快慢指针', '滑动窗口的扩张与收缩', '单调条件与窗口适用边界'],
  stack: ['栈与队列的操作语义', '括号匹配', '单调栈', '队列与广度优先遍历'],
  'linked-list': ['链表指针修改顺序', '虚拟头节点', '链表反转', '环与快慢指针'],
  tree: ['递归的终止条件', '树的前中后序遍历', '二叉搜索树的不变量', '树的层序遍历'],
  graph: ['邻接表与访问标记', 'DFS 与 BFS 的选用', '环检测与拓扑排序', '最短路径的权重条件'],
  'binary-search': ['二分查找的区间定义', '终止条件与中点更新', 'lower_bound 与 upper_bound', '答案空间与单调判定'],
  dp: ['状态定义', '状态转移与依赖顺序', '初始化和边界', '滚动数组的适用条件'],
};
export const BUILTIN_POINTS: KnowledgePoint[] = [
  ...Object.entries(algorithmConcepts).flatMap(([topic, titles]) => titles.map(title => makePoint('algorithm', TOPICS[topic as keyof typeof TOPICS], title, ['recall', 'apply', 'explain']))),
  ...Object.entries(LANGUAGE_SYLLABUS).flatMap(([language, topics]) => Object.values(topics).flatMap(topic => topic.concepts.map(title => makePoint('language', topic.label, title, ['write', 'recall', 'apply', 'explain'], language as Language)))),
  ...['DI 与构造函数注入', 'IoC 与依赖倒置', 'DDD 与领域边界', '实体与值对象', '聚合与不变量', 'Repository 的责任边界', 'TDD 的反馈循环', '单元测试与集成测试', 'Mock、Stub 与 Fake', 'Kanban 与在制品限制', 'Scrum 与迭代', 'SOLID 的适用边界', '组合与继承', 'MVC、MVP 与 MVVM', '状态机与状态建模', 'BLoC 的事件和状态', '幂等与重试', '缓存与一致性', '并发、竞态与取消', 'CI/CD 与发布流程', '可观测性：日志、指标与追踪'].map(title => makePoint('concept', '概念与工程方法', title, ['recall', 'apply', 'explain'])),
  ...['Git：status、diff 与 log', 'Git：分支、提交与合并', 'Git：revert 与 reset 的影响', 'ADB：设备、安装与日志', 'ADB 与 logcat 的筛选', 'Gradle：构建与测试任务', 'Flutter：analyze、test 与 build', 'Dart：format、analyze 与 test', 'Swift：build 与 test', 'Xcode：xcodebuild 与模拟器', 'Python：venv 与模块执行', 'Go：test、fmt 与 vet', 'Java：javac、java 与构建工具', 'CLI：管道、退出码与环境变量', 'Android Crash 堆栈与混淆 mapping', 'Android ANR 与线程阻塞', 'iOS Crash 与 dSYM 符号化', 'Flutter 异常与原生 Crash', 'Crashlytics 的用途与定位流程', 'Datadog 的移动端监控与诊断', 'Sentry 的错误跟踪与上下文', 'Android Studio Profiler 的排查方向', 'Instruments 的排查方向', '线上故障：版本、设备与复现上下文'].map(title => makePoint('tools', 'CLI 与移动端故障工具', title, ['recall', 'apply', 'explain', ...(title.includes('：') && !title.startsWith('线上') ? ['write' as Facet] : [])])),
  ...['结论先行：说明一次技术决策', '三个要点：本人行动与结果', '简短解释一个技术名词', '解释两种方案的取舍', '清楚区分事实、推测与未知', '用简短日语说明验证方法', '将复杂项目背景压缩到重点'].map(title => makePoint('expression', '简洁的技术表达', title, ['explain', 'apply'])),
  ...BREADTH_POINTS,
];
const strings = (value: unknown, min: number, max: number, length: number): string[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AppError(400, '要点数量不正确。');
  return value.map(v => text(v, length).trim());
};
const optional = (value: unknown, max: number) => { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > max) throw new AppError(400, '文本过长或无效。'); return value; };
export function studySelection(value: unknown): StudySelection {
  const v = object(value), category = v.category ?? 'all', language = v.language ?? 'dart', facet = v.facet ?? 'auto';
  if (category !== 'all' && !Object.hasOwn(STUDY_CATEGORIES, category as string) || !Object.hasOwn(LANGUAGES, language as string) || facet !== 'auto' && !Object.hasOwn(STUDY_FACETS, facet as string) || ![3, 5, 8].includes(v.count as number)) throw new AppError(400, '请选择短测类别、语言、维度和3/5/8题。');
  if (v.weakOnly !== undefined && typeof v.weakOnly !== 'boolean') throw new AppError(400, '薄弱点筛选无效。');
  let breadth: BreadthScope | undefined;
  if (v.breadth !== undefined) {
    const scope = object(v.breadth), domain = scope.domain ?? 'all', group = scope.group ?? 'all';
    if ((domain !== 'all' && !Object.hasOwn(BREADTH_DOMAINS, domain as string)) || (group !== 'all' && !Object.hasOwn(BREADTH_GROUPS, group as string))) throw new AppError(400, '请选择有效的技术领域与知识方向。');
    breadth = { domain: domain as BreadthScope['domain'], group: group as BreadthScope['group'] };
  }
  return { category: category as StudySelection['category'], language: language as Language, facet: facet as StudySelection['facet'], count: v.count as number, ...(v.pointId ? { pointId: text(v.pointId, 100) } : {}), weakOnly: v.weakOnly === true, ...(breadth ? { breadth } : {}) };
}
export function customPoint(value: unknown, source?: SourceRef): KnowledgePoint {
  const v = object(value); if (!Object.hasOwn(STUDY_CATEGORIES, v.category as string)) throw new AppError(400, '知识点类别无效。');
  const category = v.category as Category, facets = strings(v.facets, 1, 4, 20) as Facet[];
  if (new Set(facets).size !== facets.length || facets.some(f => !Object.hasOwn(STUDY_FACETS, f))) throw new AppError(400, '请选择有效的测试维度。');
  if (v.language !== undefined && !Object.hasOwn(LANGUAGES, v.language as string) || category === 'language' && !v.language) throw new AppError(400, '语言知识点需要指定语言。');
  return { id: randomUUID(), title: text(v.title, 150).trim(), category, topic: text(v.topic ?? '自定义知识', 100).trim(), description: optional(v.description, 2000), facets, ...(v.language ? { language: v.language as Language } : {}), ...(source ? { source } : {}), createdAt: new Date().toISOString() };
}
export function quizContent(value: unknown, slots: Slot[]): Omit<QuizItem, 'id' | 'cardId'>[] {
  const v = object(value); if (!Array.isArray(v.items) || v.items.length !== slots.length) throw new AppError(400, '短测数量不正确。');
  const seen = new Set<string>();
  const items = v.items.map(item => {
    const q = object(item), slot = slots.find(s => s.point.id === q.pointId && s.facet === q.facet), identity = `${q.pointId}:${q.facet}`;
    if (!slot || seen.has(identity)) throw new AppError(400, '短测知识点或维度不正确。'); seen.add(identity);
    const r = object(q.reference);
    return { pointId: slot.point.id, title: q.title === undefined ? slot.point.title : text(q.title, 150), category: slot.point.category, facet: slot.facet, ...(slot.point.language ? { language: slot.point.language } : {}), prompt: text(q.prompt, 2000), starterCode: optional(q.starterCode, 8000), reference: { keywords: strings(r.keywords, 2, 5, 100), explanation: text(r.explanation, 1800), code: optional(r.code, 8000), requirements: strings(r.requirements, 0, 5, 200) }, ...(slot.point.source ? { source: slot.point.source } : {}), ...(slot.point.references ? { references: slot.point.references } : {}) };
  });
  return slots.map(s => items.find(i => i.pointId === s.point.id && i.facet === s.facet)!);
}
export function submittedAnswers(value: unknown, batch: StudyBatch, require = true) {
  const answers = object(object(value).answers), out: Record<string, string> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (!batch.items.some(i => i.id === id) || typeof answer !== 'string' || answer.length > 20000) throw new AppError(400, '短测题号或回答无效。');
    if (require && (batch.items.find(i => i.id === id)!.feedback || batch.items.find(i => i.id === id)!.skippedAt)) { if (answer.trim()) throw new AppError(409, '已评价或已结束的题目不能重复计入复习，请开启新一轮。'); continue; }
    if (!require || answer.trim()) out[id] = answer;
  }
  if (require && !Object.keys(out).length) throw new AppError(400, '请先回答至少一道尚未评价的题目。');
  return out;
}
export function quizFeedback(value: unknown, ids: string[]) {
  const v = object(value); if (!Array.isArray(v.items) || v.items.length !== ids.length) throw new AppError(400, '短测评价范围不正确。');
  const seen = new Set<string>();
  return v.items.map(item => { const f = object(item), id = text(f.itemId, 100); if (!ids.includes(id) || seen.has(id) || !['correct', 'partial', 'incorrect'].includes(f.verdict as string)) throw new AppError(400, '短测评价题号或结论无效。'); seen.add(id); return { itemId: id, verdict: f.verdict as Feedback['verdict'], summary: text(f.summary, 1000), gaps: strings(f.gaps, 0, 4, 300) }; });
}
export function publicBatch(batch: StudyBatch) {
  return { ...batch, items: batch.items.map(({ reference, ...item }) => ({ ...item, ...(item.revealedAt || item.feedback ? { reference } : {}) })) };
}
export class Study {
  constructor(private store: Store, readonly clock: () => Date = () => new Date()) {}
  points() { return [...BUILTIN_POINTS, ...(this.store.snapshot().studyPoints ?? [])]; }
  breadthOverview() {
    const state = this.store.snapshot(), cards = state.studyCards ?? [], latest = new Map<string, Feedback>();
    for (const item of (state.studyBatches ?? []).flatMap(b => b.items)) if (item.feedback && (!latest.has(item.cardId) || latest.get(item.cardId)!.at <= item.feedback.at)) latest.set(item.cardId, item.feedback);
    const pending = new Set((state.studyBatches ?? []).flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId)));
    const points = BREADTH_POINTS.map(point => {
      const results = point.facets.map(f => latest.get(cardId(point.id,f))).filter((f): f is Feedback => !!f);
      const due = point.facets.some(f => cards.some(c => c.id === cardId(point.id,f) && c.schedule.reviews && new Date(c.schedule.dueAt) <= this.clock() && !pending.has(c.id)));
      return { ...point, progress: { reviewed: results.length, total: point.facets.length, needsWork: results.some(f => f.rating !== 'good'), due } };
    });
    const coverage = Object.entries(BREADTH_DOMAINS).map(([id,label]) => {
      const area = points.filter(p => p.breadth!.domain === id);
      return { id,label,total:area.length,tested:area.filter(p => p.progress.reviewed).length,needsWork:area.filter(p => p.progress.needsWork).length,due:area.filter(p => p.progress.due).length };
    });
    return { domains: BREADTH_DOMAINS, groups: BREADTH_GROUPS, points, coverage };
  }
  point(id: string) { const p = this.points().find(p => p.id === id); if (!p) throw new AppError(404, '知识点不存在。'); return p; }
  batch(id: string) { const b = this.store.snapshot().studyBatches?.find(b => b.id === id); if (!b) throw new AppError(404, '短测记录不存在。'); return b; }
  async add(value: unknown) { const point = customPoint(value); await this.store.update(s => { (s.studyPoints ??= []).push(point); }); return point; }
  source(ref: { kind: string; id: string }): SourceRef & { content: string } {
    const s = this.store.snapshot();
    if (ref.kind === 'library') { const i = s.library?.find(i => i.id === ref.id); if (i) { if (!i.extractedText.trim()) throw new AppError(400, '这份资料还没有可读取正文，请先进行资料整理。'); return { kind: 'library', id: i.id, title: i.title, content: [i.extractedText, i.notes].join('\n').slice(0, 30000) }; } }
    if (ref.kind === 'problem') { const p = s.problems.find(p => p.id === ref.id); if (p) return { kind: 'problem', id: p.id, title: p.title, content: JSON.stringify({ topic: p.topic, language: p.language, description: p.description, review: p.reviews.at(-1) }) }; }
    if (ref.kind === 'language') { const p = s.languageDrills?.find(p => p.id === ref.id); if (p) return { kind: 'language', id: p.id, title: p.title, content: JSON.stringify({ language: p.language, concepts: p.concepts, exercises: p.exercises, requirements: p.requirements }).slice(0, 30000) }; }
    if (ref.kind === 'training') { const p = s.trainings?.find(p => p.id === ref.id); if (p) return { kind: 'training', id: p.id, title: p.title, content: JSON.stringify({ kind: p.kind, language: p.language, question: p.question, scenario: p.scenario, reviews: p.reviews.slice(-2), turns: p.turns, notes: p.draft }).slice(0, 30000) }; }
    throw new AppError(404, '学习来源不存在。');
  }
  importContent(value: unknown, source: SourceRef) {
    const v = object(value); if (!Array.isArray(v.points) || !v.points.length || v.points.length > 8) throw new AppError(400, '提取的知识点数量不正确。');
    const points = v.points.map(p => customPoint(p, source));
    if (new Set(points.map(p => `${p.title.toLowerCase()}|${p.language ?? ''}`)).size !== points.length) throw new AppError(400, '提取了重复知识点。');
    return points;
  }
  latestFeedback(state: State, id: string) { return (state.studyBatches ?? []).flatMap(b => b.items).filter(i => i.cardId === id && i.feedback).map(i => i.feedback!).sort((a, b) => b.at.localeCompare(a.at))[0]; }
  plan(selection: StudySelection): Slot[] {
    const state = this.store.snapshot(), at = this.clock(), cards = state.studyCards ?? [], pending = new Set((state.studyBatches ?? []).flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId)));
    const points = this.points().filter(p => (!selection.pointId || p.id === selection.pointId) && (selection.category === 'all' || p.category === selection.category) && (!p.language || p.language === selection.language) && (!selection.breadth || p.breadth && (selection.breadth.domain === 'all' || p.breadth.domain === selection.breadth.domain) && (selection.breadth.group === 'all' || p.breadth.group === selection.breadth.group)));
    if (selection.pointId && !points.length) throw new AppError(400, '所选知识点不匹配当前类别或语言。');
    const due: Slot[] = [], weak: Slot[] = [], fresh: Slot[] = [];
    for (const point of points) for (const facet of selection.facet === 'auto' ? point.facets : point.facets.filter(f => f === selection.facet)) {
      const id = cardId(point.id, facet); if (pending.has(id)) continue;
      const card = cards.find(c => c.id === id), base = { point, facet, cardId: id };
      if (!card || !card.schedule.reviews) { if (!selection.weakOnly) fresh.push({ ...base, reason: selection.pointId ? 'selected' : 'new' }); }
      else if (new Date(card.schedule.dueAt) <= at) due.push({ ...base, reason: 'due' });
      else if (selection.pointId && !selection.weakOnly) weak.push({ ...base, reason: selection.pointId ? 'selected' : 'weak' });
    }
    due.sort((a, b) => cards.find(c => c.id === a.cardId)!.schedule.dueAt.localeCompare(cards.find(c => c.id === b.cardId)!.schedule.dueAt));
    // Mix categories for a general batch and rotate through unpractised points instead of flooding one language/topic.
    const groups = new Map<string, Slot[]>(); for (const slot of fresh) { const key = selection.breadth ? (selection.breadth.domain === 'all' ? slot.point.breadth!.domain : slot.point.breadth!.group) : slot.point.category, g = groups.get(key) ?? []; g.push(slot); groups.set(key, g); }
    const mixed: Slot[] = []; while ([...groups.values()].some(g => g.length)) for (const g of groups.values()) if (g.length) mixed.push(g.shift()!);
    const out: Slot[] = [], selectedPoints = new Set<string>();
    const take = (pool: Slot[], limit: number, unique: boolean) => { for (const slot of pool) if (out.length < limit && !out.some(s => s.cardId === slot.cardId) && (!unique || !selectedPoints.has(slot.point.id))) { out.push(slot); selectedPoints.add(slot.point.id); } };
    take(due, selection.count, true); take(weak, Math.min(selection.count, out.length + (selection.weakOnly ? selection.count : 1)), true); take(mixed, selection.count, true);
    // A focused single-point batch can test several independent facets.
    if (selection.pointId) { take(due, selection.count, false); take(weak, selection.count, false); take(mixed, selection.count, false); }
    // A new breadth test mixes recognition, scenario choice and explanation without displacing due reviews.
    if (selection.breadth && selection.facet === 'auto' && !selection.pointId) {
      const facets: Facet[] = ['recall','apply','explain'];
      out.forEach((slot, index) => {
        if (slot.reason === 'new') out[index] = fresh.find(candidate => candidate.point.id === slot.point.id && candidate.facet === facets[index % facets.length]) ?? slot;
      });
    }
    if (!out.length) throw new AppError(400, '当前没有可开启的短测。请继续未完成的记录、切换知识点，或等待复习到期。');
    return out;
  }
  async create(items: Omit<QuizItem, 'id' | 'cardId'>[], selection: StudySelection, model: string, signal: AbortSignal, userLanguage: Locale = "zh") {
    const words = { zh: { mixed: '综合', cross: '跨领域', quiz: '短测', breadth: '技术广度', unit: '题' }, en: { mixed: 'Mixed', cross: 'Across domains', quiz: ' quiz', breadth: 'Technical breadth', unit: ' questions' }, ja: { mixed: '総合', cross: '分野横断', quiz: '小テスト', breadth: '技術の幅', unit: '問' } }[userLanguage];
    const scope = selection.breadth ? `${words.breadth} · ${selection.breadth.domain === 'all' ? words.cross : translateSource(BREADTH_DOMAINS[selection.breadth.domain], userLanguage)}` : `${selection.category === 'all' ? words.mixed : translateSource(STUDY_CATEGORIES[selection.category], userLanguage)}${words.quiz}`;
    const at = this.clock().toISOString(), batch: StudyBatch = { id: randomUUID(), createdAt: at, title: `${scope} · ${items.length}${words.unit}`, model, selection, items: items.map(i => ({ ...i, id: randomUUID(), cardId: cardId(i.pointId, i.facet) })), drafts: {} };
    await this.store.update(s => { signal.throwIfAborted(); const pending = new Set((s.studyBatches ?? []).flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId))); if (batch.items.some(i => pending.has(i.cardId))) throw new AppError(409, '同一知识点已有未完成短测，请先继续该记录。'); for (const item of batch.items) if (!(s.studyCards ??= []).some(c => c.id === item.cardId)) s.studyCards.push({ id: item.cardId, pointId: item.pointId, facet: item.facet, schedule: initialSchedule(this.clock()) }); (s.studyBatches ??= []).push(batch); }); return batch;
  }
  async closeBatch(id: string) {
    this.batch(id);
    await this.store.update(s => { for (const item of s.studyBatches!.find(b => b.id === id)!.items) if (!item.feedback) item.skippedAt ??= this.clock().toISOString(); });
    return publicBatch(this.batch(id));
  }
  async save(id: string, value: unknown) { const answers = submittedAnswers(value, this.batch(id), false); await this.store.update(s => Object.assign(s.studyBatches!.find(b => b.id === id)!.drafts, answers)); }
  async reveal(id: string, itemId: string) {
    const batch = this.batch(id); if (!batch.items.some(i => i.id === itemId)) throw new AppError(404, '短测题目不存在。');
    await this.store.update(s => { const item = s.studyBatches!.find(b => b.id === id)!.items.find(i => i.id === itemId)!; if (!item.feedback) item.revealedAt ??= this.clock().toISOString(); }); return publicBatch(this.batch(id));
  }
  async grade(id: string, answers: Record<string, string>, results: ReturnType<typeof quizFeedback>, model: string, signal: AbortSignal) {
    const at = this.clock();
    await this.store.update(s => {
      signal.throwIfAborted(); const batch = s.studyBatches!.find(b => b.id === id)!;
      for (const result of results) {
        const item = batch.items.find(i => i.id === result.itemId)!; if (item.feedback || item.skippedAt) throw new AppError(409, '这道题已评价，不重复更新复习间隔。');
        const card = s.studyCards!.find(c => c.id === item.cardId)!, assisted = !!item.revealedAt, { rating, schedule } = advanceSchedule(card.schedule, result.verdict, assisted, at);
        item.feedback = { at: at.toISOString(), model, answer: answers[item.id], verdict: result.verdict, summary: result.summary, gaps: result.gaps, assisted, rating, schedule }; card.schedule = schedule;
      }
    });
  }
  overview() {
    const state = this.store.snapshot(), at = this.clock(), cards = state.studyCards ?? [], batches = state.studyBatches ?? [], points = this.points(), day = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(v), today = day(at);
    const pending = new Set(batches.flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId))), feedback = batches.flatMap(b => b.items.map(i => i.feedback).filter((f): f is Feedback => !!f)), todayReviews = feedback.filter(f => day(new Date(f.at)) === today);
    return { day: today, totalPoints: points.length, practicedPoints: new Set(cards.filter(c => c.schedule.reviews).map(c => c.pointId)).size, due: cards.filter(c => c.schedule.reviews && new Date(c.schedule.dueAt) <= at && !pending.has(c.id)).length, pending: pending.size, todayReviews: todayReviews.length, todayIndependent: todayReviews.filter(f => f.rating === 'good').length,
      facets: Object.entries(STUDY_FACETS).map(([id, label]) => ({ id, label, reviewed: cards.filter(c => c.facet === id && c.schedule.reviews).length, due: cards.filter(c => c.facet === id && c.schedule.reviews && new Date(c.schedule.dueAt) <= at && !pending.has(c.id)).length })),
      cards: cards.map(c => ({ ...c, pending: pending.has(c.id), title: points.find(p => p.id === c.pointId)?.title ?? '知识点', category: points.find(p => p.id === c.pointId)?.category, language: points.find(p => p.id === c.pointId)?.language })), batches: batches.slice().reverse().map(b => ({ id: b.id, title: b.title, createdAt: b.createdAt, total: b.items.length, reviewed: b.items.filter(i => i.feedback).length, closed: b.items.every(i => i.feedback || i.skippedAt), ...(b.selection.breadth ? { breadth: b.selection.breadth } : {}) })), rule: '独立答对：1→3→7→14→30天后继续自适应延长；部分正确：近期复习；答错或看过答案：10分钟后重测。每个维度独立计算。' };
  }
}
