import { element, elements } from './dom.ts';
import { createApiClient, eventData, requestTask } from './api.ts';
import { t, LOCALES, languageTag, uiLanguage, setLanguages, localizeShell, catalogText, errorText } from "./i18n.js";
import { editorValue, editorSelection, hasEditor, mountEditor, unmountEditor } from "./editor.js";
import { createLanguagePractice } from "./language.js";
import { createInterviewPractice } from "./interview.js";
import { createTrainingPractice } from "./training.js";
import { createStudy } from "./study.js";
import { createLibrary } from "./library.js";
import { createModelPicker } from "./model-picker.js";
import { createBreadth } from "./breadth.js";
import { createEntertainment } from "./entertainment.js";
import { createChat } from "./chat.js";
import { createPageContext } from "./page-context.js";
import { createTeacher } from "./teacher.js";
import { createVoiceDemo } from "./voice.js";
import { createSetup } from "./setup.js";

const api = createApiClient(errorText);
localizeShell();

const appShell = element('.app-shell');
const sidebarToggle = element('#sidebar-toggle');
const sidebarPreferenceKey = 'algo-practice:sidebar-collapsed';
function setSidebarCollapsed(collapsed) {
  appShell.dataset.sidebarCollapsed = String(collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', t(collapsed ? "ui.expandSidebar" : "ui.collapseSidebar"));
  sidebarToggle.title = sidebarToggle.getAttribute('aria-label');
  elements('.nav-item').forEach(item => {
    if (collapsed) item.title = item.getAttribute('aria-label');
    else item.removeAttribute('title');
  });
}
let sidebarCollapsed = false;
try { sidebarCollapsed = localStorage.getItem(sidebarPreferenceKey) === 'true'; } catch {}
setSidebarCollapsed(sidebarCollapsed);
sidebarToggle.onclick = () => {
  const collapsed = appShell.dataset.sidebarCollapsed !== 'true';
  setSidebarCollapsed(collapsed);
  try { localStorage.setItem(sidebarPreferenceKey, String(collapsed)); } catch {}
};

const navToggle = element('#nav-toggle');
function setNavigation(open) {
  element('.sidebar').dataset.navOpen = String(open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? t("ui.collapseModuleMenu") : t("ui.expandModuleMenu"));
}
navToggle.onclick = () => setNavigation(navToggle.getAttribute('aria-expanded') !== 'true');
element('#main-navigation').addEventListener('click', event => { if ((/** @type {Element} */ (event.target)).closest('a')) setNavigation(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') { setNavigation(false); navToggle.focus(); } });

const $ = selector => element(selector);
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = value => new Date(value).toLocaleString(languageTag(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
let config, state, account, settings;
let currentId = null, feedbackTab = "hints", selectedReview = null;
let currentMode = "algorithm";
let activeJob = null, actionPending = false, modelPending = false, taskSource = null, pollTimer = null;
let authSource = null, loginId = null, authPromptId = null, authPopup = null;
let saveTimer = null, saveQueue = Promise.resolve(), toastTimer = null;
let choice = { topic: "array", difficulty: "easy", language: "javascript" };
let historyFilter = { search: "", topic: "", status: "" };
const verdictLabels = { "needs-work": t("ui.needsImprovement"), promising: t("ui.takingShape"), solid: t("ui.solidStaticReview") };
const modelPicker = createModelPicker(selectModel);
const languagePractice = createLanguagePractice({ $, escape, date, options, pageHeading, list, api, toast, mountDraft, flushCode, startTask, updateButtons,
  getConfig: () => config, getState: () => state });
const interviewPractice = createInterviewPractice({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons,
  getConfig: () => config, getState: () => state, beginTraining: input => trainingPractice.begin(input) });
const trainingPractice = createTrainingPractice({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons,
  getConfig: () => config, getState: () => state, flushBefore: flushCode });
const library = createLibrary({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons,
  getState: () => state, getAccount: () => account, isBusy: () => !!activeJob || actionPending || modelPending });

const studyPractice = createStudy({ $, escape, date, options, pageHeading, list, api, toast, startTask, updateButtons,
  getConfig: () => config, getState: () => state, flushBefore: flushCode });
const breadthPractice = createBreadth({ $, escape, date, options, pageHeading, api, toast, startTask, updateButtons, getState: () => state });
const entertainment = createEntertainment({ escape, pageHeading });
const voiceDemo = createVoiceDemo({ api, escape, pageHeading });
const pageContext = createPageContext({ editorValue, editorSelection, hasEditor });
const chat = createChat({ api, escape, date, toast, startTask, selectModel, beginLogin,
  getAccount: () => account, getModels: () => (config?.models ?? []).filter(model => !settings || settings.visibleModels.includes(model.id)),
  getBusy: () => (!!activeJob && activeJob.kind !== 'teacher') || actionPending || modelPending, getActiveJob: () => activeJob, pageContext });
const teacher = createTeacher({ api, escape, date, startTask, stopTeacher, selectModel, beginLogin,
  getCurrent: () => {
    const p = state?.problems.find(p => p.id === currentId);
    return p && currentMode === 'algorithm' && location.hash === `#practice/${p.id}` && hasEditor() ? { problemId: p.id, title: p.title, code: editorValue() } : null;
  },
  getAccount: () => account, getModels: () => (config?.models ?? []).filter(model => !settings || settings.visibleModels.includes(model.id)),
  getBusy: () => !!activeJob || actionPending || modelPending, getActiveJob: () => activeJob, getSettings: () => settings?.teacher });


function toast(message) {
  clearTimeout(toastTimer); $("#toast").textContent = errorText(message); $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}
function setAccount(value) {
  account = value;
  $("#auth-dot").classList.toggle("muted", !account.authenticated);
  $("#auth-button-label").textContent = account.authenticated ? t("ui.codexConnected") : t("ui.connectCodex");
  modelPicker.update(config.models.filter(model => !settings || settings.visibleModels.includes(model.id) || model.id === account.model), account.model);
  updateButtons();
}
function updateButtons() {
  const busy = !!activeJob || actionPending || modelPending;
  elements("[data-ai]").forEach(button => { (/** @type {HTMLButtonElement} */ (button)).disabled = actionPending || modelPending || (!!activeJob && activeJob.kind !== 'teacher'); });
  $("#auth-button").disabled = busy;
  modelPicker.setDisabled(actionPending || modelPending || (!!activeJob && activeJob.kind !== 'teacher'));
  elements('[data-model-visibility]').forEach(input => { (/** @type {HTMLButtonElement} */ (input)).disabled = busy || (/** @type {HTMLInputElement} */ (input)).value === account.model; });
  if ($('#settings-save')) $('#settings-save').disabled = busy;
  for (const id of ['#ui-language', '#user-language']) if ($(id)) $(id).disabled = busy;
  if ($('#teacher-trigger')) $('#teacher-trigger').disabled = busy;
  if ($('#teacher-idle-seconds')) $('#teacher-idle-seconds').disabled = busy || $('#teacher-trigger').value === 'manual';
  $("#task-bar").hidden = !activeJob || activeJob.kind === 'teacher';
  chat.sync();
  teacher.sync();
}
function pageHeading(eyebrow, title, subtitle, extra = "") {
  return `<section class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${extra}</section>`;
}
function options(values, selected, blank) {
  return (blank ? `<option value="">${blank}</option>` : "") + Object.entries(values).map(([key, value]) => `<option value="${escape(key)}" ${key === selected ? "selected" : ""}>${escape(errorText(value))}</option>`).join("");
}
function tags(p) { return `<div class="tags"><span class="tag ${p.difficulty}">${catalogText(config.difficulties[p.difficulty])}</span><span class="tag">${catalogText(config.topics[p.topic])}</span><span class="tag">${config.languages[p.language]}</span></div>`; }
function list(items) { return `<ul class="feedback-list">${items.map(item => `<li>${escape(item)}</li>`).join("")}</ul>`; }
function draftKey(id) { return `algo-practice:draft:${id}`; }
function readDraft(id) { try { return localStorage.getItem(draftKey(id)); } catch { return null; } }
function rememberDraft(id, code) { try { localStorage.setItem(draftKey(id), code); } catch { /* Server save remains available. */ } }
function clearDraft(id, code) { try { if (readDraft(id) === code) localStorage.removeItem(draftKey(id)); } catch { /* No storage permission. */ } }
function currentProblem() { return ["interview", "library", "training", "study", "entertainment"].includes(currentMode) ? undefined : (currentMode === "language" ? state.languageDrills ?? [] : state.problems).find(p => p.id === currentId); }
function currentCode(p = currentProblem()) { return hasEditor() && currentId === p?.id ? editorValue() : readDraft(p?.id) ?? p?.code ?? ""; }
function saveBadge(message, failed = false) { if ($("#save-state")) { $("#save-state").textContent = message; $("#save-state").classList.toggle("failed", failed); } }
async function persistCode(id, code) {
  rememberDraft(id, code);
  const language = state.languageDrills?.some(d => d.id === id);
  const save = saveQueue.catch(() => {}).then(async () => {
    if (language) await api(`/api/language-drills/${id}`, "PUT", { code });
    else await api(`/api/problems/${id}`, "PUT", { code });
    const p = (language ? state.languageDrills ?? [] : state.problems).find(p => p.id === id); if (p) p.code = code;
    clearDraft(id, code);
    if (currentId === id && hasEditor() && editorValue() === code) saveBadge(t("ui.savedLocally"));
  });
  saveQueue = save;
  try { await save; } catch (error) { if (currentId === id) saveBadge(t("ui.saveFailedClickToRetry"), true); throw error; }
}
async function flushCode() {
  await interviewPractice.flush();
  await trainingPractice.flush();
  await studyPractice.flush();
  clearTimeout(saveTimer);
  const p = currentProblem();
  if (p && hasEditor()) {
    const code = editorValue();
    if (code !== p.code || readDraft(p.id) !== null) await persistCode(p.id, code);
  }
  await saveQueue.catch(() => {});
}
function onCodeInput() {
  const p = currentProblem(); if (!p) return;
  const code = editorValue();
  rememberDraft(p.id, code); saveBadge(t("ui.saving"));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void persistCode(p.id, code).catch(() => {}); }, 650);
  const review = p.reviews?.find(r => r.id === selectedReview) ?? p.reviews?.at(-1);
  if (review && $("#changed-code")) $("#changed-code").hidden = review.code === code;
  teacher.sync();
}
function mountDraft(p, filename) {
  const draft = readDraft(p.id);
  mountEditor($("#code-editor"), { id: p.id, filename, language: p.language, value: draft ?? p.code, onChange: onCodeInput });
  if (draft !== null && draft !== p.code) {
    saveBadge(t("ui.restoredUnsavedCode")); void persistCode(p.id, draft).catch(() => {});
  }
}
function renderGenerator() {
  $("#page").innerHTML = pageHeading(t("chrome.aLittlePracticeEveryDay"), t("ui.turnYourIdeasIntoCode"), t("ui.chooseASuitableProblemAndStartThinkingFor"), `<div class="heading-note pressed"><span>✦</span> ${t("ui.hintsWhenYouNeedThemTakeYourTime")}</div>`) + `
    <section class="generator">
      <div class="card flat"><div class="section-heading"><div><h2>${t("ui.whatWillYouPracticeToday")}</h2><p class="card-subtitle">${t("ui.generateANewAlgorithmProblem")}</p></div><span class="section-number">${t("chrome.select")}</span></div>
        <form id="generator-form" class="generator-form">
          <div class="field"><label for="topic-select">${t("ui.topic")}</label><select id="topic-select">${options(config.topics, choice.topic)}</select></div>
          <div class="field"><span class="field-label" id="difficulty-label">${t("ui.difficulty")}</span><div class="difficulty-options" role="group" aria-labelledby="difficulty-label">${Object.entries(config.difficulties).map(([id, label]) => `<button type="button" data-difficulty="${id}" class="${choice.difficulty === id ? "selected" : ""}" aria-pressed="${choice.difficulty === id}"><span class="difficulty-dot"></span>${catalogText(label)}</button>`).join("")}</div></div>
          <div class="field"><label for="language-select">${t("ui.programmingLanguage")}</label><select id="language-select">${options(config.languages, choice.language)}</select></div>
          <button type="submit" class="button primary" data-ai><span>✧</span>${t("ui.generateAProblem")}<span>→</span></button>
          <p class="form-note">${account.authenticated ? t("ui.readyLeaveSomeRoomToThink") : t("ui.firstTimeConnectCodexInTheTopRight")}</p>
        </form>
      </div>
      <div class="card flat empty-editor"><div class="editor-window-bar"><i class="window-dot"></i><i class="window-dot"></i><i class="window-dot"></i><span class="window-title">your_next_challenge</span><span class="section-number">${t("chrome.think")}</span></div><div class="blank-sheet"><div><div class="blank-symbol pressed">&lt;/&gt;</div><h3>${t("ui.oneProblemANewWayToThink")}</h3><p>${t("ui.startWritingCodeHereOnceYourProblemIs")}<br>${t("ui.openTipsWhenYouNeedALittleDirection")}</p><div class="blank-decoration"></div></div></div></div>
    </section>
    <section class="practice-bottom"><a href="#history" class="mini-card flat"><span class="mini-icon convex">▤</span><div><h3>${t("ui.everyStepLeavesATrace")}</h3><p>${t("ui.revisitYourProblemsCodeAndHints")}</p></div><span>↗</span></a><a href="#analysis" class="mini-card flat"><span class="mini-icon convex">◴</span><div><h3>${t("ui.seeYourProgress")}</h3><p>${t("ui.understandYourProgressThroughActualPractice")}</p></div><span>↗</span></a></section>`;
  // Apply presentation through CSSOM so the page does not need inline-style permission.
  $(".editor-window-bar .section-number").style.marginLeft = "auto";
  $("#topic-select").onchange = event => { choice.topic = event.target.value; };
  $("#language-select").onchange = event => { choice.language = event.target.value; };
  elements("[data-difficulty]").forEach(button => button.onclick = () => {
    choice.difficulty = button.dataset.difficulty;
    elements("[data-difficulty]").forEach(item => { item.classList.toggle("selected", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  });
  $("#generator-form").onsubmit = event => { event.preventDefault(); void startTask("/api/problems", choice, "generate"); };
}
function renderWorkspace(p) {
  const filename = { javascript: "solution.js", typescript: "solution.ts", python: "solution.py", java: "Solution.java", kotlin: "Solution.kt", dart: "solution.dart", swift: "Solution.swift", go: "solution.go" }[p.language];
  $("#page").innerHTML = pageHeading(t("chrome.thinkItThrough"), t("ui.makeRoomForThinking"), t("ui.startWithYourOwnIdeasASmallHint"), `<a href="#practice" class="button flat">${t("ui.newPractice")}</a>`) + `
    <section class="workspace">
      <article class="card flat problem-panel"><div class="section-heading"><span class="eyebrow">${t("chrome.theChallenge")}</span><span class="section-number">${t("ui.problem")}</span></div>${tags(p)}<h2>${escape(p.title)}</h2><div class="problem-copy">${escape(p.description)}</div><h3 class="subheading">${t("ui.inputOutputExamples")}</h3>${p.examples.map((example, i) => `<div class="example pressed"><span class="eyebrow">${t("chrome.example")} ${i + 1}</span><code>${t("app.inputOutput", { value2: escape(example.input), value3: escape(example.output) })}</code><p>${escape(example.explanation)}</p></div>`).join("")}<h3 class="subheading">${t("ui.constraints")}</h3><ul class="constraints">${p.constraints.map(item => `<li>${escape(item)}</li>`).join("")}</ul></article>
      <div><section class="card flat editor-panel"><div class="editor-toolbar"><span class="language-label">⌘ ${filename}</span><button id="teacher-toggle" type="button" class="teacher-button" aria-pressed="false" aria-controls="teacher-panel">${t("ui.liveTeacher")}</button><button id="save-state" class="save-state" type="button">${t("ui.savedLocally")}</button></div><div class="code-wrap monaco-wrap"><div id="code-editor" class="monaco-host"></div></div><p class="editor-footnote">${t("ui.autoIndentBracketMatchingTabShiftTabIndentation")}</p><p class="evaluation-note">${t("ui.codexPerformsAStaticCodeReviewAfterSubmission")}</p><div class="editor-actions"><button id="hint-button" class="button mint" data-ai>${t("ui.giveMeAHint")}</button><button id="review-button" class="button primary" data-ai>${t("ui.submitForReview")}</button></div></section>
      <section class="card flat feedback-panel"><div class="feedback-tabs"><button class="feedback-tab ${feedbackTab === "hints" ? "active" : ""}" data-feedback="hints">${t("ui.thinkingHints")} <span>(${p.hints.length})</span></button><button class="feedback-tab ${feedbackTab === "review" ? "active" : ""}" data-feedback="review">${t("ui.reviewResults")} <span>(${p.reviews.length})</span></button></div><div id="feedback-content"></div></section></div>
    </section>`;
  mountDraft(p, filename);
  $("#teacher-toggle").onclick = () => { void teacher.activate(); };
  $("#save-state").onclick = () => { void flushCode().catch(error => toast(error.message)); };
  $("#hint-button").onclick = () => { void codeTask("hint"); };
  $("#review-button").onclick = () => { void codeTask("review"); };
  elements("[data-feedback]").forEach(button => button.onclick = () => {
    feedbackTab = button.dataset.feedback;
    elements("[data-feedback]").forEach(item => item.classList.toggle("active", item === button));
    renderFeedback(currentProblem());
  });
  renderFeedback(p);
}
function renderFeedback(p) {
  if (feedbackTab === "hints") {
    $("#feedback-content").innerHTML = p.hints.length ? [...p.hints].reverse().map((hint, i) => `<article class="hint"><div class="hint-head"><span>${t("app.hint", { value1: String(p.hints.length - i).padStart(2, "0") })}</span><span>${date(hint.at)}</span></div><div class="hint-label">${t("ui.codeObservation")}</div><p>${escape(hint.observation)}</p><div class="question"><small>${t("ui.thinkAboutIt")}</small>${escape(hint.question)}</div><div class="hint-label">${t("ui.checkItYourself")}</div><p>${escape(hint.checkpoint)}</p></article>`).join("") : `<div class="empty-small"><span class="symbol">✦</span>${t("ui.tryWritingSomeCodeFirst")}<br>${t("ui.tipsUseYourCurrentCodeToSuggestA")}</div>`;
    return;
  }
  if (!p.reviews.length) { $("#feedback-content").innerHTML = `<div class="empty-small"><span class="symbol">◎</span>${t("ui.writeYourAnswerThenSubmitItForReview")}<br>${t("ui.reviewCorrectnessComplexityEdgeCasesAndClarity")}</div>`; return; }
  const review = p.reviews.find(r => r.id === selectedReview) ?? p.reviews.at(-1);
  selectedReview = review.id;
  $("#feedback-content").innerHTML = `<div class="review-versions"><label for="review-version">${t("ui.submissions")}</label><select id="review-version">${[...p.reviews].reverse().map((r, i) => `<option value="${r.id}" ${r.id === review.id ? "selected" : ""}>${t("app.attempt", { value3: p.reviews.length - i, value4: date(r.at) })}</option>`).join("")}</select></div><div id="changed-code" class="stale-note" ${review.code === currentCode(p) ? "hidden" : ""}>${t("ui.yourCodeChangedTheseResultsReflectTheSubmitted")}</div><div class="review-head"><span class="tag ${review.verdict === "solid" ? "easy" : "medium"}">${verdictLabels[review.verdict]}</span><span class="review-score">${review.score}<small> / 100</small></span></div><p class="review-summary">${escape(review.summary)}</p><div class="dimensions">${Object.entries({ correctness: t("ui.correctness"), complexity: t("ui.complexity"), edgeCases: t("ui.edgeCases"), clarity: t("ui.codeClarity") }).map(([key, label]) => `<div class="dimension"><div><span>${label}</span><span>${review.dimensions[key]}</span></div><div class="progress-track"><span data-progress="${review.dimensions[key]}"></span></div></div>`).join("")}</div><h3 class="subheading">${t("ui.whatYouDidWell")}</h3>${list(review.strengths)}<h3 class="subheading">${t("ui.worthThinkingAbout")}</h3>${list(review.gaps)}<h3 class="subheading">${t("ui.nextStep")}</h3>${list(review.nextSteps)}<details class="review-code"><summary>${t("ui.viewSubmittedCode")}</summary><pre class="pressed">${escape(review.code)}</pre></details><p class="evaluation-note">${t("app.hintsUsedBeforeThisReviewHints", { value12: escape(catalogText(state.reviewLabel)), hintsUsed: review.hintsUsed })}</p>`;
  $("#review-version").onchange = event => { selectedReview = event.target.value; renderFeedback(p); };
  applyProgress();
}
function applyProgress() { elements("[data-progress]").forEach(el => { el.style.width = `${Number(el.dataset.progress)}%`; }); }
function statsRow() {
  const stats = state.stats;
  return `<section class="stats-row">${[
    [t("ui.practiceProblems"), stats.total, t("ui.problems"), t("ui.everyProblemLeavesARecord")],
    [t("ui.reviewedProblems"), stats.reviewed, t("ui.problems"), t("ui.latestReviewForEachProblem")],
    [t("ui.averageReferenceScore"), stats.average ?? "—", stats.average === null ? "" : "/ 100", t("ui.aIStaticReviewReference")],
    [t("ui.thinkingHints"), stats.hints, t("ui.times"), t("ui.aNewDirectionWhenYouGetStuck")],
  ].map(([label, value, unit, caption]) => `<div class="stat-card flat"><span class="stat-label">${label}</span><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-caption">${caption}</div></div>`).join("")}</section>`;
}
function renderHistory() {
  $("#page").innerHTML = pageHeading(t("chrome.yourPracticeJournal"), t("ui.everyStepIsWorthRevisiting"), t("ui.problemsCodeHintsAndReviewsAllInOne"), `<a class="button flat" href="#practice">${t("ui.newPractice")}</a>`) + statsRow() + `<div class="filters"><label for="history-search" class="sr-only">${t("ui.searchProblems")}</label><input id="history-search" placeholder="${t("ui.searchProblemTitles")}" value="${escape(historyFilter.search)}"><label for="history-topic" class="sr-only">${t("ui.filterByTopic")}</label><select id="history-topic">${options(config.topics, historyFilter.topic, t("ui.allTopics"))}</select><label for="history-status" class="sr-only">${t("ui.filterByStatus")}</label><select id="history-status"><option value="">${t("ui.allStatuses")}</option><option value="draft" ${historyFilter.status === "draft" ? "selected" : ""}>${t("ui.notReviewed")}</option><option value="reviewed" ${historyFilter.status === "reviewed" ? "selected" : ""}>${t("ui.reviewed2")}</option></select></div><div id="history-list" class="history-list"></div>`;
  $("#history-search").oninput = event => { historyFilter.search = event.target.value; renderHistoryList(); };
  $("#history-topic").onchange = event => { historyFilter.topic = event.target.value; renderHistoryList(); };
  $("#history-status").onchange = event => { historyFilter.status = event.target.value; renderHistoryList(); };
  renderHistoryList();
}
function renderHistoryList() {
  const problems = [...state.problems].reverse().filter(p => p.title.toLowerCase().includes(historyFilter.search.toLowerCase()) && (!historyFilter.topic || p.topic === historyFilter.topic) && (!historyFilter.status || (historyFilter.status === "reviewed" ? p.reviews.length : !p.reviews.length)));
  $("#history-list").innerHTML = problems.length ? problems.map((p, i) => {
    const review = p.reviews.at(-1);
    return `<button class="history-item flat" data-problem="${p.id}"><span class="history-index">${String(i + 1).padStart(2, "0")}</span><div><h3 class="history-title">${escape(p.title)}</h3>${tags(p)}<div class="history-meta">${t("app.hintsSubmissions", { value5: date(p.updatedAt), value6: p.hints.length + (p.teacherHints ?? 0), length: p.reviews.length, value8: review && review.code !== p.code ? t("app.message2") : "" })}</div></div><div class="history-score">${review ? `<span class="score-number">${review.score}</span>${verdictLabels[review.verdict]}` : t("ui.continuePractice")}</div><span class="history-arrow">↗</span></button>`;
  }).join("") : `<section class="card flat history-empty"><span class="blank-symbol pressed">▤</span><h2>${state.problems.length ? t("ui.noMatchingProblems") : t("ui.yourPracticeHistoryStartsWithTheFirstProblem")}</h2><p>${state.problems.length ? t("ui.tryAdjustingYourSearch") : t("ui.generatedProblemsAndYourCodeAreSavedAutomatically")}</p><a class="button primary" href="#practice">${t("ui.startPractice2")}</a></section>`;
  elements("[data-problem]").forEach(button => button.onclick = () => { location.hash = `practice/${button.dataset.problem}`; });
}
function renderAnalysis() {
  const analysis = state.analysis;
  $("#page").innerHTML = pageHeading(t("chrome.understandYourProgress"), t("ui.knowWhatYouUnderstandAndWhatComesNext"), t("ui.basedOnActualPracticeWithoutGuessingUntestedSkills"), `<button class="button primary" id="analysis-button" data-ai>${t("ui.updateAnalysis")}</button>`) + statsRow() + `<section class="analysis-layout"><article class="card flat"><div class="section-heading"><div><h2>${t("ui.progressByTopic")}</h2><p class="card-subtitle">${t("ui.averageScoreFromEachProblemSLatestStatic")}</p></div><span class="section-number">${t("chrome.byTopic")}</span></div><div class="sample-note">${state.stats.reviewed ? `${t("app.currentlyReviewedProblemsScoresReflectCodeQualityUnderstanding", { reviewed: state.stats.reviewed })}` : t("ui.noReviewedProblemsYetCompleteAndSubmitOne")}</div><div class="mastery-list">${state.stats.topics.map(topic => `<div><div class="mastery-top"><span>${catalogText(topic.label)}</span><span class="${topic.score === null ? "unknown" : ""}">${topic.score === null ? t("ui.noReviewsYet") : `${topic.score} / 100`}</span></div><div class="progress-track"><span data-progress="${topic.score ?? 0}"></span></div><div class="mastery-meta">${topic.count ? `${t("app.samplesHintsBeforeLatestSubmissionHints", { count: topic.count, hints: topic.hints, value3: topic.count < 3 ? t("app.message") : "" })}` : t("ui.insufficientEvidence")}</div></div>`).join("")}</div></article><article class="card flat analysis-card"><div class="section-heading"><div><h2>${t("ui.yourLearningProfile")}</h2><p class="card-subtitle">${t("ui.codexAnalyzesYourActualPracticeRecords")}</p></div><span class="section-number">${t("chrome.insights")}</span></div>${analysis ? `${state.analysisStale ? `<div class="stale-note">${t("ui.yourRecordsChangedUpdateAnalysisToRefreshYour")}</div>` : ""}<p class="analysis-summary">${escape(analysis.summary)}</p><h3 class="subheading">${t("ui.establishedStrengths")}</h3>${list(analysis.strengths)}<h3 class="subheading">${t("ui.areasToReinforce")}</h3>${list(analysis.gaps)}<h3 class="subheading">${t("ui.nextPractice")}</h3>${list(analysis.nextSteps)}<div class="analysis-update">${t("app.updatedBasedOnReviewedProblems", { value6: date(analysis.at), reviewedProblems: analysis.reviewedProblems })}<br>${escape(catalogText(state.reviewLabel))}</div>` : `<div class="analysis-empty"><div class="blank-symbol pressed">◴</div><h2>${t("ui.buildALittleActualPracticeFirst")}</h2><p>${state.stats.reviewed ? t("ui.updateAnalysisToSeeYourStrengthsAndAreas") : `${t("ui.solveAProblemThinkItThroughAndSubmit")}<br>${t("ui.yourLearningProfileGrowsFromTheseActualRecords")}`}</p><a class="button flat" href="#${state.stats.reviewed ? "history" : "practice"}">${state.stats.reviewed ? t("ui.viewPracticeHistory") : t("ui.practiceAProblem")} →</a></div>`}</article></section>`;
  $("#analysis-button").onclick = () => { void startTask("/api/analysis", {}, "analysis"); };
  applyProgress();
}
function settingsDraft() {
  return { uiLanguage: $('#ui-language').value, userLanguage: $('#user-language').value, visibleModels: [...elements('[data-model-visibility]:checked')].map(input => (/** @type {HTMLInputElement} */ (input)).value), teacher: { trigger: $('#teacher-trigger').value, idleSeconds: Number($('#teacher-idle-seconds').value) } };
}
function renderSettings(draft = settings) {
  const { visibleModels, teacher: teacherSettings } = draft;
  $('#page').innerHTML = pageHeading(t("chrome.yourPreferences"), t("ui.settings"), t("ui.setLanguagesPreferredModelsAndLiveTeacherTriggers")) + `
    ${createSetup({ api, escape, getAccount: () => account }).markup()}
    <section class="card flat voice-settings"><div class="section-heading"><div><h2>${t("ui.voiceDemo")}</h2><p class="card-subtitle">${t("ui.testVoiceConversationsAndConnectivity")}</p></div><a class="button flat" href="#settings/voice">${t("ui.openVoiceDemo")}</a></div></section>
    <section class="card flat model-settings"><h2>${t("ui.visibleModels")}</h2><p class="card-subtitle">${t("ui.checkedModelsAppearInTheTopBarChat")}</p>
      <form id="model-settings-form"><fieldset class="model-settings-list"><legend class="visually-hidden">${t("ui.chooseVisibleCodexModels")}</legend>${config.models.map(model => `<label class="model-setting-row"><input type="checkbox" data-model-visibility value="${escape(model.id)}" ${visibleModels.includes(model.id) || model.id === account.model ? 'checked' : ''} ${model.id === account.model ? 'disabled' : ''}><span>${escape(model.name)}</span>${model.id === account.model ? `<small>${t("ui.current")}</small>` : ''}</label>`).join('')}</fieldset>
      <fieldset class="teacher-settings language-settings"><legend>${t("ui.languageSettings")}</legend><div class="teacher-settings-fields"><div class="field"><label for="ui-language">${t("ui.uILanguage")}</label><select id="ui-language" aria-describedby="ui-language-note">${Object.entries(LOCALES).map(([id, label]) => `<option value="${id}" ${id === draft.uiLanguage ? 'selected' : ''}>${label}</option>`).join('')}</select><p id="ui-language-note" class="form-note">${t("ui.languageForMenusButtonsAndInterfaceMessages")}</p></div><div class="field"><label for="user-language">${t("ui.userLanguage")}</label><select id="user-language" aria-describedby="user-language-note">${Object.entries(LOCALES).map(([id, label]) => `<option value="${id}" ${id === draft.userLanguage ? 'selected' : ''}>${label}</option>`).join('')}</select><p id="user-language-note" class="form-note">${t("ui.languageForAIGeneratedQuestionsExplanationsFeedbackAnd")}</p></div></div><p class="card-subtitle">${t("ui.theseSettingsAreIndependentExistingContentKeepsIts")}</p></fieldset>
      <fieldset class="teacher-settings"><legend>${t("ui.liveTeacher2")}</legend><div class="teacher-settings-fields"><div class="field"><label for="teacher-trigger">${t("ui.analysisTrigger")}</label><select id="teacher-trigger"><option value="idle" ${teacherSettings.trigger === 'idle' ? 'selected' : ''}>${t("ui.analyzeAfterInactivity")}</option><option value="manual" ${teacherSettings.trigger === 'manual' ? 'selected' : ''}>${t("ui.manualAnalysisOnly")}</option></select></div><div class="field"><label for="teacher-idle-seconds">${t("ui.inactivityWaitSeconds")}</label><input id="teacher-idle-seconds" type="number" min="1" max="3600" step="1" required value="${escape(teacherSettings.idleSeconds)}" ${teacherSettings.trigger === 'manual' ? 'disabled' : ''}></div></div><p id="teacher-settings-note" class="card-subtitle"></p></fieldset>
      <div class="settings-actions"><span id="settings-message" role="status">${t("app.visibleModels", { length: settings.visibleModels.length, length10: config.models.length })}</span><button id="settings-save" class="button primary" type="submit">${t("ui.saveSettings")}</button></div></form>
    </section>`;
  function teacherNote() {
    const manual = $('#teacher-trigger').value === 'manual';
    $('#teacher-idle-seconds').disabled = manual;
    $('#teacher-settings-note').textContent = manual ? t("ui.typingDoesNotTriggerAnalysisClickAnalyzeCurrent") : t("ui.byDefaultAnalysisStartsAfterSecondsOfInactivity");
  }
  void createSetup({ api, escape, getAccount: () => account }).bind();
  teacherNote();
  $('#model-settings-form').onchange = () => { teacherNote(); $('#settings-message').textContent = t("ui.settingsChangedSaveToApply"); };
  $('#model-settings-form').onsubmit = async event => {
    event.preventDefault();
    if (activeJob || actionPending || modelPending) return;
    const draft = settingsDraft();
    modelPending = true; updateButtons();
    $('#settings-message').textContent = t("ui.saving");
    try {
      settings = await api('/api/settings', 'PUT', draft);
      const languageChanged = settings.uiLanguage !== uiLanguage();
      setLanguages(settings);
      if (languageChanged) { location.reload(); return; }
      setAccount(account);
      if ($('#settings-message')) $('#settings-message').textContent = `${t("app.savedVisibleModels", { length: settings.visibleModels.length, length2: config.models.length })}`;
      toast(t("ui.settingsSaved"));
    } catch (error) {
      if ($('#settings-message')) $('#settings-message').textContent = error.message;
      toast(error.message);
    } finally { modelPending = false; updateButtons(); }
  };
}
function render() {
  if (!config || !state || !account) return;
  const parts = location.hash.slice(1).split("/"), page = ["history", "analysis", "language", "interview", "library", "training", "study", "breadth", "entertainment", "voice", "settings"].includes(parts[0]) ? parts[0] : "practice";
  const voicePage = page === 'voice' || (page === 'settings' && parts[1] === 'voice');
  const nextMode = voicePage ? 'voice' : page === 'breadth' ? 'study' : ["language", "interview", "library", "training", "study", "entertainment"].includes(page) ? page : "algorithm";
  const records = nextMode === "study" ? state.studyBatches ?? [] : nextMode === "training" ? state.trainings ?? [] : nextMode === "library" ? state.library ?? [] : nextMode === "interview" ? state.interviews ?? [] : nextMode === "language" ? state.languageDrills ?? [] : state.problems;
  const nextId = ["practice", "language", "interview", "library", "training", "study", "breadth"].includes(page) && records.some(p => p.id === parts[1]) ? parts[1] : null;
  const keepWorkspace = nextId && nextId === currentId && currentMode === nextMode && (nextMode === "study" ? studyPractice.hasWorkspace() : nextMode === "training" ? trainingPractice.hasWorkspace() : nextMode === "library" ? library.hasWorkspace() : nextMode === "interview" ? interviewPractice.hasWorkspace() : hasEditor());
  if (!keepWorkspace) { unmountEditor(nextId); languagePractice.dispose(); interviewPractice.dispose(); library.dispose(); trainingPractice.dispose(); studyPractice.dispose(); breadthPractice.dispose(); }
  if (page !== "entertainment") entertainment.dispose();
  if (!voicePage) voiceDemo.dispose();
  currentId = nextId;
  currentMode = nextMode;
  const navigationPage = voicePage ? 'settings' : page;
  elements(".nav-item").forEach(item => { item.classList.toggle("active", item.dataset.page === navigationPage); if (item.dataset.page === navigationPage) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); });
  $("#breadcrumb-current").textContent = { practice: t("ui.startPractice"), history: t("ui.practiceHistory2"), analysis: t("ui.learningAnalysis"), language: t("ui.languagePractice"), interview: t("ui.interviewPractice"), library: t("ui.localLibrary"), training: t("ui.skillsTraining"), study: t("ui.dailyReview"), breadth: t("ui.technicalBreadth"), entertainment: t("ui.exploreCards"), voice: t("ui.voiceDemo"), settings: t("ui.settings") }[page];
  if (voicePage) $("#breadcrumb-current").textContent = t("ui.settings")+' / '+t("ui.voiceDemo");
  $("#history-count").textContent = state.problems.length;
  if (keepWorkspace) {
    if (currentMode === "study") { studyPractice.completed(); updateButtons(); return; }
    if (currentMode === "training") { trainingPractice.renderFeedback(records.find(r => r.id === currentId)); updateButtons(); return; }
    if (currentMode === "library") { updateButtons(); return; }
    if (currentMode === "interview") { interviewPractice.renderFeedback(records.find(s => s.id === currentId)); updateButtons(); return; }
    if (currentMode === "language") { updateButtons(); return; }
    const p = currentProblem();
    elements("[data-feedback]").forEach(button => {
      const hints = button.dataset.feedback === "hints";
      button.innerHTML = `${hints ? t("ui.thinkingHints") : t("ui.reviewResults")} <span>(${hints ? p.hints.length : p.reviews.length})</span>`;
      button.classList.toggle("active", button.dataset.feedback === feedbackTab);
    });
    renderFeedback(p); updateButtons(); return;
  }
  if (voicePage) voiceDemo.render();
  else if (page === "settings") renderSettings();
  else if (page === "entertainment") entertainment.render();
  else if (page === "breadth") { if (nextId) studyPractice.renderWorkspace(records.find(r => r.id === nextId)); else void breadthPractice.renderHub(); }
  else if (page === "study") { if (nextId) studyPractice.renderWorkspace(records.find(r => r.id === nextId)); else void studyPractice.renderHub(); }
  else if (page === "training") { if (nextId) trainingPractice.renderWorkspace(records.find(r => r.id === nextId)); else trainingPractice.renderHub(parts[1]); }
  else if (page === "library") { if (nextId) void library.renderDetail(nextId); else library.renderList(); }
  else if (page === "interview") { if (nextId) interviewPractice.renderWorkspace(records.find(s => s.id === nextId)); else interviewPractice.renderGenerator(); }
  else if (page === "language") { if (currentProblem()) languagePractice.renderWorkspace(currentProblem()); else languagePractice.renderGenerator(); }
  else if (page === "history") renderHistory();
  else if (page === "analysis") renderAnalysis();
  else if (currentProblem()) renderWorkspace(currentProblem());
  else { currentId = null; renderGenerator(); }
  updateButtons();
}
async function refreshState() { state = await api("/api/state"); }
/** @param {'hint' | 'review'} kind */
async function codeTask(kind) {
  const p = currentProblem(); if (!p) return;
  const code = currentCode(p);
  try { await flushCode(); await startTask(`/api/problems/${p.id}/${kind}`, { code }, kind); }
  catch (error) { toast(error.message); }
}
/** @param {import('../src/generated/api-client.js').TaskPath} path */
async function startTask(path, body, kind, options = {}) {
  if ((activeJob && activeJob.kind !== 'teacher') || actionPending || modelPending) return;
  if (!account.authenticated) { if (!options.quiet) { toast(t("ui.connectCodexBeforeStartingPractice")); await beginLogin(); } return; }
  if (kind === "analysis" && !state.stats.reviewed) { toast(t("ui.submitOneProblemForReviewBeforeAnalyzingYour")); return; }
  actionPending = true; updateButtons();
  try {
    if (activeJob?.kind === 'teacher') await stopTeacher();
    if (kind !== "chat" && kind !== "teacher") await flushCode();
    const { jobId } = await requestTask(api, path, body, errorText);
    watchTask(jobId, kind, options);
    return { jobId };
  } catch (error) { if (!options.quiet) toast(error.message); }
  finally { actionPending = false; updateButtons(); }
}
async function stopTeacher() {
  const job = activeJob;
  if (job?.kind !== 'teacher') return;
  await api(`/api/jobs/${job.id}/abort`, 'POST', {});
  if (activeJob?.id === job.id) {
    taskSource?.close(); clearInterval(pollTimer); taskSource = null; activeJob = null;
  }
  await teacher.refresh();
}
function watchTask(id, kind, details = {}) {
  taskSource?.close(); clearInterval(pollTimer);
  activeJob = { id, kind, ...(details.chatId ? { chatId: details.chatId } : {}) }; updateButtons();
  $("#task-message").textContent = t("ui.codexIsThinking");
  $("#task-cancel").disabled = false;
  $("#task-cancel").textContent = t("ui.cancel");
  const source = new EventSource(`/api/jobs/${id}/events`); taskSource = source;
  let ended = false, polling = false, localPoll;
  const finish = async (type, data) => {
    if (ended) return; ended = true;
    source.close(); clearInterval(localPoll);
    if (taskSource !== source) return;
    taskSource = null;
    if (activeJob?.id === id) activeJob = null;
    try {
      if (kind === 'teacher') { await refreshState(); await teacher.refresh(); return; }
      if (kind === "chat") { await refreshState(); await chat.refresh(); return; }
      await flushCode(); await refreshState();
      if (type === "done") {
        if (kind === "hint") feedbackTab = "hints";
        if (kind === "review") { feedbackTab = "review"; selectedReview = null; }
        if (kind === "generate" && data.result?.problemId) { location.hash = `practice/${data.result.problemId}`; }
        if (kind === "language" && data.result?.drillId) { location.hash = `language/${data.result.drillId}`; }
        if (kind === "interview" && data.result?.interviewId) { location.hash = `interview/${data.result.interviewId}`; }
        if (kind === "interview-review") interviewPractice.reviewCompleted();
        if (kind === "library") await library.taskCompleted();
        if (kind === "training") { if (data.result?.created) location.hash = `training/${data.result.trainingId}`; else trainingPractice.completed(); }
        if (kind === "study" && data.result?.batchId) location.hash = `${state.studyBatches.find(b => b.id === data.result.batchId)?.selection.breadth ? 'breadth' : 'study'}/${data.result.batchId}`;
        if (kind === "study-review") studyPractice.completed();
        render();
        toast(kind === "library" ? `${t("app.libraryOrganizedSucceeded", { value1: data.result?.libraryIds?.length ?? 0, value2: data.result?.failedIds?.length ? `${t("app.needRetry", { length: data.result.failedIds.length })}` : "" })}` : { study: t("ui.quizReadyTryAnsweringIndependentlyFirst"), "study-review": t("ui.feedbackAndTheNextReviewTimeHaveBeen"), "study-import": t("ui.knowledgePointsExtractedBrowseThemInTheCatalog"), training: t("ui.trainingResultsSavedReviewThemAndKeepPracticing"), generate: t("ui.problemReadyStartThinking"), hint: t("ui.aSmallHintIsReady"), review: t("ui.reviewSavedForLaterReference"), analysis: t("ui.learningProfileUpdated"), language: t("ui.languagePracticeTemplatesAndExplanationsAreReady"), interview: t("ui.interviewQuestionsAndKeyPointsAreReady"), "interview-review": t("ui.answerFeedbackSavedReviewEachQuestion") }[kind]);
      } else { render(); toast(data.message || t("ui.taskEnded")); }
    } catch (error) { toast(error.message); }
    finally { updateButtons(); }
  };
  source.addEventListener("progress", event => { $("#task-message").textContent = eventData('progress', event).message; });
  source.addEventListener("chat-start", event => { (kind === 'teacher' ? teacher : chat).receiveTurn(eventData('chat-start', event)); });
  source.addEventListener("message", event => { (kind === 'teacher' ? teacher : chat).receive(eventData('message', event)); });
  source.addEventListener("done", event => { void finish("done", eventData('done', event)); });
  source.addEventListener("aborted", event => { void finish("aborted", eventData('aborted', event)); });
  source.addEventListener("error", event => { if ((/** @type {MessageEvent<string>} */ (event)).data) void finish("error", eventData('error', /** @type {MessageEvent<string>} */ (event))); });
  pollTimer = localPoll = setInterval(async () => {
    if (ended || polling) return; polling = true;
    try {
      const job = await api(`/api/jobs/${id}`);
      if (job.status !== "running") void finish(job.status, { result: job.result, message: job.error || (job.status === "aborted" ? t("ui.taskCanceled") : undefined) });
    } catch (error) { if (source.readyState === EventSource.CLOSED) void finish("error", { message: error.message }); }
    finally { polling = false; }
  }, 3000);
}
$("#task-cancel").onclick = async () => {
  if (!activeJob) return;
  $("#task-cancel").disabled = true; $("#task-cancel").textContent = t("ui.canceling");
  try { await api(`/api/jobs/${activeJob.id}/abort`, "POST", {}); }
  catch (error) { toast(error.message); $("#task-cancel").disabled = false; }
};

async function selectModel(model) {
  if ((activeJob && activeJob.kind !== 'teacher') || actionPending || modelPending) return;
  const draft = location.hash === '#settings' ? settingsDraft() : null;
  modelPending = true; updateButtons();
  try {
    await stopTeacher();
    setAccount(await api("/api/model", "PUT", { model }));
    if (location.hash === '#settings') { renderSettings(draft ?? settings); updateButtons(); }
    toast(`${t("app.switchedToFutureAIRequestsUseThisModel", { model: config.models.find(option => option.id === account.model)?.name ?? account.model })}`);
  } catch (error) { toast(error.message); }
  finally { modelPending = false; updateButtons(); }
}

function authorizedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "auth.openai.com" || url.hostname === "openai.com" || url.hostname.endsWith(".openai.com"))) throw new Error(t("ui.invalidAuthorizationURL"));
  return url.href;
}
async function beginLogin() {
  if (loginId && authSource) { $("#auth-dialog").showModal(); return; }
  $("#auth-dialog").showModal();
  $("#auth-message").textContent = t("ui.preparingAuthorization");
  $("#auth-link").hidden = true; $("#manual-auth").hidden = true; $("#device-code").hidden = true; $("#auth-value").value = "";
  // Open in the click gesture. If popups are blocked, the visible link still works.
  authPopup = window.open("about:blank", "_blank"); if (authPopup) authPopup.opener = null;
  try {
    const { id } = await api("/api/auth/login", "POST", {}); loginId = id;
    const source = new EventSource(`/api/auth/${id}/events`); authSource = source;
    const handleUrl = data => {
      try {
        const url = authorizedUrl(data.url); $("#auth-link").href = url; $("#auth-link").hidden = false;
        $("#auth-message").textContent = t("ui.signInOnTheOpenAIAuthorizationPageConnection");
        if (authPopup && !authPopup.closed) authPopup.location = url;
      } catch (error) { $("#auth-message").textContent = error.message; }
    };
    source.addEventListener("auth_url", event => handleUrl(eventData('auth_url', event)));
    source.addEventListener("device_code", event => { const data = eventData('device_code', event); handleUrl(data); $("#device-code").textContent = data.code; $("#device-code").hidden = false; });
    source.addEventListener("prompt", event => { const data = eventData('prompt', event); authPromptId = data.id; $("#manual-auth").hidden = false; });
    source.addEventListener("prompt_cancelled", () => { authPromptId = null; $("#manual-auth").hidden = true; });
    source.addEventListener("progress", event => { if ($("#auth-link").hidden) $("#auth-message").textContent = eventData('progress', event).message; });
    source.addEventListener("done", async () => {
      source.close(); authSource = null; loginId = null; authPromptId = null;
      setAccount(await api("/api/auth/status")); $("#auth-dialog").close(); toast(t("ui.codexConnectedYouCanStartPracticing")); render();
    });
    source.addEventListener("error", event => {
      if (!(/** @type {MessageEvent<string>} */ (event)).data) { $("#auth-message").textContent = t("ui.restoringAuthorization"); return; }
      source.close(); authSource = null; loginId = null; authPromptId = null;
      $("#auth-message").textContent = eventData('error', /** @type {MessageEvent<string>} */ (event)).message;
      $("#auth-link").hidden = true; $("#manual-auth").hidden = true;
    });
  } catch (error) { authPopup?.close(); $("#auth-message").textContent = error.message; }
}
$("#auth-button").onclick = () => { void beginLogin(); };
$("#auth-close").onclick = () => $("#auth-dialog").close();
$("#auth-cancel").onclick = async () => {
  try { await api("/api/auth/cancel", "POST", {}); authSource?.close(); authSource = null; loginId = null; authPromptId = null; authPopup?.close(); $("#auth-dialog").close(); }
  catch (error) { $("#auth-message").textContent = error.message; }
};
$("#auth-form").onsubmit = async event => {
  event.preventDefault(); if (!loginId || !authPromptId) return;
  const button = $("#auth-form button"); button.disabled = true;
  try { await api(`/api/auth/${loginId}/answer`, "POST", { promptId: authPromptId, value: $("#auth-value").value }); $("#auth-value").value = ""; $("#auth-message").textContent = t("ui.checkingAuthorization"); }
  catch (error) { $("#auth-message").textContent = error.message; }
  finally { button.disabled = false; }
};
window.addEventListener("hashchange", async () => {
  // The editor still represents the old question until render changes currentId.
  try { await flushCode(); } catch (error) { toast(`${t("app.unsavedCodeKeptInThisBrowser", { message: error.message })}`); }
  selectedReview = null; render();
});
window.addEventListener("beforeunload", () => { interviewPractice.remember(); trainingPractice.remember(); studyPractice.remember(); if (currentProblem() && hasEditor()) rememberDraft(currentId, editorValue()); });
async function init() {
  try {
    [config, state, account, settings] = await Promise.all([api("/api/config"), api("/api/state"), api("/api/auth/status"), api("/api/settings")]);
    setLanguages(settings);
    if (!location.hash && !account.authenticated && !state.problems.length && !(state.interviews?.length)) location.hash = '#settings';
    setAccount(account); render();
    await chat.init(state.activeJob);
    if (state.activeJob) watchTask(state.activeJob.id, state.activeJob.kind, state.activeJob);
    await teacher.init(state.activeJob);
  } catch (error) {
    $("#page").innerHTML = `<section class="card flat history-empty"><h2>${t("ui.cannotConnectToTheLocalService")}</h2><p>${escape(error.message)}</p><button id="retry-init" class="button primary">${t("ui.reconnect")}</button></section>`;
    $("#retry-init").onclick = init;
  }
}
void init();
