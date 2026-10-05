import { element, elements } from './dom.ts';
import { t, ui } from "./i18n.js";
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
  root.setAttribute('aria-label', t('实时教师'));
  root.innerHTML = ui`
    <header class="teacher-header"><div><span class="teacher-symbol" aria-hidden="true">✦</span><strong>实时教师</strong><small>Codex · 陪你想下一步</small></div><button id="teacher-exit" type="button" class="chat-icon" aria-label="退出实时教师" title="退出实时教师">×</button></header>
    <div class="teacher-controls"><label class="visually-hidden" for="teacher-model">教师模型</label><select id="teacher-model"></select><button id="teacher-pause" class="teacher-button" type="button">暂停观察</button></div>
    <div class="teacher-status"><span class="status-dot" aria-hidden="true"></span><span id="teacher-state" role="status">准备观察</span></div>
    <p id="teacher-problem" class="teacher-problem"></p>
    <div class="teacher-scroll">
      <div id="teacher-stale" class="teacher-stale" hidden>代码已修改 · 以下是上一版本的提示</div>
      <article id="teacher-feedback" class="chat-markdown teacher-feedback" aria-label="教师引导"></article>
      <p id="teacher-error" class="teacher-error" role="status" hidden></p>
      <details id="teacher-history" class="teacher-history"><summary>本题引导记录 <span id="teacher-count">0</span></summary><div id="teacher-records"></div></details>
    </div>
    <footer class="teacher-footer"><div class="teacher-actions"><button id="teacher-check" class="teacher-button" type="button">分析当前代码</button><button id="teacher-question-toggle" class="teacher-button" type="button" aria-expanded="false">追问</button><button id="teacher-connect" class="teacher-button" type="button" hidden>连接 Codex</button></div>
      <form id="teacher-question" hidden><label class="visually-hidden" for="teacher-input">向教师追问</label><textarea id="teacher-input" maxlength="4000" rows="2" placeholder="这一步我还不理解…"></textarea><button id="teacher-send" class="button primary" type="submit">发送追问 →</button></form>
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
    const labels = { off: t('观察已关闭'), paused: t('已暂停 · 可以独立思考'), away: t('离开答题页 · 观察已暂停'), manual: t('仅手动分析 · 点击按钮获取引导'), blocked: t('等待当前任务结束'), watching: t('观察中 · 修改代码后继续'), typing: ui`等待停止输入 ${preferences().idleSeconds} 秒`, waiting: t('等待下一次观察'), checking: t('正在看你的代码…') };
    $('#teacher-state').textContent = !current ? labels.away : loading ? t('正在读取本题引导记录…') : !getAccount()?.authenticated ? t('连接 Codex 后开始观察') : error || failed ? t('需要重试 · 点击分析当前代码') : own ? (isStale() ? t('代码已更新 · 当前提示基于旧版本') : thread?.turns.at(-1)?.teacher?.trigger === 'question' ? t('正在回答你的追问…') : t('正在给你一个思考方向…')) : paused ? labels.paused : labels[scheduleState];
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
      $('#teacher-feedback').innerHTML = turn?.assistant ? safeMarkdown(turn.assistant) : turn?.status === 'streaming' ? t('<p class="teacher-placeholder">正在结合题目和当前代码思考…</p>') : ui`<p class="teacher-placeholder">先写下你的思路。${settings.trigger === 'manual' ? t('需要引导时，点击「分析当前代码」。') : ui`停止输入 ${settings.idleSeconds} 秒后，我会结合题目和代码给一个思考提示；也可以手动点击分析。`}</p>`;
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
    $('#teacher-records').innerHTML = (thread?.turns ?? []).slice().reverse().map((turn, i) => ui`<article class="teacher-record"><div class="teacher-record-meta">第 ${(thread?.turns.length ?? 0) - i} 次 · ${date(turn.createdAt)} · ${escape(turn.model)}${turn.status === 'aborted' ? t(' · 已中断') : turn.status === 'error' ? t(' · 失败') : ''}</div>${turn.teacher?.trigger === 'question' ? `<p class="teacher-record-question">${escape(turn.user)}</p>` : ''}<div class="chat-markdown">${safeMarkdown(turn.assistant || t('尚未生成提示。'))}</div><details><summary>当时的代码</summary><pre>${escape(turn.context.editor)}</pre></details></article>`).join('') || t('<p>本题还没有引导记录。</p>');
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
    if (toggle) { toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? t('✦ 教师陪练中') : t('✦ 实时教师'); }
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
    $('#teacher-problem').textContent = current?.title ?? (thread ? ui`已暂停：${thread.title}` : t('回到算法答题页，继续教师陪练。'));
    const models = getModels(), model = getAccount()?.model;
    const modelStamp = models.map(model => model.id).join('|');
    if ($('#teacher-model').dataset.models !== modelStamp) {
      $('#teacher-model').dataset.models = modelStamp;
      $('#teacher-model').innerHTML = models.map(option => `<option value="${escape(option.id)}">${escape(option.name)}</option>`).join('');
    }
    $('#teacher-model').value = model ?? '';
    const foregroundBusy = getBusy() && getActiveJob()?.kind !== 'teacher';
    $('#teacher-model').disabled = foregroundBusy || loading;
    $('#teacher-pause').textContent = paused ? t('继续观察') : t('暂停观察');
    $('#teacher-check').disabled = !current || loading || foregroundBusy || !getAccount()?.authenticated;
    $('#teacher-send').disabled = !current || loading || foregroundBusy || manualPending || !getAccount()?.authenticated;
    $('#teacher-connect').hidden = !!getAccount()?.authenticated;
    $('#teacher-trigger-note').textContent = settings.trigger === 'manual' ? t('仅手动分析 · 输入不会自动触发') : ui`自动分析 · 停止输入 ${settings.idleSeconds} 秒后`;
    monitor.observe(current); renderFeedback(); renderStatus();
  }
  async function request(snapshot, trigger, message) {
    const observationDisabled = () => paused || preferences().trigger === 'manual';
    if (!enabled || !thread || thread.problemId !== snapshot.problemId || getCurrent()?.code !== snapshot.code || (trigger === 'observe' && observationDisabled())) return;
    const token = epoch, id = thread.id;
    error = '';
    const result = await startTask(`/api/teachers/${id}/messages`, { id: crypto.randomUUID(), code: snapshot.code, revision, trigger, ...(message ? { message } : {}) }, 'teacher', { quiet: true, chatId: id });
    if (!result) { error = t('教师请求未完成，请检查连接后再试。'); renderFeedback(); renderStatus(); return; }
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
