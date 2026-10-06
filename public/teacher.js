import { element, elements } from './dom.ts';
import { t } from "./i18n.js";
import { safeMarkdown } from './markdown.js';
import { createTeacherMonitor } from './teacher-monitor.js';
import './teacher.css';

const preference = 'algo-practice:teacher-enabled';
const readPreference = key => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };
const remember = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createTeacher({ api, escape, date, startTask, stopTeacher, selectModel, beginLogin, getCurrent, getAccount, getModels, getBusy, getActiveJob, getSettings }) {
  const preferences = () => getSettings?.() ?? { trigger: 'idle', idleSeconds: 20 };
  const root = document.createElement('aside'); root.id = 'teacher-panel'; root.hidden = true;
  root.setAttribute('aria-label', t("ui.liveTeacher2"));
  root.innerHTML = `
    <header class="teacher-header"><div><span class="teacher-symbol" aria-hidden="true">✦</span><strong>${t("ui.liveTeacher2")}</strong><small>${t("ui.codexThinkThroughTheNextStep")}</small></div><button id="teacher-exit" type="button" class="chat-icon" aria-label="${t("ui.exitLiveTeacher")}" title="${t("ui.exitLiveTeacher")}">×</button></header>
    <div class="teacher-controls"><label class="visually-hidden" for="teacher-model">${t("ui.teacherModel")}</label><select id="teacher-model"></select><button id="teacher-pause" class="teacher-button" type="button">${t("ui.pauseObservation")}</button></div>
    <div class="teacher-status"><span class="status-dot" aria-hidden="true"></span><span id="teacher-state" role="status">${t("ui.readyToObserve")}</span></div>
    <p id="teacher-problem" class="teacher-problem"></p>
    <div class="teacher-scroll">
      <div id="teacher-stale" class="teacher-stale" hidden>${t("ui.codeChangedHintForThePreviousVersion")}</div>
      <article id="teacher-feedback" class="chat-markdown teacher-feedback" aria-label="${t("ui.teacherGuidance")}"></article>
      <p id="teacher-error" class="teacher-error" role="status" hidden></p>
      <details id="teacher-history" class="teacher-history"><summary>${t("ui.guidanceHistoryForThisProblem")} <span id="teacher-count">0</span></summary><div id="teacher-records"></div></details>
    </div>
    <footer class="teacher-footer"><div class="teacher-actions"><button id="teacher-check" class="teacher-button" type="button">${t("ui.analyzeCurrentCode")}</button><button id="teacher-question-toggle" class="teacher-button" type="button" aria-expanded="false">${t("ui.followUp")}</button><button id="teacher-connect" class="teacher-button" type="button" hidden>${t("ui.connectCodex")}</button></div>
      <form id="teacher-question" hidden><label class="visually-hidden" for="teacher-input">${t("ui.askTheTeacher")}</label><textarea id="teacher-input" maxlength="4000" rows="2" placeholder="${t("ui.iStillDonTUnderstandThisStep")}"></textarea><button id="teacher-send" class="button primary" type="submit">${t("ui.sendQuestion")}</button></form>
      <small id="teacher-trigger-note"></small>
    </footer>`;
  document.body.append(root);
  const $ = selector => element(selector, root);
  let enabled = readPreference(preference), paused = readPreference(`${preference}:paused`), ready = false, thread = null, loading = false, following = null;
  let revision = 0, previous = null, epoch = 0, obsoleteTimer = null, error = '', feedbackStamp = '', historyStamp = '';
  let scheduleState = 'off', manualPending = false;
  const monitor = createTeacherMonitor({
    isBusy: () => getBusy() || loading || manualPending || !getAccount()?.authenticated,
    onState(value) { scheduleState = value; renderStatus(); },
    send: snapshot => request(snapshot, 'observe'),
  });

  function renderStatus() {
    if (!ready || !enabled) return;
    const current = getCurrent(), active = getActiveJob();
    const own = active?.kind === 'teacher' && (!active.chatId || active.chatId === thread?.id);
    const failed = thread?.turns.at(-1)?.status === 'error' && !isStale();
    const labels = { off: t("ui.observationOff"), paused: t("ui.pausedTimeToThinkIndependently"), away: t("ui.awayFromAnswerPageObservationPaused"), manual: t("ui.manualOnlyClickToGetGuidance"), blocked: t("ui.waitingForTheCurrentTask"), watching: t("ui.observingChangeCodeToContinue"), typing: `${t("teacher.waitingForInactivitySeconds", { idleSeconds: preferences().idleSeconds })}`, waiting: t("ui.waitingForNextObservation"), checking: t("ui.readingYourCode") };
    $('#teacher-state').textContent = !current ? labels.away : loading ? t("ui.loadingGuidanceForThisProblem") : !getAccount()?.authenticated ? t("ui.connectCodexToStartObservation") : error || failed ? t("ui.retryNeededAnalyzeCurrentCode") : own ? (isStale() ? t("ui.codeChangedThisHintUsesAnOlderVersion") : thread?.turns.at(-1)?.teacher?.trigger === 'question' ? t("ui.answeringYourQuestion") : t("ui.preparingAThinkingHint")) : paused ? labels.paused : labels[scheduleState];
    element('.status-dot', root).classList.toggle('muted', paused || !current || !getAccount()?.authenticated || !!error);
  }
  function isStale() {
    const turn = thread?.turns.at(-1), current = getCurrent();
    return !!turn && (!current || thread.problemId !== current.problemId || turn.context.editor !== current.code);
  }
  function renderFeedback() {
    const turn = thread?.turns.at(-1), stale = isStale();
    $('#teacher-stale').hidden = !stale || !getCurrent();
    const settings = preferences();
    const stamp = `${thread?.id}|${turn?.id}|${turn?.status}|${stale}|${turn?.assistant}|${settings.trigger}|${settings.idleSeconds}`;
    if (feedbackStamp !== stamp) {
      feedbackStamp = stamp;
      $('#teacher-feedback').innerHTML = turn?.assistant ? safeMarkdown(turn.assistant) : turn?.status === 'streaming' ? `<p class="teacher-placeholder">${t("ui.thinkingAboutTheProblemAndCurrentCode")}</p>` : `<p class="teacher-placeholder">${t("teacher.startWithYourOwnIdeas", { value1: settings.trigger === 'manual' ? t("ui.clickAnalyzeCurrentCodeWhenYouWantGuidance") : `${t("teacher.afterInactivityOfSecondsILlGiveA", { idleSeconds: settings.idleSeconds })}` })}</p>`;
    }
    $('#teacher-error').hidden = !error && !turn?.error;
    $('#teacher-error').textContent = error || turn?.error || '';
    $('#teacher-count').textContent = thread?.turns.length ?? 0;
    if ($('#teacher-history').open) renderHistory();
  }
  function renderHistory() {
    const stamp = JSON.stringify(thread?.turns);
    if (stamp === historyStamp) return;
    historyStamp = stamp;
    $('#teacher-records').innerHTML = (thread?.turns ?? []).slice().reverse().map((turn, i) => `<article class="teacher-record"><div class="teacher-record-meta">${t("teacher.attempt", { value1: (thread?.turns.length ?? 0) - i, value2: date(turn.createdAt), value3: escape(turn.model), value4: turn.status === 'aborted' ? t("teacher.message2") : turn.status === 'error' ? t("teacher.message") : '' })}</div>${turn.teacher?.trigger === 'question' ? `<p class="teacher-record-question">${escape(turn.user)}</p>` : ''}<div class="chat-markdown">${safeMarkdown(turn.assistant || t("ui.noHintGeneratedYet"))}</div><details><summary>${t("ui.codeAtTheTime")}</summary><pre>${escape(turn.context.editor)}</pre></details></article>`).join('') || `<p>${t("ui.noGuidanceHistoryForThisProblemYet")}</p>`;
  }
  async function follow(current) {
    const token = ++epoch; following = current.problemId; loading = true; thread = null; error = ''; feedbackStamp = historyStamp = ''; renderFeedback();
    try {
      await stopTeacher();
      const next = await api(`/api/problems/${current.problemId}/teacher`, 'POST', {});
      if (token !== epoch || !enabled || getCurrent()?.problemId !== next.problemId) return;
      thread = next;
      const last = next.turns.at(-1);
      monitor.seed(last && ['done', 'streaming'].includes(last.status) ? { problemId: next.problemId, code: last.context.editor } : null);
    } catch (e) { if (token === epoch) error = e.message; }
    finally { if (token === epoch) { loading = false; renderFeedback(); sync(); } }
  }
  function sync() {
    if (!ready) return;
    const settings = preferences();
    monitor.configure({ automatic: settings.trigger === 'idle', idleMs: settings.idleSeconds * 1000 });
    root.hidden = !enabled; document.body.classList.toggle('teacher-visible', enabled);
    const toggle = element('#teacher-toggle');
    if (toggle) { toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? t("ui.teacherActive") : t("ui.liveTeacher"); }
    if (!enabled) return;
    const current = getCurrent();
    if (current && following !== current.problemId) { void follow(current); }
    if (current?.problemId !== previous?.problemId || current?.code !== previous?.code) {
      previous = current ? { ...current } : null; revision++; error = '';
      clearTimeout(obsoleteTimer);
      if (getActiveJob()?.kind === 'teacher' && (!current || isStale())) {
        obsoleteTimer = setTimeout(() => { if (getActiveJob()?.kind === 'teacher' && (!getCurrent() || isStale())) void stopTeacher().catch(e => { error = e.message; renderFeedback(); }); }, current ? settings.idleSeconds * 1000 : 0);
      }
    }
    $('#teacher-problem').textContent = current?.title ?? (thread ? `${t("teacher.paused", { title: thread.title })}` : t("ui.returnToTheAlgorithmAnswerPageToContinue"));
    const models = getModels(), model = getAccount()?.model;
    const modelStamp = models.map(model => model.id).join('|');
    if ($('#teacher-model').dataset.models !== modelStamp) {
      $('#teacher-model').dataset.models = modelStamp;
      $('#teacher-model').innerHTML = models.map(option => `<option value="${escape(option.id)}">${escape(option.name)}</option>`).join('');
    }
    $('#teacher-model').value = model ?? '';
    const foregroundBusy = getBusy() && getActiveJob()?.kind !== 'teacher';
    $('#teacher-model').disabled = foregroundBusy || loading;
    $('#teacher-pause').textContent = paused ? t("ui.resumeObservation") : t("ui.pauseObservation");
    $('#teacher-check').disabled = !current || loading || foregroundBusy || !getAccount()?.authenticated;
    $('#teacher-send').disabled = !current || loading || foregroundBusy || manualPending || !getAccount()?.authenticated;
    $('#teacher-connect').hidden = !!getAccount()?.authenticated;
    $('#teacher-trigger-note').textContent = settings.trigger === 'manual' ? t("ui.manualOnlyTypingDoesNotTriggerAnalysis") : `${t("teacher.automaticAnalysisAfterInactivityOfSeconds", { idleSeconds: settings.idleSeconds })}`;
    monitor.observe(current); renderFeedback(); renderStatus();
  }
  async function request(snapshot, trigger, message) {
    const observationDisabled = () => paused || preferences().trigger === 'manual';
    if (!enabled || !thread || thread.problemId !== snapshot.problemId || getCurrent()?.code !== snapshot.code || (trigger === 'observe' && observationDisabled())) return;
    const token = epoch, id = thread.id;
    error = '';
    const result = await startTask(`/api/teachers/${id}/messages`, { id: crypto.randomUUID(), code: snapshot.code, revision, trigger, ...(message ? { message } : {}) }, 'teacher', { quiet: true, chatId: id });
    if (!result) { error = t("ui.teacherRequestFailedCheckTheConnectionAndRetry"); renderFeedback(); renderStatus(); return; }
    if (!enabled || token !== epoch || getCurrent()?.code !== snapshot.code || (trigger === 'observe' && observationDisabled())) await stopTeacher();
    return result;
  }
  async function refresh() {
    if (!thread) { sync(); return; }
    const id = thread.id, token = epoch;
    try { const next = await api(`/api/teachers/${id}`); if (token === epoch && thread?.id === next.id) thread = next; }
    catch (e) { if (token === epoch) error = e.message; }
    renderFeedback(); sync();
  }
  async function activate() {
    if (!getCurrent()) return;
    enabled = true; ready = true; remember(preference, true); monitor.pause(paused); monitor.enable(true); sync();
    showEditor();
  }
  function showEditor() {
    if (enabled && matchMedia('(max-width:1100px)').matches) requestAnimationFrame(() => element('.editor-panel')?.scrollIntoView({ block: 'start' }));
  }
  document.addEventListener('focusin', event => { if ((/** @type {Element} */ (event.target)).closest('#code-editor')) showEditor(); });
  window.addEventListener('resize', () => { if (document.activeElement?.closest('#code-editor')) showEditor(); });
  $('#teacher-exit').onclick = () => {
    enabled = false; paused = false; remember(preference, false); remember(`${preference}:paused`, false); monitor.enable(false); monitor.pause(false); clearTimeout(obsoleteTimer); epoch++; loading = false; following = null;
    sync(); void stopTeacher().catch(e => { error = e.message; });
  };
  $('#teacher-pause').onclick = async () => {
    paused = !paused; remember(`${preference}:paused`, paused); monitor.pause(paused); sync();
    if (paused) await stopTeacher().catch(e => { error = e.message; renderFeedback(); });
    else { const last = thread?.turns.at(-1); if (last?.status !== 'done') monitor.seed(null); }
  };
  $('#teacher-model').onchange = event => { void selectModel(event.target.value); };
  $('#teacher-connect').onclick = () => { void beginLogin(); };
  $('#teacher-check').onclick = async () => {
    const current = getCurrent(); if (!current) return;
    manualPending = true; monitor.sync();
    try { if (!thread) await follow(current); await request(current, 'check'); } finally { manualPending = false; sync(); }
  };
  $('#teacher-question-toggle').onclick = () => {
    const open = $('#teacher-question').hidden; $('#teacher-question').hidden = !open;
    $('#teacher-question-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('#teacher-input').focus();
  };
  $('#teacher-question').onsubmit = async event => {
    event.preventDefault(); const current = getCurrent(), message = $('#teacher-input').value.trim();
    if (!message || !current || manualPending) return;
    manualPending = true; sync();
    try { if (await request(current, 'question', message)) $('#teacher-input').value = ''; }
    finally { manualPending = false; sync(); }
  };
  $('#teacher-history').ontoggle = () => { if ($('#teacher-history').open) renderHistory(); };
  new ResizeObserver(() => { document.body.style.setProperty('--teacher-height', `${Math.ceil(root.getBoundingClientRect().height)}px`); }).observe(root);
  return {
    activate, sync, refresh,
    async init(activeJob) {
      ready = true;
      monitor.pause(paused);
      if (activeJob?.kind === 'teacher' && activeJob.chatId) {
        thread = await api(`/api/teachers/${activeJob.chatId}`); following = thread.problemId;
        if (!enabled || paused || (preferences().trigger === 'manual' && thread.turns.at(-1)?.teacher?.trigger === 'observe')) { await stopTeacher(); if (!enabled) return; }
        const last = thread?.turns.at(-1);
        if (last && thread) monitor.seed({ problemId: thread.problemId, code: last.context.editor });
      }
      monitor.enable(enabled); sync();
    },
    receiveTurn(data) {
      if (thread?.id !== data.chatId) return;
      const index = thread.turns.findIndex(turn => turn.id === data.turn.id);
      if (index < 0) thread.turns.push(data.turn); else thread.turns[index] = data.turn;
      monitor.seed({ problemId: thread.problemId, code: data.turn.context.editor });
      renderFeedback(); renderStatus();
    },
    receive(data) {
      if (thread?.id !== data.chatId) return;
      const turn = thread.turns.find(turn => turn.id === data.turnId); if (!turn) return;
      turn.assistant = data.text;
      // Keep stale streamed text in history without changing the visible guidance while typing.
      if (!isStale()) renderFeedback();
    },
  };
}
