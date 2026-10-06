import { element, elements } from './dom.ts';
import { t, errorText } from "./i18n.js";
import { safeMarkdown as markdown } from './markdown.js';
import './chat.css';

const keys = { position: 'algo-practice:chat-position', size: 'algo-practice:chat-size', thread: 'algo-practice:chat-thread' };
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };


/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createChat({ api, escape, date, toast, startTask, selectModel, beginLogin, getAccount, getModels, getBusy, getActiveJob, pageContext }) {
  const root = document.createElement('div'); root.id = 'global-chat';
  root.innerHTML = `
    <button id="chat-launcher" class="chat-launcher convex" type="button" aria-label="${t("ui.openCodexChat")}" aria-controls="chat-window" aria-expanded="false" title="${t("ui.clickToChatDragToMove")}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-4 3V9.5A7.5 7.5 0 0 1 9.5 2H14"/><path d="m16 2 1.5 4.5L22 8l-4.5 1.5L16 14l-1.5-4.5L10 8l4.5-1.5Z"/></svg><span class="chat-unread" hidden></span>
    </button>
    <section id="chat-window" class="chat-window" role="dialog" aria-label="${t("ui.codexPageChat")}" hidden>
      <button id="chat-resize" class="chat-resize" type="button" aria-label="${t("ui.resizeChatWindow")}" title="${t("ui.dragTopLeftToResizeArrowKeysFor")}">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 13V4h9M4 4l11 11"/></svg>
      </button>
      <button id="chat-resize-bottom" class="chat-resize chat-resize-bottom" type="button" aria-label="${t("ui.resizeChatFromBottomRight")}" title="${t("ui.dragBottomRightToResizeArrowKeysFor")}">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 13V4h9M4 4l11 11"/></svg>
      </button>
      <header class="chat-header"><div><strong>Codex</strong><span>${t("ui.chatAboutThisPage")}</span></div><div class="chat-header-actions">
        <button id="chat-history-toggle" class="chat-icon" type="button" aria-label="${t("ui.conversationHistory")}" aria-expanded="false" title="${t("ui.conversationHistory")}">◷</button>
        <button id="chat-new" class="chat-icon" type="button" aria-label="${t("ui.newConversation")}" title="${t("ui.newConversation")}">＋</button>
        <button id="chat-maximize" class="chat-icon" type="button" aria-label="${t("ui.maximizeChatWindow")}" aria-pressed="false" title="${t("ui.maximizeChatWindow")}">
          <svg class="chat-expand-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2"/></svg>
          <svg class="chat-restore-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" hidden><path d="M7 6V3h10v10h-3"/><rect x="3" y="7" width="10" height="10" rx="1"/></svg>
        </button>
        <button id="chat-close" class="chat-icon" type="button" aria-label="${t("ui.collapseChatWindow")}" title="${t("ui.collapse")}">×</button>
      </div></header>
      <div class="chat-toolbar"><label for="chat-model">${t("ui.model")}</label><select id="chat-model" aria-label="${t("ui.chatModel")}"></select></div>
      <div class="chat-context"><span aria-hidden="true">↗</span><span id="chat-page-title"></span><span class="chat-context-note">${t("ui.pageIncludedAutomatically")}</span></div>
      <div id="chat-history" class="chat-history" hidden><div class="chat-history-heading"><strong>${t("ui.conversationHistory")}</strong><button id="chat-history-close" class="chat-icon" type="button" aria-label="${t("ui.closeConversationHistory")}">×</button></div><div id="chat-history-list"></div></div>
      <div id="chat-messages" class="chat-messages" role="log" aria-label="${t("ui.chatMessages")}" aria-live="off"></div>
      <button id="chat-latest" class="chat-latest" type="button" hidden>${t("ui.latestMessages")}</button>
      <form id="chat-form" class="chat-composer"><label for="chat-input" class="visually-hidden">${t("ui.askCodex")}</label><textarea id="chat-input" rows="2" maxlength="20000" placeholder="${t("ui.whatSUnclearAskAboutThisProblemOr")}"></textarea>
        <div class="chat-composer-actions"><span id="chat-status" role="status">${t("ui.enterToSendShiftEnterForANew")}</span><button id="chat-stop" class="button flat small" type="button" hidden>${t("ui.stopGenerating")}</button><button id="chat-send" class="button primary small" type="submit">${t("ui.send")}</button></div>
      </form>
    </section>`;
  document.body.append(root);
  const $ = selector => element(selector, root);
  const launcher = $('#chat-launcher'), panel = $('#chat-window'), messages = $('#chat-messages'), input = $('#chat-input');
  let thread = null, threads = [], opened = false, pending = false, initialized = false, selectionVersion = 0;
  let position = null, pointer = null, suppressClick = false, dragTimer, modelSignature = '';
  let dimensions = null, maximized = false, resizePointer = null;
  const draftKey = id => `algo-practice:chat-draft:${id ?? 'new'}`;
  const saveDraft = () => write(draftKey(thread?.id), input.value);
  function viewport() {
    const view = window.visualViewport;
    return { x: view?.offsetLeft ?? 0, y: view?.offsetTop ?? 0, width: view?.width ?? innerWidth, height: view?.height ?? innerHeight };
  }
  function layout() {
    const view = viewport(), size = launcher.offsetWidth, margin = 12;
    const x = Math.max(view.x + margin, Math.min(position?.x ?? view.x + view.width - size - 24, view.x + view.width - size - margin));
    const y = Math.max(view.y + margin, Math.min(position?.y ?? view.y + view.height - size - 24, view.y + view.height - size - margin));
    position = { x, y }; launcher.style.left = `${x}px`; launcher.style.top = `${y}px`;
    if (!opened) return;
    const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 70;
    const mobile = view.width <= 600, availableWidth = Math.max(1, view.width - 24), availableHeight = Math.max(1, view.height - 24);
    const width = maximized ? availableWidth : Math.min(dimensions?.width ?? 480, availableWidth);
    const height = maximized ? availableHeight : Math.min(dimensions?.height ?? Math.max(180, Math.min(700, view.height - (mobile ? 24 : 96))), availableHeight);
    panel.style.width = `${width}px`; panel.style.height = `${height}px`;
    panel.style.left = `${mobile || maximized ? view.x + 12 : Math.max(view.x + 12, Math.min(x + size - width, view.x + view.width - width - 12))}px`;
    panel.style.top = `${mobile || maximized ? view.y + 12 : Math.max(view.y + 12, Math.min(y - height - 12, view.y + view.height - height - 12))}px`;
    panel.classList.toggle('compact', width < 440);
    panel.classList.toggle('short', height < 440);
    $('#chat-resize').hidden = maximized; $('#chat-resize-bottom').hidden = maximized;
    const expand = $('#chat-maximize'), label = maximized ? t("ui.restoreChatWindow") : t("ui.maximizeChatWindow");
    expand.setAttribute('aria-label', label); expand.setAttribute('aria-pressed', String(maximized)); expand.title = label;
    $('.chat-expand-icon').hidden = maximized; $('.chat-restore-icon').hidden = !maximized;
    if (stick) messages.scrollTop = messages.scrollHeight;
  }
  try {
    const saved = JSON.parse(read(keys.position) ?? 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = { x: saved.x * Math.max(1, innerWidth - 56), y: saved.y * Math.max(1, innerHeight - 56) };
  } catch {}
  try {
    const saved = JSON.parse(read(keys.size) ?? 'null');
    if (saved && Number.isFinite(saved.width) && saved.width >= 360 && Number.isFinite(saved.height) && saved.height >= 420) dimensions = { width: saved.width, height: saved.height };
  } catch {}
  function resizeTo(width, height) {
    const view = viewport();
    dimensions = { width: Math.max(360, Math.min(width, view.width - 24)), height: Math.max(420, Math.min(height, view.height - 24)) };
    layout();
  }
  function finishResize() {
    if (!resizePointer) return;
    resizePointer = null; panel.classList.remove('resizing');
    if (dimensions) write(keys.size, JSON.stringify(dimensions));
  }
  for (const resizer of [$('#chat-resize'), $('#chat-resize-bottom')]) {
    const direction = resizer.id === 'chat-resize-bottom' ? 1 : -1;
    resizer.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || maximized) return;
      const rect = panel.getBoundingClientRect();
      resizePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
      event.preventDefault(); resizer.setPointerCapture(event.pointerId); panel.classList.add('resizing');
    });
    resizer.addEventListener('pointermove', event => {
      if (!resizePointer || event.pointerId !== resizePointer.id) return;
      resizeTo(resizePointer.width + direction * (event.clientX - resizePointer.x), resizePointer.height + direction * (event.clientY - resizePointer.y));
    });
    resizer.addEventListener('pointerup', finishResize); resizer.addEventListener('pointercancel', finishResize); resizer.addEventListener('lostpointercapture', finishResize);
    resizer.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const rect = panel.getBoundingClientRect(), step = (event.shiftKey ? 50 : 20) * direction;
      resizeTo(rect.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), rect.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
      write(keys.size, JSON.stringify(dimensions));
    });
  }
  $('#chat-maximize').onclick = () => { maximized = !maximized; layout(); };
  launcher.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position }, moved: false };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.moved ||= Math.hypot(dx, dy) > 7;
    if (!pointer.moved) return;
    launcher.classList.add('dragging'); position = { x: pointer.origin.x + dx, y: pointer.origin.y + dy }; layout();
  });
  function finishDrag() {
    if (!pointer) return;
    suppressClick = pointer.moved; pointer = null; launcher.classList.remove('dragging');
    write(keys.position, JSON.stringify({ x: position.x / Math.max(1, innerWidth - 56), y: position.y / Math.max(1, innerHeight - 56) }));
    clearTimeout(dragTimer); dragTimer = setTimeout(() => { suppressClick = false; }, 350);
  }
  launcher.addEventListener('pointerup', finishDrag); launcher.addEventListener('pointercancel', finishDrag);
  launcher.addEventListener('lostpointercapture', finishDrag);
  launcher.onclick = () => { if (!suppressClick) setOpen(!opened); };
  window.addEventListener('resize', layout); window.visualViewport?.addEventListener('resize', layout); window.visualViewport?.addEventListener('scroll', layout);
  layout();

  function setOpen(value) {
    opened = value; panel.hidden = !value; launcher.setAttribute('aria-expanded', String(value));
    launcher.setAttribute('aria-label', value ? t("ui.collapseCodexChat") : t("ui.openCodexChat"));
    layout();
    if (value) { $('.chat-unread').hidden = true; sync(); scrollLatest(); input.focus({ preventScroll: true }); }
    else { saveDraft(); launcher.focus({ preventScroll: true }); }
  }
  $('#chat-close').onclick = () => setOpen(false);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && opened && panel.contains(document.activeElement)) {
      if (!$('#chat-history').hidden) showHistory(false); else setOpen(false);
      event.preventDefault();
    }
  });
  const atBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 70;
  function scrollLatest() { messages.scrollTop = messages.scrollHeight; $('#chat-latest').hidden = true; }
  messages.addEventListener('scroll', () => { $('#chat-latest').hidden = atBottom(); });
  $('#chat-latest').onclick = scrollLatest;
  function renderMessages() {
    if (!thread?.turns.length) {
      messages.innerHTML = `<div class="chat-empty"><span aria-hidden="true">✧</span><h3>${t("ui.startWithWhatYouDonTUnderstand")}</h3><p>${t("ui.eachQuestionIncludesTheProblemExplanationReviewAnd")}</p><p>${t("ui.selectTextOnThePageToAskAbout")}</p></div>`;
      return;
    }
    messages.innerHTML = thread.turns.map(turn => `
      <article class="chat-turn" data-chat-turn="${escape(turn.id)}">
        <div class="chat-message chat-user"><div class="chat-message-meta"><strong>${t("ui.you")}</strong><time>${date(turn.createdAt)}</time></div><div class="chat-user-text">${escape(turn.user)}</div>
          <details class="chat-snapshot"><summary title="${t("ui.viewThisTurnSPageContext")}">↗ ${escape(turn.context.title)}</summary><a href="${escape(turn.context.route)}">${t("ui.goToSourcePage")}</a><p>${t("chat.pageSnapshot", { value6: date(turn.context.capturedAt) })}</p><pre>${escape([turn.context.selectedText && `${t("chat.selectedText", { selectedText: turn.context.selectedText })}`, turn.context.visibleText, turn.context.fields.map(field => `${field.label}：${field.value}`).join('\n'), turn.context.editor && `${t("chat.currentCode", { editor: turn.context.editor })}`, turn.context.record && `${t("chat.currentRecord", { record: turn.context.record })}`].filter(Boolean).join('\n\n'))}</pre></details>
        </div>
        <div class="chat-message chat-assistant"><div class="chat-message-meta"><strong>Codex</strong><span>${escape(turn.model)}</span><button class="chat-copy" data-chat-copy="${escape(turn.id)}" type="button" title="${t("ui.copyReply")}" aria-label="${t("ui.copyCodexReply")}" ${turn.assistant ? '' : 'hidden'}>${t("ui.copy")}</button></div>
          <div class="chat-markdown">${turn.assistant ? markdown(turn.assistant) : turn.status === 'streaming' ? `<span class="chat-thinking"><i></i><i></i><i></i> ${t("ui.thinking")}</span>` : ''}</div>
          <div class="chat-turn-status">${turn.status === 'streaming' ? t("ui.generating2") : turn.error ? escape(errorText(turn.error)) : ''}</div>
          ${['error', 'aborted'].includes(turn.status) && turn.id === thread.turns.at(-1).id ? `<button class="button flat small chat-retry" type="button">${t("ui.retryReply")}</button>` : ''}
        </div>
      </article>`).join('');
    messages.querySelectorAll('[data-chat-copy]').forEach(button => button.onclick = async () => {
      try { await navigator.clipboard.writeText(thread.turns.find(turn => turn.id === button.dataset.chatCopy).assistant); button.textContent = t("ui.copied"); }
      catch { toast(t("ui.copyFailedSelectTheReplyAndCopyIt")); }
    });
    messages.querySelector('.chat-retry')?.addEventListener('click', () => void retry());
    scrollLatest(); sync();
  }
  function sync() {
    const account = getAccount(), models = getModels(), busy = pending || getBusy(), active = getActiveJob();
    const signature = JSON.stringify([models, account?.model]);
    if (signature !== modelSignature) {
      modelSignature = signature;
      $('#chat-model').innerHTML = models.map(model => `<option value="${escape(model.id)}">${escape(model.name)}</option>`).join('');
      $('#chat-model').value = account?.model ?? '';
    }
    $('#chat-model').disabled = busy || !models.length;
    $('#chat-new').disabled = pending;
    $('#chat-history-toggle').disabled = pending;
    $('#chat-send').disabled = busy || !initialized || !input.value.trim();
    $('#chat-stop').hidden = active?.kind !== 'chat';
    messages.querySelectorAll('.chat-retry').forEach(button => { button.disabled = busy; });
    $('#chat-page-title').textContent = pageContext.metadata().title;
    $('#chat-page-title').title = t("ui.eachMessageIncludesTheLatestPageEarlierReplies");
    $('#chat-status').textContent = pending ? t("ui.sending") : active?.kind === 'chat' ? t("ui.codexIsReplying")
      : busy ? t("ui.waitForOrCancelTheCurrentTask") : !initialized ? t("ui.connectingToLocalService")
      : !account?.authenticated ? t("ui.connectCodexToStartChatting") : t("ui.enterToSendShiftEnterForANew");
    launcher.classList.toggle('responding', active?.kind === 'chat');
  }
  $('#chat-model').onchange = async event => { await selectModel(event.target.value); sync(); };
  input.addEventListener('input', () => { saveDraft(); sync(); input.style.height = 'auto'; input.style.height = `${Math.min(120, Math.max(52, input.scrollHeight))}px`; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
  });
  $('#chat-form').onsubmit = event => { event.preventDefault(); void send(); };
  async function send() {
    if (pending || getBusy() || !initialized || !input.value.trim()) return;
    if (!getAccount().authenticated) { await beginLogin(); return; }
    const message = input.value, context = pageContext.capture();
    pending = true; sync();
    try {
      if (!thread) { thread = await api('/api/chats', 'POST', {}); write(keys.thread, thread.id); }
      const result = await startTask(`/api/chats/${thread.id}/messages`, { id: crypto.randomUUID(), message, context }, 'chat');
      if (result) { if (input.value === message) input.value = ''; saveDraft(); await refresh(); }
    } catch (error) { toast(error.message); }
    finally { pending = false; sync(); }
  }
  async function retry() {
    if (pending || getBusy() || !thread) return;
    pending = true; sync();
    try { const result = await startTask(`/api/chats/${thread.id}/retry`, { turnId: thread.turns.at(-1).id }, 'chat'); if (result) await refresh(); }
    catch (error) { toast(error.message); }
    finally { pending = false; sync(); }
  }
  $('#chat-stop').onclick = async () => {
    const active = getActiveJob(); if (active?.kind !== 'chat') return;
    $('#chat-stop').disabled = true;
    try { await api(`/api/jobs/${active.id}/abort`, 'POST', {}); }
    catch (error) { toast(error.message); }
    finally { $('#chat-stop').disabled = false; }
  };
  function renderHistory() {
    $('#chat-history-list').innerHTML = threads.length ? threads.map(item => `<div class="chat-history-row ${item.id === thread?.id ? 'active' : ''}"><button class="chat-history-open" data-chat-open="${escape(item.id)}" type="button"><strong>${escape(errorText(item.title))}</strong><span>${escape(item.pageTitle || t("ui.noMessagesYet"))}</span><small>${t("chat.turns", { value5: date(item.updatedAt), turnCount: item.turnCount, value7: item.status === 'streaming' ? t("chat.message") : '' })}</small></button><button class="chat-icon" data-chat-delete="${escape(item.id)}" type="button" aria-label="${t("chat.deleteConversation", { value9: escape(errorText(item.title)) })}" title="${t("ui.deleteConversation")}">×</button></div>`).join('') : `<p class="chat-history-empty">${t("ui.noConversationsYetYourFirstMessageIsSaved")}</p>`;
    $('#chat-history-list').querySelectorAll('[data-chat-open]').forEach(button => button.onclick = () => void openThread(button.dataset.chatOpen).catch(error => toast(error.message)));
    $('#chat-history-list').querySelectorAll('[data-chat-delete]').forEach(button => button.onclick = async () => {
      try {
        await api(`/api/chats/${button.dataset.chatDelete}`, 'DELETE');
        if (thread?.id === button.dataset.chatDelete) newThread();
        await loadHistory();
      } catch (error) { toast(error.message); }
    });
  }
  async function loadHistory() { threads = (await api('/api/chats')).threads; renderHistory(); }
  function showHistory(value) { $('#chat-history').hidden = !value; $('#chat-history-toggle').setAttribute('aria-expanded', String(value)); if (value) void loadHistory().catch(error => toast(error.message)); }
  $('#chat-history-toggle').onclick = () => showHistory($('#chat-history').hidden);
  $('#chat-history-close').onclick = () => showHistory(false);
  function newThread() { saveDraft(); selectionVersion++; thread = null; write(keys.thread, ''); input.value = read(draftKey(null)) ?? ''; showHistory(false); renderMessages(); sync(); input.focus(); }
  $('#chat-new').onclick = newThread;
  async function openThread(id) {
    saveDraft(); const version = ++selectionVersion;
    const loaded = await api(`/api/chats/${id}`); if (version !== selectionVersion) return;
    thread = loaded; write(keys.thread, id); input.value = read(draftKey(id)) ?? ''; showHistory(false); renderMessages(); sync();
  }
  async function refresh() {
    const id = thread?.id, version = selectionVersion;
    const [loaded, history] = await Promise.all([id ? api(`/api/chats/${id}`) : Promise.resolve(null), api('/api/chats')]);
    threads = history.threads;
    if (version === selectionVersion && id === thread?.id && loaded) { thread = loaded; renderMessages(); }
    renderHistory(); sync();
  }
  function receiveTurn(data) {
    if (thread?.id !== data.chatId) return;
    const index = thread.turns.findIndex(turn => turn.id === data.turn.id);
    if (index < 0) thread.turns.push(data.turn); else thread.turns[index] = data.turn;
    renderMessages();
  }
  function receive(data) {
    if (!opened) $('.chat-unread').hidden = false;
    if (thread?.id !== data.chatId) return;
    const turn = thread.turns.find(turn => turn.id === data.turnId); if (!turn) return;
    // Events contain the current full text: replay/reconnect cannot duplicate tokens.
    if (turn.status !== 'streaming') return;
    turn.assistant = data.text;
    const card = [...messages.querySelectorAll('[data-chat-turn]')].find(card => card.dataset.chatTurn === turn.id);
    if (!card) return;
    const stick = atBottom(); card.querySelector('.chat-markdown').innerHTML = markdown(data.text);
    card.querySelector('.chat-copy').hidden = !data.text;
    if (stick) scrollLatest(); else $('#chat-latest').hidden = false;
  }
  async function init(activeJob) {
    const history = await api('/api/chats'); threads = history.threads;
    const id = (activeJob?.kind === 'chat' ? activeJob.chatId : null) ?? (threads.some(item => item.id === read(keys.thread)) ? read(keys.thread) : threads[0]?.id);
    if (id) await openThread(id); else { input.value = read(draftKey(null)) ?? ''; renderMessages(); }
    initialized = true; renderHistory(); sync();
  }
  window.addEventListener('beforeunload', saveDraft);
  return { init, sync, receiveTurn, receive, refresh };
}
