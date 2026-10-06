import { formatMessage } from './generated/localizations.ts';
import { translateSource } from "./ui-messages.ts";
import type { Locale } from "./locales.ts";
import { createHash, randomUUID } from 'node:crypto';
import { AppError, LANGUAGES, TOPICS, object, text, type Language, type State } from './domain.ts';
import { LANGUAGE_SYLLABUS } from './language.ts';
import { Store } from './store.ts';
import { BREADTH_DOMAINS, BREADTH_GROUPS, BREADTH_POINTS, type BreadthScope } from './breadth.ts';

export const STUDY_CATEGORIES = { algorithm: formatMessage('zh', "ui.algorithmKnowledge"), language: formatMessage('zh', "ui.languagePatterns"), concept: formatMessage('zh', "ui.conceptsAndMethods"), tools: formatMessage('zh', "ui.engineeringToolsAndCLI"), expression: formatMessage('zh', "ui.focusedExpression") } as const;
export const STUDY_FACETS = { recall: formatMessage('zh', "ui.understandingAndRecall"), write: formatMessage('zh', "ui.syntaxAndCommands"), apply: formatMessage('zh', "ui.scenarioApplication"), explain: formatMessage('zh', "ui.conciseExpression") } as const;
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
  return { id: `builtin-${idFor([category, topic, title, language ?? ''].join('|'))}`, title, category, topic, facets, ...(language ? { language } : {}), description: formatMessage('zh', "study.defaultDescription") };
}
const algorithmConcepts: Record<string, string[]> = {
  array: [formatMessage('zh', "ui.indexingAndEmptyArrayBoundaries"), formatMessage('zh', "ui.prefixSumAndRangeCalculation"), formatMessage('zh', "ui.localStateAndGlobalResult"), formatMessage('zh', "ui.timeAndSpaceComplexity")],
  string: [formatMessage('zh', "ui.characterAndEncodingBoundaries"), formatMessage('zh', "ui.stringTraversalAndCounting"), formatMessage('zh', "ui.substringsAndSubsequences"), formatMessage('zh', "ui.stringConcatenationComplexity")],
  hash: [formatMessage('zh', "ui.hashTablesAndKeyEqualityRules"), formatMessage('zh', "ui.countingAndDuplicateChecks"), formatMessage('zh', "ui.collisionsAndAverageComplexity"), formatMessage('zh', "ui.choosingMapOrSet")],
  'two-pointers': [formatMessage('zh', "ui.twoPointerInvariants"), formatMessage('zh', "ui.fastAndSlowPointers"), formatMessage('zh', "ui.expandingAndShrinkingASlidingWindow"), formatMessage('zh', "ui.monotonicConditionsAndWindowApplicabilityBoundaries")],
  stack: [formatMessage('zh', "ui.operationSemanticsOfStacksAndQueues"), formatMessage('zh', "ui.parenthesesMatching"), formatMessage('zh', "ui.monotonicStack"), formatMessage('zh', "ui.queuesAndBreadthFirstTraversal")],
  'linked-list': [formatMessage('zh', "ui.orderOfLinkedListPointerUpdates"), formatMessage('zh', "ui.dummyHeadNode"), formatMessage('zh', "ui.reverseALinkedList"), formatMessage('zh', "ui.cyclesAndFastSlowPointers")],
  tree: [formatMessage('zh', "ui.recursionTerminationCondition"), formatMessage('zh', "ui.preorderInorderAndPostorderTreeTraversal"), formatMessage('zh', "ui.binarySearchTreeInvariants"), formatMessage('zh', "ui.levelOrderTreeTraversal")],
  graph: [formatMessage('zh', "ui.adjacencyListAndVisitedMarkers"), formatMessage('zh', "ui.choosingBetweenDFSAndBFS"), formatMessage('zh', "ui.cycleDetectionAndTopologicalSorting"), formatMessage('zh', "ui.weightConditionsForShortestPaths")],
  'binary-search': [formatMessage('zh', "ui.binarySearchIntervalDefinition"), formatMessage('zh', "ui.terminationConditionsAndMidpointUpdates"), formatMessage('zh', "ui.lowerBoundAndUpperBound"), formatMessage('zh', "ui.answerSpaceAndMonotonicPredicate")],
  dp: [formatMessage('zh', "ui.stateDefinition"), formatMessage('zh', "ui.stateTransitionsAndDependencyOrder"), formatMessage('zh', "ui.initializationAndBoundaries"), formatMessage('zh', "ui.whenRollingArraysApply")],
};
export const BUILTIN_POINTS: KnowledgePoint[] = [
  ...Object.entries(algorithmConcepts).flatMap(([topic, titles]) => titles.map(title => makePoint('algorithm', TOPICS[topic as keyof typeof TOPICS], title, ['recall', 'apply', 'explain']))),
  ...Object.entries(LANGUAGE_SYLLABUS).flatMap(([language, topics]) => Object.values(topics).flatMap(topic => topic.concepts.map(title => makePoint('language', topic.label, title, ['write', 'recall', 'apply', 'explain'], language as Language)))),
  ...[formatMessage('zh', "ui.dIAndConstructorInjection"), formatMessage('zh', "ui.ioCAndDependencyInversion"), formatMessage('zh', "ui.dDDAndDomainBoundaries"), formatMessage('zh', "ui.entitiesAndValueObjects"), formatMessage('zh', "ui.aggregatesAndInvariants"), formatMessage('zh', "ui.repositoryResponsibilityBoundaries"), formatMessage('zh', "ui.theTDDFeedbackLoop"), formatMessage('zh', "ui.unitTestsAndIntegrationTests"), formatMessage('zh', "ui.mockStubAndFake"), formatMessage('zh', "ui.kanbanAndWorkInProgressLimits"), formatMessage('zh', "ui.scrumAndIterations"), formatMessage('zh', "ui.sOLIDApplicabilityBoundaries"), formatMessage('zh', "ui.compositionAndInheritance"), formatMessage('zh', "ui.mVCMVPAndMVVM"), formatMessage('zh', "ui.stateMachinesAndStateModeling"), formatMessage('zh', "ui.bLoCEventsAndStates"), formatMessage('zh', "ui.idempotencyAndRetry"), formatMessage('zh', "ui.cachingAndConsistency"), formatMessage('zh', "ui.concurrencyRacesAndCancellation"), formatMessage('zh', "ui.cICDAndReleaseFlow"), formatMessage('zh', "ui.observabilityLogsMetricsAndTraces")].map(title => makePoint('concept', formatMessage('zh', "ui.conceptsAndEngineeringMethods"), title, ['recall', 'apply', 'explain'])),
  ...[formatMessage('zh', "ui.gitStatusDiffAndLog"), formatMessage('zh', "ui.gitBranchesCommitsAndMerges"), formatMessage('zh', "ui.gitEffectsOfRevertAndReset"), formatMessage('zh', "ui.aDBDevicesInstallationAndLogs"), formatMessage('zh', "ui.filteringADBAndLogcat"), formatMessage('zh', "ui.gradleBuildAndTestTasks"), formatMessage('zh', "ui.flutterAnalyzeTestAndBuild"), formatMessage('zh', "ui.dartFormatAnalyzeAndTest"), formatMessage('zh', "ui.swiftBuildAndTest"), formatMessage('zh', "ui.xcodeXcodebuildAndSimulator"), formatMessage('zh', "ui.pythonVenvAndModuleExecution"), formatMessage('zh', "ui.goTestFmtAndVet"), formatMessage('zh', "ui.javaJavacJavaAndBuildTools"), formatMessage('zh', "ui.cLIPipesExitCodesAndEnvironmentVariables"), formatMessage('zh', "ui.androidCrashStacksAndObfuscationMapping"), formatMessage('zh', "ui.androidANRsAndThreadBlocking"), formatMessage('zh', "ui.iOSCrashesAndDSYMSymbolication"), formatMessage('zh', "ui.flutterExceptionsAndNativeCrashes"), formatMessage('zh', "ui.crashlyticsUseCasesAndInvestigationFlow"), formatMessage('zh', "ui.datadogMobileMonitoringAndDiagnostics"), formatMessage('zh', "ui.sentryErrorTrackingAndContext"), formatMessage('zh', "ui.investigationDirectionsInAndroidStudioProfiler"), formatMessage('zh', "ui.investigationDirectionsInInstruments"), formatMessage('zh', "ui.productionIncidentsVersionDeviceAndReproductionContext")].map(title => makePoint('tools', formatMessage('zh', "ui.cLIAndMobileTroubleshootingTools"), title, ['recall', 'apply', 'explain', ...(title.includes('：') && !title.startsWith(formatMessage('zh', "ui.production")) ? ['write' as Facet] : [])])),
  ...[formatMessage('zh', "ui.conclusionFirstExplainATechnicalDecision"), formatMessage('zh', "ui.threeKeyPointsYourOwnActionsAndResults"), formatMessage('zh', "ui.brieflyExplainATechnicalTerm"), formatMessage('zh', "ui.explainTheTradeOffsBetweenTwoOptions"), formatMessage('zh', "ui.clearlyDistinguishFactsAssumptionsAndUnknowns"), formatMessage('zh', "ui.explainTheValidationMethodInBriefJapanese"), formatMessage('zh', "ui.condenseComplexProjectBackgroundIntoKeyPoints")].map(title => makePoint('expression', formatMessage('zh', "ui.conciseTechnicalCommunication"), title, ['explain', 'apply'])),
  ...BREADTH_POINTS,
];
const strings = (value: unknown, min: number, max: number, length: number): string[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AppError(400, formatMessage('zh', "ui.incorrectNumberOfKeyPoints"));
  return value.map(v => text(v, length).trim());
};
const optional = (value: unknown, max: number) => { if (value === undefined) return ''; if (typeof value !== 'string' || value.length > max) throw new AppError(400, formatMessage('zh', "ui.theTextIsTooLongOrInvalid")); return value; };
export function studySelection(value: unknown): StudySelection {
  const v = object(value), category = v.category ?? 'all', language = v.language ?? 'dart', facet = v.facet ?? 'auto';
  if (category !== 'all' && !Object.hasOwn(STUDY_CATEGORIES, category as string) || !Object.hasOwn(LANGUAGES, language as string) || facet !== 'auto' && !Object.hasOwn(STUDY_FACETS, facet as string) || ![3, 5, 8].includes(v.count as number)) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseAQuizCategoryLanguageDimensionAnd"));
  if (v.weakOnly !== undefined && typeof v.weakOnly !== 'boolean') throw new AppError(400, formatMessage('zh', "ui.invalidWeakPointFilter"));
  let breadth: BreadthScope | undefined;
  if (v.breadth !== undefined) {
    const scope = object(v.breadth), domain = scope.domain ?? 'all', group = scope.group ?? 'all';
    if ((domain !== 'all' && !Object.hasOwn(BREADTH_DOMAINS, domain as string)) || (group !== 'all' && !Object.hasOwn(BREADTH_GROUPS, group as string))) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseAValidTechnicalFieldAndKnowledge"));
    breadth = { domain: domain as BreadthScope['domain'], group: group as BreadthScope['group'] };
  }
  return { category: category as StudySelection['category'], language: language as Language, facet: facet as StudySelection['facet'], count: v.count as number, ...(v.pointId ? { pointId: text(v.pointId, 100) } : {}), weakOnly: v.weakOnly === true, ...(breadth ? { breadth } : {}) };
}
export function customPoint(value: unknown, source?: SourceRef): KnowledgePoint {
  const v = object(value); if (!Object.hasOwn(STUDY_CATEGORIES, v.category as string)) throw new AppError(400, formatMessage('zh', "ui.invalidKnowledgePointCategory"));
  const category = v.category as Category, facets = strings(v.facets, 1, 4, 20) as Facet[];
  if (new Set(facets).size !== facets.length || facets.some(f => !Object.hasOwn(STUDY_FACETS, f))) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseAValidTestDimension"));
  if (v.language !== undefined && !Object.hasOwn(LANGUAGES, v.language as string) || category === 'language' && !v.language) throw new AppError(400, formatMessage('zh', "ui.languageKnowledgePointsRequireASpecifiedLanguage"));
  return { id: randomUUID(), title: text(v.title, 150).trim(), category, topic: text(v.topic ?? formatMessage('zh', "study.customTopic"), 100).trim(), description: optional(v.description, 2000), facets, ...(v.language ? { language: v.language as Language } : {}), ...(source ? { source } : {}), createdAt: new Date().toISOString() };
}
export function quizContent(value: unknown, slots: Slot[]): Omit<QuizItem, 'id' | 'cardId'>[] {
  const v = object(value); if (!Array.isArray(v.items) || v.items.length !== slots.length) throw new AppError(400, formatMessage('zh', "ui.incorrectNumberOfQuizItems"));
  const seen = new Set<string>();
  const items = v.items.map(item => {
    const q = object(item), slot = slots.find(s => s.point.id === q.pointId && s.facet === q.facet), identity = `${q.pointId}:${q.facet}`;
    if (!slot || seen.has(identity)) throw new AppError(400, formatMessage('zh', "ui.incorrectQuizKnowledgePointOrDimension")); seen.add(identity);
    const r = object(q.reference);
    return { pointId: slot.point.id, title: q.title === undefined ? slot.point.title : text(q.title, 150), category: slot.point.category, facet: slot.facet, ...(slot.point.language ? { language: slot.point.language } : {}), prompt: text(q.prompt, 2000), starterCode: optional(q.starterCode, 8000), reference: { keywords: strings(r.keywords, 2, 5, 100), explanation: text(r.explanation, 1800), code: optional(r.code, 8000), requirements: strings(r.requirements, 0, 5, 200) }, ...(slot.point.source ? { source: slot.point.source } : {}), ...(slot.point.references ? { references: slot.point.references } : {}) };
  });
  return slots.map(s => items.find(i => i.pointId === s.point.id && i.facet === s.facet)!);
}
export function submittedAnswers(value: unknown, batch: StudyBatch, require = true) {
  const answers = object(object(value).answers), out: Record<string, string> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (!batch.items.some(i => i.id === id) || typeof answer !== 'string' || answer.length > 20000) throw new AppError(400, formatMessage('zh', "ui.invalidQuizQuestionNumberOrAnswer"));
    if (require && (batch.items.find(i => i.id === id)!.feedback || batch.items.find(i => i.id === id)!.skippedAt)) { if (answer.trim()) throw new AppError(409, formatMessage('zh', "ui.questionsThatHaveBeenEvaluatedOrEndedCannot")); continue; }
    if (!require || answer.trim()) out[id] = answer;
  }
  if (require && !Object.keys(out).length) throw new AppError(400, formatMessage('zh', "ui.pleaseAnswerAtLeastOneUnevaluatedQuestionFirst"));
  return out;
}
export function quizFeedback(value: unknown, ids: string[]) {
  const v = object(value); if (!Array.isArray(v.items) || v.items.length !== ids.length) throw new AppError(400, formatMessage('zh', "ui.invalidQuizEvaluationRange"));
  const seen = new Set<string>();
  return v.items.map(item => { const f = object(item), id = text(f.itemId, 100); if (!ids.includes(id) || seen.has(id) || !['correct', 'partial', 'incorrect'].includes(f.verdict as string)) throw new AppError(400, formatMessage('zh', "ui.invalidQuizEvaluationQuestionNumberOrConclusion")); seen.add(id); return { itemId: id, verdict: f.verdict as Feedback['verdict'], summary: text(f.summary, 1000), gaps: strings(f.gaps, 0, 4, 300) }; });
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
  point(id: string) { const p = this.points().find(p => p.id === id); if (!p) throw new AppError(404, formatMessage('zh', "ui.knowledgePointNotFound")); return p; }
  batch(id: string) { const b = this.store.snapshot().studyBatches?.find(b => b.id === id); if (!b) throw new AppError(404, formatMessage('zh', "ui.quizRecordNotFound")); return b; }
  async add(value: unknown) { const point = customPoint(value); await this.store.update(s => { (s.studyPoints ??= []).push(point); }); return point; }
  source(ref: { kind: string; id: string }): SourceRef & { content: string } {
    const s = this.store.snapshot();
    if (ref.kind === 'library') { const i = s.library?.find(i => i.id === ref.id); if (i) { if (!i.extractedText.trim()) throw new AppError(400, formatMessage('zh', "ui.thisMaterialHasNoReadableContentYetPlease")); return { kind: 'library', id: i.id, title: i.title, content: [i.extractedText, i.notes].join('\n').slice(0, 30000) }; } }
    if (ref.kind === 'problem') { const p = s.problems.find(p => p.id === ref.id); if (p) return { kind: 'problem', id: p.id, title: p.title, content: JSON.stringify({ topic: p.topic, language: p.language, description: p.description, review: p.reviews.at(-1) }) }; }
    if (ref.kind === 'language') { const p = s.languageDrills?.find(p => p.id === ref.id); if (p) return { kind: 'language', id: p.id, title: p.title, content: JSON.stringify({ language: p.language, concepts: p.concepts, exercises: p.exercises, requirements: p.requirements }).slice(0, 30000) }; }
    if (ref.kind === 'training') { const p = s.trainings?.find(p => p.id === ref.id); if (p) return { kind: 'training', id: p.id, title: p.title, content: JSON.stringify({ kind: p.kind, language: p.language, question: p.question, scenario: p.scenario, reviews: p.reviews.slice(-2), turns: p.turns, notes: p.draft }).slice(0, 30000) }; }
    throw new AppError(404, formatMessage('zh', "ui.theLearningSourceDoesNotExist"));
  }
  importContent(value: unknown, source: SourceRef) {
    const v = object(value); if (!Array.isArray(v.points) || !v.points.length || v.points.length > 8) throw new AppError(400, formatMessage('zh', "ui.theNumberOfExtractedTopicsIsIncorrect"));
    const points = v.points.map(p => customPoint(p, source));
    if (new Set(points.map(p => `${p.title.toLowerCase()}|${p.language ?? ''}`)).size !== points.length) throw new AppError(400, formatMessage('zh', "ui.duplicateTopicsWereExtracted"));
    return points;
  }
  latestFeedback(state: State, id: string) { return (state.studyBatches ?? []).flatMap(b => b.items).filter(i => i.cardId === id && i.feedback).map(i => i.feedback!).sort((a, b) => b.at.localeCompare(a.at))[0]; }
  plan(selection: StudySelection): Slot[] {
    const state = this.store.snapshot(), at = this.clock(), cards = state.studyCards ?? [], pending = new Set((state.studyBatches ?? []).flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId)));
    const points = this.points().filter(p => (!selection.pointId || p.id === selection.pointId) && (selection.category === 'all' || p.category === selection.category) && (!p.language || p.language === selection.language) && (!selection.breadth || p.breadth && (selection.breadth.domain === 'all' || p.breadth.domain === selection.breadth.domain) && (selection.breadth.group === 'all' || p.breadth.group === selection.breadth.group)));
    if (selection.pointId && !points.length) throw new AppError(400, formatMessage('zh', "ui.theSelectedTopicDoesNotMatchTheCurrent"));
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
    if (!out.length) throw new AppError(400, formatMessage('zh', "ui.noQuickQuizIsAvailableRightNowContinue"));
    return out;
  }
  async create(items: Omit<QuizItem, 'id' | 'cardId'>[], selection: StudySelection, model: string, signal: AbortSignal, userLanguage: Locale = "zh") {
    const scope = selection.breadth
      ? selection.breadth.domain === 'all' ? formatMessage(userLanguage, 'study.scopeBreadthAll') : formatMessage(userLanguage, 'study.scopeBreadth', {domain:translateSource(BREADTH_DOMAINS[selection.breadth.domain], userLanguage)})
      : selection.category === 'all' ? formatMessage(userLanguage, 'study.scopeAll') : formatMessage(userLanguage, 'study.scopeCategory', {category:translateSource(STUDY_CATEGORIES[selection.category], userLanguage)});
    const at = this.clock().toISOString(), batch: StudyBatch = { id: randomUUID(), createdAt: at, title: formatMessage(userLanguage, 'study.batchTitle', {scope,count:items.length}), model, selection, items: items.map(i => ({ ...i, id: randomUUID(), cardId: cardId(i.pointId, i.facet) })), drafts: {} };
    await this.store.update(s => { signal.throwIfAborted(); const pending = new Set((s.studyBatches ?? []).flatMap(b => b.items.filter(i => !i.feedback && !i.skippedAt).map(i => i.cardId))); if (batch.items.some(i => pending.has(i.cardId))) throw new AppError(409, formatMessage('zh', "ui.thereIsAlreadyAnUnfinishedQuizForThis")); for (const item of batch.items) if (!(s.studyCards ??= []).some(c => c.id === item.cardId)) s.studyCards.push({ id: item.cardId, pointId: item.pointId, facet: item.facet, schedule: initialSchedule(this.clock()) }); (s.studyBatches ??= []).push(batch); }); return batch;
  }
  async closeBatch(id: string) {
    this.batch(id);
    await this.store.update(s => { for (const item of s.studyBatches!.find(b => b.id === id)!.items) if (!item.feedback) item.skippedAt ??= this.clock().toISOString(); });
    return publicBatch(this.batch(id));
  }
  async save(id: string, value: unknown) { const answers = submittedAnswers(value, this.batch(id), false); await this.store.update(s => Object.assign(s.studyBatches!.find(b => b.id === id)!.drafts, answers)); }
  async reveal(id: string, itemId: string) {
    const batch = this.batch(id); if (!batch.items.some(i => i.id === itemId)) throw new AppError(404, formatMessage('zh', "ui.quizQuestionNotFound"));
    await this.store.update(s => { const item = s.studyBatches!.find(b => b.id === id)!.items.find(i => i.id === itemId)!; if (!item.feedback) item.revealedAt ??= this.clock().toISOString(); }); return publicBatch(this.batch(id));
  }
  async grade(id: string, answers: Record<string, string>, results: ReturnType<typeof quizFeedback>, model: string, signal: AbortSignal) {
    const at = this.clock();
    await this.store.update(s => {
      signal.throwIfAborted(); const batch = s.studyBatches!.find(b => b.id === id)!;
      for (const result of results) {
        const item = batch.items.find(i => i.id === result.itemId)!; if (item.feedback || item.skippedAt) throw new AppError(409, formatMessage('zh', "ui.thisQuestionHasAlreadyBeenEvaluatedTheReview"));
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
      cards: cards.map(c => ({ ...c, pending: pending.has(c.id), title: points.find(p => p.id === c.pointId)?.title ?? formatMessage('zh', "study.knowledgePoint"), category: points.find(p => p.id === c.pointId)?.category, language: points.find(p => p.id === c.pointId)?.language })), batches: batches.slice().reverse().map(b => ({ id: b.id, title: b.title, createdAt: b.createdAt, total: b.items.length, reviewed: b.items.filter(i => i.feedback).length, closed: b.items.every(i => i.feedback || i.skippedAt), ...(b.selection.breadth ? { breadth: b.selection.breadth } : {}) })), rule: formatMessage('zh', "study.scheduleRule") };
  }
}
