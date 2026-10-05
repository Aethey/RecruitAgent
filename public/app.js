import { element, elements } from './dom.ts';
import { createApiClient, eventData, requestTask } from './api.ts';
import { t, ui, LOCALES, languageTag, uiLanguage, setLanguages, localizeShell } from "./i18n.js";
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

const api = createApiClient(t);
localizeShell();

const appShell = element('.app-shell');
const sidebarToggle = element('#sidebar-toggle');
const sidebarPreferenceKey = 'algo-practice:sidebar-collapsed';
function setSidebarCollapsed(collapsed) {
  appShell.dataset.sidebarCollapsed = String(collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', t(collapsed ? '展开侧边栏' : '收起侧边栏'));
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
  navToggle.setAttribute('aria-label', open ? t('收起学习模块菜单') : t('展开学习模块菜单'));
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
const verdictLabels = { "needs-work": t("还需打磨"), promising: t("思路渐清晰"), solid: t("静态评估扎实") };
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
  clearTimeout(toastTimer); $("#toast").textContent = t(message); $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 5000);
}
function setAccount(value) {
  account = value;
  $("#auth-dot").classList.toggle("muted", !account.authenticated);
  $("#auth-button-label").textContent = account.authenticated ? t("Codex 已连接") : t("连接 Codex");
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
  return (blank ? `<option value="">${t(blank)}</option>` : "") + Object.entries(values).map(([key, value]) => `<option value="${escape(key)}" ${key === selected ? "selected" : ""}>${escape(t(value))}</option>`).join("");
}
function tags(p) { return `<div class="tags"><span class="tag ${p.difficulty}">${t(config.difficulties[p.difficulty])}</span><span class="tag">${t(config.topics[p.topic])}</span><span class="tag">${config.languages[p.language]}</span></div>`; }
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
    if (currentId === id && hasEditor() && editorValue() === code) saveBadge(t("已保存到本机 ✓"));
  });
  saveQueue = save;
  try { await save; } catch (error) { if (currentId === id) saveBadge(t("保存失败 · 点击重试"), true); throw error; }
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
  rememberDraft(p.id, code); saveBadge(t("正在保存…"));
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
    saveBadge(t("恢复了未保存的代码…")); void persistCode(p.id, draft).catch(() => {});
  }
}
function renderGenerator() {
  $("#page").innerHTML = pageHeading("A LITTLE PRACTICE, EVERY DAY", t("把思路，写成代码。"), t("选一道适合你的题，从自己的思考开始。"), t('<div class="heading-note pressed"><span>✦</span> 按需提示，不急着揭晓答案</div>')) + ui`
    <section class="generator">
      <div class="card flat"><div class="section-heading"><div><h2>今天，练点什么？</h2><p class="card-subtitle">为你生成一道新的算法题</p></div><span class="section-number">01 / SELECT</span></div>
        <form id="generator-form" class="generator-form">
          <div class="field"><label for="topic-select">题型</label><select id="topic-select">${options(config.topics, choice.topic)}</select></div>
          <div class="field"><span class="field-label" id="difficulty-label">难度</span><div class="difficulty-options" role="group" aria-labelledby="difficulty-label">${Object.entries(config.difficulties).map(([id, label]) => `<button type="button" data-difficulty="${id}" class="${choice.difficulty === id ? "selected" : ""}" aria-pressed="${choice.difficulty === id}"><span class="difficulty-dot"></span>${t(label)}</button>`).join("")}</div></div>
          <div class="field"><label for="language-select">答题语言</label><select id="language-select">${options(config.languages, choice.language)}</select></div>
          <button type="submit" class="button primary" data-ai><span>✧</span>生成一道题<span>→</span></button>
          <p class="form-note">${account.authenticated ? t("准备好了？给思考留一点空间。") : t("首次使用，请先在右上角连接 Codex。")}</p>
        </form>
      </div>
      <div class="card flat empty-editor"><div class="editor-window-bar"><i class="window-dot"></i><i class="window-dot"></i><i class="window-dot"></i><span class="window-title">your_next_challenge</span><span class="section-number">02 / THINK</span></div><div class="blank-sheet"><div><div class="blank-symbol pressed">&lt;/&gt;</div><h3>一道题，一个新的思考。</h3><p>题目生成后，在这里开始写代码。<br>需要一点方向时，再打开 Tips。</p><div class="blank-decoration"></div></div></div></div>
    </section>
    <section class="practice-bottom"><a href="#history" class="mini-card flat"><span class="mini-icon convex">▤</span><div><h3>每一步，都有迹可循</h3><p>回看做过的题、代码和提示。</p></div><span>↗</span></a><a href="#analysis" class="mini-card flat"><span class="mini-icon convex">◴</span><div><h3>看见自己的进步</h3><p>从真实练习记录了解掌握情况。</p></div><span>↗</span></a></section>`;
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
  $("#page").innerHTML = pageHeading("THINK IT THROUGH", t("留一点空间，给思考。"), t("先写下你的思路。卡住的时候，一个小提示就够了。"), t('<a href="#practice" class="button flat">新练习 ＋</a>')) + ui`
    <section class="workspace">
      <article class="card flat problem-panel"><div class="section-heading"><span class="eyebrow">THE CHALLENGE</span><span class="section-number">题目</span></div>${tags(p)}<h2>${escape(p.title)}</h2><div class="problem-copy">${escape(p.description)}</div><h3 class="subheading">输入 / 输出示例</h3>${p.examples.map((example, i) => ui`<div class="example pressed"><span class="eyebrow">EXAMPLE ${i + 1}</span><code>输入：${escape(example.input)}\n输出：${escape(example.output)}</code><p>${escape(example.explanation)}</p></div>`).join("")}<h3 class="subheading">约束条件</h3><ul class="constraints">${p.constraints.map(item => `<li>${escape(item)}</li>`).join("")}</ul></article>
      <div><section class="card flat editor-panel"><div class="editor-toolbar"><span class="language-label">⌘ ${filename}</span><button id="teacher-toggle" type="button" class="teacher-button" aria-pressed="false" aria-controls="teacher-panel">✦ 实时教师</button><button id="save-state" class="save-state" type="button">已保存到本机 ✓</button></div><div class="code-wrap monaco-wrap"><div id="code-editor" class="monaco-host"></div></div><p class="editor-footnote">自动缩进 · 括号匹配 · Tab / Shift+Tab 调整缩进 · 自动保存</p><p class="evaluation-note">提交后由 Codex 进行静态代码评估</p><div class="editor-actions"><button id="hint-button" class="button mint" data-ai>✦ 给我一个 Tips</button><button id="review-button" class="button primary" data-ai>提交评估 →</button></div></section>
      <section class="card flat feedback-panel"><div class="feedback-tabs"><button class="feedback-tab ${feedbackTab === "hints" ? "active" : ""}" data-feedback="hints">思考提示 <span>(${p.hints.length})</span></button><button class="feedback-tab ${feedbackTab === "review" ? "active" : ""}" data-feedback="review">评估结果 <span>(${p.reviews.length})</span></button></div><div id="feedback-content"></div></section></div>
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
    $("#feedback-content").innerHTML = p.hints.length ? [...p.hints].reverse().map((hint, i) => ui`<article class="hint"><div class="hint-head"><span>✦ 提示 ${String(p.hints.length - i).padStart(2, "0")}</span><span>${date(hint.at)}</span></div><div class="hint-label">代码观察</div><p>${escape(hint.observation)}</p><div class="question"><small>想一想</small>${escape(hint.question)}</div><div class="hint-label">自己验证一下</div><p>${escape(hint.checkpoint)}</p></article>`).join("") : t('<div class="empty-small"><span class="symbol">✦</span>先试着写一写。<br>Tips 会结合你点击时的代码，给一个思考方向。</div>');
    return;
  }
  if (!p.reviews.length) { $("#feedback-content").innerHTML = t('<div class="empty-small"><span class="symbol">◎</span>写下你的答案，再提交评估。<br>从正确性、复杂度、边界和表达四个角度回看代码。</div>'); return; }
  const review = p.reviews.find(r => r.id === selectedReview) ?? p.reviews.at(-1);
  selectedReview = review.id;
  $("#feedback-content").innerHTML = ui`<div class="review-versions"><label for="review-version">提交记录</label><select id="review-version">${[...p.reviews].reverse().map((r, i) => ui`<option value="${r.id}" ${r.id === review.id ? "selected" : ""}>第 ${p.reviews.length - i} 次 · ${date(r.at)}</option>`).join("")}</select></div><div id="changed-code" class="stale-note" ${review.code === currentCode(p) ? "hidden" : ""}>代码已有修改。以下结果基于这次提交的版本，可再次提交获取新评估。</div><div class="review-head"><span class="tag ${review.verdict === "solid" ? "easy" : "medium"}">${verdictLabels[review.verdict]}</span><span class="review-score">${review.score}<small> / 100</small></span></div><p class="review-summary">${escape(review.summary)}</p><div class="dimensions">${Object.entries({ correctness: t("正确性"), complexity: t("复杂度"), edgeCases: t("边界条件"), clarity: t("代码表达") }).map(([key, label]) => `<div class="dimension"><div><span>${label}</span><span>${review.dimensions[key]}</span></div><div class="progress-track"><span data-progress="${review.dimensions[key]}"></span></div></div>`).join("")}</div><h3 class="subheading">做得好的地方</h3>${list(review.strengths)}<h3 class="subheading">还值得思考</h3>${list(review.gaps)}<h3 class="subheading">下一步</h3>${list(review.nextSteps)}<details class="review-code"><summary>查看本次提交的代码</summary><pre class="pressed">${escape(review.code)}</pre></details><p class="evaluation-note">${escape(t(state.reviewLabel))} 本次评估前使用了 ${review.hintsUsed} 个提示。</p>`;
  $("#review-version").onchange = event => { selectedReview = event.target.value; renderFeedback(p); };
  applyProgress();
}
function applyProgress() { elements("[data-progress]").forEach(el => { el.style.width = `${Number(el.dataset.progress)}%`; }); }
function statsRow() {
  const stats = state.stats;
  return `<section class="stats-row">${[
    [t("练习题目"), stats.total, t("道"), t("每一道，都留下记录")],
    [t("已提交评估"), stats.reviewed, t("道"), t("按题目去重，取最近评估")],
    [t("平均参考分"), stats.average ?? "—", stats.average === null ? "" : "/ 100", t("AI 静态评估参考")],
    [t("思考提示"), stats.hints, t("次"), t("在卡点，找到一个新方向")],
  ].map(([label, value, unit, caption]) => `<div class="stat-card flat"><span class="stat-label">${label}</span><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-caption">${caption}</div></div>`).join("")}</section>`;
}
function renderHistory() {
  $("#page").innerHTML = pageHeading("YOUR PRACTICE JOURNAL", t("每一步，都值得回看。"), t("题目、代码、提示和评估，留在同一个地方。"), t('<a class="button flat" href="#practice">新练习 ＋</a>')) + statsRow() + ui`<div class="filters"><label for="history-search" class="sr-only">搜索题目</label><input id="history-search" placeholder="搜索题目名称…" value="${escape(historyFilter.search)}"><label for="history-topic" class="sr-only">按题型筛选</label><select id="history-topic">${options(config.topics, historyFilter.topic, t("全部题型"))}</select><label for="history-status" class="sr-only">按状态筛选</label><select id="history-status"><option value="">全部状态</option><option value="draft" ${historyFilter.status === "draft" ? "selected" : ""}>尚未评估</option><option value="reviewed" ${historyFilter.status === "reviewed" ? "selected" : ""}>已有评估</option></select></div><div id="history-list" class="history-list"></div>`;
  $("#history-search").oninput = event => { historyFilter.search = event.target.value; renderHistoryList(); };
  $("#history-topic").onchange = event => { historyFilter.topic = event.target.value; renderHistoryList(); };
  $("#history-status").onchange = event => { historyFilter.status = event.target.value; renderHistoryList(); };
  renderHistoryList();
}
function renderHistoryList() {
  const problems = [...state.problems].reverse().filter(p => p.title.toLowerCase().includes(historyFilter.search.toLowerCase()) && (!historyFilter.topic || p.topic === historyFilter.topic) && (!historyFilter.status || (historyFilter.status === "reviewed" ? p.reviews.length : !p.reviews.length)));
  $("#history-list").innerHTML = problems.length ? problems.map((p, i) => {
    const review = p.reviews.at(-1);
    return ui`<button class="history-item flat" data-problem="${p.id}"><span class="history-index">${String(i + 1).padStart(2, "0")}</span><div><h3 class="history-title">${escape(p.title)}</h3>${tags(p)}<div class="history-meta">${date(p.updatedAt)} · ${p.hints.length + (p.teacherHints ?? 0)} 个提示 · ${p.reviews.length} 次提交${review && review.code !== p.code ? t(" · 代码有新修改") : ""}</div></div><div class="history-score">${review ? `<span class="score-number">${review.score}</span>${verdictLabels[review.verdict]}` : t("继续练习")}</div><span class="history-arrow">↗</span></button>`;
  }).join("") : ui`<section class="card flat history-empty"><span class="blank-symbol pressed">▤</span><h2>${state.problems.length ? t("没有匹配的题目") : t("你的练习记录，从第一道题开始。")}</h2><p>${state.problems.length ? t("试试调整搜索条件。") : t("生成的题目会自动记录，代码也会自动保存。")}</p><a class="button primary" href="#practice">开始练习 →</a></section>`;
  elements("[data-problem]").forEach(button => button.onclick = () => { location.hash = `practice/${button.dataset.problem}`; });
}
function renderAnalysis() {
  const analysis = state.analysis;
  $("#page").innerHTML = pageHeading("UNDERSTAND YOUR PROGRESS", t("知道掌握了什么，也知道下一步。"), t("以真实练习为依据，不为未练习的题型猜测分数。"), t('<button class="button primary" id="analysis-button" data-ai>✧ 更新分析</button>')) + statsRow() + ui`<section class="analysis-layout"><article class="card flat"><div class="section-heading"><div><h2>题型掌握概览</h2><p class="card-subtitle">各题最近一次静态评估的平均参考分</p></div><span class="section-number">BY TOPIC</span></div><div class="sample-note">${state.stats.reviewed ? ui`目前有 ${state.stats.reviewed} 道已评估题。分数反映代码表现；掌握情况还需结合样本量、难度和提示使用。` : t("还没有已评估题目。完成一道题并提交，才能形成分析依据。")}</div><div class="mastery-list">${state.stats.topics.map(topic => `<div><div class="mastery-top"><span>${t(topic.label)}</span><span class="${topic.score === null ? "unknown" : ""}">${topic.score === null ? t("尚无评估记录") : `${topic.score} / 100`}</span></div><div class="progress-track"><span data-progress="${topic.score ?? 0}"></span></div><div class="mastery-meta">${topic.count ? ui`${topic.count} 道样本 · 最近提交前共 ${topic.hints} 个提示${topic.count < 3 ? t(" · 仅供初步参考") : ""}` : t("证据不足，暂不判断")}</div></div>`).join("")}</div></article><article class="card flat analysis-card"><div class="section-heading"><div><h2>你的学习画像</h2><p class="card-subtitle">由 Codex 结合做题记录进行分析</p></div><span class="section-number">INSIGHTS</span></div>${analysis ? ui`${state.analysisStale ? t('<div class="stale-note">练习记录已更新，点击「更新分析」获取新的学习画像。</div>') : ""}<p class="analysis-summary">${escape(analysis.summary)}</p><h3 class="subheading">已经建立的掌握点</h3>${list(analysis.strengths)}<h3 class="subheading">还需巩固的地方</h3>${list(analysis.gaps)}<h3 class="subheading">下一步练习</h3>${list(analysis.nextSteps)}<div class="analysis-update">${date(analysis.at)} 更新 · 本次参考 ${analysis.reviewedProblems} 道已评估题<br>${escape(t(state.reviewLabel))}</div>` : ui`<div class="analysis-empty"><div class="blank-symbol pressed">◴</div><h2>先积累一点真实的练习。</h2><p>${state.stats.reviewed ? t("已有评估记录，点击「更新分析」，了解当前掌握点和薄弱点。") : t("完成题目、尝试思考、提交评估。<br>你的学习画像会从这些真实记录中长出来。")}</p><a class="button flat" href="#${state.stats.reviewed ? "history" : "practice"}">${state.stats.reviewed ? t("查看练习记录") : t("去练一道题")} →</a></div>`}</article></section>`;
  $("#analysis-button").onclick = () => { void startTask("/api/analysis", {}, "analysis"); };
  applyProgress();
}
function settingsDraft() {
  return { uiLanguage: $('#ui-language').value, userLanguage: $('#user-language').value, visibleModels: [...elements('[data-model-visibility]:checked')].map(input => (/** @type {HTMLInputElement} */ (input)).value), teacher: { trigger: $('#teacher-trigger').value, idleSeconds: Number($('#teacher-idle-seconds').value) } };
}
function renderSettings(draft = settings) {
  const { visibleModels, teacher: teacherSettings } = draft;
  $('#page').innerHTML = pageHeading('YOUR PREFERENCES', t('设置'), t('设置语言、常用模型和实时教师的分析方式。')) + ui`
    ${createSetup({ api, escape, getAccount: () => account }).markup()}
    <section class="card flat voice-settings"><div class="section-heading"><div><h2>语音 Demo</h2><p class="card-subtitle">测试语音对话与连接。</p></div><a class="button flat" href="#settings/voice">打开语音 Demo ↗</a></div></section>
    <section class="card flat model-settings"><h2>显示的模型</h2><p class="card-subtitle">勾选后显示在顶部、聊天与实时教师的模型菜单中。当前使用的模型需先切换，才能隐藏。</p>
      <form id="model-settings-form"><fieldset class="model-settings-list"><legend class="visually-hidden">选择显示的 Codex 模型</legend>${config.models.map(model => `<label class="model-setting-row"><input type="checkbox" data-model-visibility value="${escape(model.id)}" ${visibleModels.includes(model.id) || model.id === account.model ? 'checked' : ''} ${model.id === account.model ? 'disabled' : ''}><span>${escape(model.name)}</span>${model.id === account.model ? t('<small>当前使用</small>') : ''}</label>`).join('')}</fieldset>
      <fieldset class="teacher-settings language-settings"><legend>语言设置</legend><div class="teacher-settings-fields"><div class="field"><label for="ui-language">界面语言</label><select id="ui-language" aria-describedby="ui-language-note">${Object.entries(LOCALES).map(([id, label]) => `<option value="${id}" ${id === draft.uiLanguage ? 'selected' : ''}>${label}</option>`).join('')}</select><p id="ui-language-note" class="form-note">控制菜单、按钮和界面提示。</p></div><div class="field"><label for="user-language">用户语言</label><select id="user-language" aria-describedby="user-language-note">${Object.entries(LOCALES).map(([id, label]) => `<option value="${id}" ${id === draft.userLanguage ? 'selected' : ''}>${label}</option>`).join('')}</select><p id="user-language-note" class="form-note">AI 生成的题目、讲解、评价和聊天回复使用此语言。</p></div></div><p class="card-subtitle">两个设置独立保存；已有内容保留原文，新的 AI 内容跟随用户语言。</p></fieldset>
      <fieldset class="teacher-settings"><legend>实时教师</legend><div class="teacher-settings-fields"><div class="field"><label for="teacher-trigger">分析方式</label><select id="teacher-trigger"><option value="idle" ${teacherSettings.trigger === 'idle' ? 'selected' : ''}>停止输入后自动分析</option><option value="manual" ${teacherSettings.trigger === 'manual' ? 'selected' : ''}>仅手动分析</option></select></div><div class="field"><label for="teacher-idle-seconds">停止输入后等待（秒）</label><input id="teacher-idle-seconds" type="number" min="1" max="3600" step="1" required value="${escape(teacherSettings.idleSeconds)}" ${teacherSettings.trigger === 'manual' ? 'disabled' : ''}></div></div><p id="teacher-settings-note" class="card-subtitle"></p></fieldset>
      <div class="settings-actions"><span id="settings-message" role="status">已显示 ${settings.visibleModels.length} / ${config.models.length} 个模型</span><button id="settings-save" class="button primary" type="submit">保存设置</button></div></form>
    </section>`;
  function teacherNote() {
    const manual = $('#teacher-trigger').value === 'manual';
    $('#teacher-idle-seconds').disabled = manual;
    $('#teacher-settings-note').textContent = manual ? t('输入不会触发分析；点击「分析当前代码」或发送追问时才请求教师。') : t('默认停止输入 20 秒后分析。继续输入会重新计时，代码未变时不重复分析；手动分析无需等待。');
  }
  void createSetup({ api, escape, getAccount: () => account }).bind();
  teacherNote();
  $('#model-settings-form').onchange = () => { teacherNote(); $('#settings-message').textContent = t('设置已修改，保存后生效。'); };
  $('#model-settings-form').onsubmit = async event => {
    event.preventDefault();
    if (activeJob || actionPending || modelPending) return;
    const draft = settingsDraft();
    modelPending = true; updateButtons();
    $('#settings-message').textContent = t('正在保存…');
    try {
      settings = await api('/api/settings', 'PUT', draft);
      const languageChanged = settings.uiLanguage !== uiLanguage();
      setLanguages(settings);
      if (languageChanged) { location.reload(); return; }
      setAccount(account);
      if ($('#settings-message')) $('#settings-message').textContent = ui`已保存，显示 ${settings.visibleModels.length} / ${config.models.length} 个模型`;
      toast(t('设置已保存。'));
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
  $("#breadcrumb-current").textContent = { practice: t("开始练习"), history: t("练习记录"), analysis: t("掌握分析"), language: t("语言巩固"), interview: t("面试练习"), library: t("本地资料库"), training: t("能力训练"), study: t("每日复习"), breadth: t("技术广度"), entertainment: t("娱乐模式"), voice: t("语音 Demo"), settings: t("设置") }[page];
  if (voicePage) $("#breadcrumb-current").textContent = t('设置')+' / '+t('语音 Demo');
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
      button.innerHTML = `${hints ? t("思考提示") : t("评估结果")} <span>(${hints ? p.hints.length : p.reviews.length})</span>`;
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
  if (!account.authenticated) { if (!options.quiet) { toast(t("请先连接 Codex，再开始练习。")); await beginLogin(); } return; }
  if (kind === "analysis" && !state.stats.reviewed) { toast(t("先提交一道题的评估，再分析掌握情况。")); return; }
  actionPending = true; updateButtons();
  try {
    if (activeJob?.kind === 'teacher') await stopTeacher();
    if (kind !== "chat" && kind !== "teacher") await flushCode();
    const { jobId } = await requestTask(api, path, body);
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
  $("#task-message").textContent = t("Codex 正在思考…");
  $("#task-cancel").disabled = false;
  $("#task-cancel").textContent = t("取消");
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
        toast(kind === "library" ? ui`资料整理完成：${data.result?.libraryIds?.length ?? 0} 份成功${data.result?.failedIds?.length ? ui`，${data.result.failedIds.length} 份需要重试` : ""}。` : { study: t("短测已准备好，先独立回答。"), "study-review": t("评价与下次复习时间已保存。"), "study-import": t("知识点已提取，可在目录中浏览。"), training: t("训练结果已保存，可以回看并继续练习。"), generate: t("题目已生成，开始思考吧。"), hint: t("一个小提示已准备好。"), review: t("评估已保存，可以回看。"), analysis: t("学习画像已更新。"), language: t("语言练习已准备好，模板和讲解也已保存。"), interview: t("面试问题与关键词要点已准备好。"), "interview-review": t("回答评价已保存，可以逐题回看。") }[kind]);
      } else { render(); toast(data.message || t("任务已结束。")); }
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
      if (job.status !== "running") void finish(job.status, { result: job.result, message: job.error || (job.status === "aborted" ? t("任务已取消。") : undefined) });
    } catch (error) { if (source.readyState === EventSource.CLOSED) void finish("error", { message: error.message }); }
    finally { polling = false; }
  }, 3000);
}
$("#task-cancel").onclick = async () => {
  if (!activeJob) return;
  $("#task-cancel").disabled = true; $("#task-cancel").textContent = t("取消中…");
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
    toast(ui`已切换为 ${config.models.find(option => option.id === account.model)?.name ?? account.model}，后续 AI 请求使用此模型。`);
  } catch (error) { toast(error.message); }
  finally { modelPending = false; updateButtons(); }
}

function authorizedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "auth.openai.com" || url.hostname === "openai.com" || url.hostname.endsWith(".openai.com"))) throw new Error(t("授权地址不正确。"));
  return url.href;
}
async function beginLogin() {
  if (loginId && authSource) { $("#auth-dialog").showModal(); return; }
  $("#auth-dialog").showModal();
  $("#auth-message").textContent = t("正在准备安全授权…");
  $("#auth-link").hidden = true; $("#manual-auth").hidden = true; $("#device-code").hidden = true; $("#auth-value").value = "";
  // Open in the click gesture. If popups are blocked, the visible link still works.
  authPopup = window.open("about:blank", "_blank"); if (authPopup) authPopup.opener = null;
  try {
    const { id } = await api("/api/auth/login", "POST", {}); loginId = id;
    const source = new EventSource(`/api/auth/${id}/events`); authSource = source;
    const handleUrl = data => {
      try {
        const url = authorizedUrl(data.url); $("#auth-link").href = url; $("#auth-link").hidden = false;
        $("#auth-message").textContent = t("请在 OpenAI 授权页面完成登录，完成后会自动连接。");
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
      setAccount(await api("/api/auth/status")); $("#auth-dialog").close(); toast(t("Codex 已连接，现在可以开始练习。")); render();
    });
    source.addEventListener("error", event => {
      if (!(/** @type {MessageEvent<string>} */ (event)).data) { $("#auth-message").textContent = t("正在恢复授权连接…"); return; }
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
  try { await api(`/api/auth/${loginId}/answer`, "POST", { promptId: authPromptId, value: $("#auth-value").value }); $("#auth-value").value = ""; $("#auth-message").textContent = t("正在确认授权…"); }
  catch (error) { $("#auth-message").textContent = error.message; }
  finally { button.disabled = false; }
};
window.addEventListener("hashchange", async () => {
  // The editor still represents the old question until render changes currentId.
  try { await flushCode(); } catch (error) { toast(ui`${error.message} 未保存代码已保留在此浏览器。`); }
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
    $("#page").innerHTML = ui`<section class="card flat history-empty"><h2>暂时无法连接本机服务</h2><p>${escape(error.message)}</p><button id="retry-init" class="button primary">重新连接</button></section>`;
    $("#retry-init").onclick = init;
  }
}
void init();
