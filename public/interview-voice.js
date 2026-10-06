import { t, message } from './i18n.js';
import { element, elements } from './dom.ts';
import './voice.css';
import { createVoiceSession } from './voice-session.js';
import { createVoiceControls } from './voice-controls.js';
import { voiceActivity } from './voice-activity.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceInterview({ api, escape, pageHeading, date, getState, toast, beginTraining }) {
  let mounted = false, record = null, controls = null, conversation = null, progress = null, account = null, operation = false, mode = 'interview';
  let partial = new Map(), roundStamp = '', historyReloading = false, generation = 0, content = null, preparing = false;
  let inputRounds = new Map(), bridge = Promise.resolve();
  let previewTimer = null, previewHeard = false, previewDone = false, previewQuietAt = 0, previewStopping = false, previewCaption = '';
  const $ = id => document.getElementById(id);
  function stateChanged(state) {
    if (!mounted) return;
    $('interview-voice-session').dataset.state = state.phase; $('interview-voice-session').dataset.rxEnergy = String(state.energy); $('interview-voice-session').dataset.rxBytes = String(state.received);
    const activity = voiceActivity(state,mode,progress?.stage ?? 'waiting',preparing), indicator = $('interview-voice-activity');
    indicator.dataset.activity = activity.activity; indicator.dataset.recording = String(activity.recording); indicator.dataset.animate = String(activity.animate);
    indicator.style.setProperty('--voice-level',String(activity.level));
    $('interview-activity-label').textContent = activity.label; $('interview-activity-detail').textContent = activity.detail;
    $('interview-voice-status').textContent = preparing ? activity.detail : t(state.error) || (state.phase === 'connected' ? activity.detail : mode === 'preview' ? state.busy || state.id ? t('正在试听所选音色…') : t('试听已结束。') : state.phase === 'connecting' ? t('正在连接 Codex…') : state.phase === 'ending' ? t('正在结束并保存…') : state.phase === 'ended' ? t('通话已结束，文字转写与点评已保存。') : t('准备开始语音面试。'));
    $('interview-voice-error').hidden = !state.error; $('interview-voice-error').textContent = t(state.error);
    if (mode === 'probe' && state.error) $('interview-probe-result').textContent = message('voice.probe.error',{error:t(state.error)});
    for (const id of ['interview-voice-start','interview-voice-test']) (/** @type {HTMLButtonElement} */ ($(id))).disabled = operation || preparing || state.busy || !!state.id || !account?.authenticated || !controls.ready();
    (/** @type {HTMLButtonElement} */ ($('interview-voice-end'))).disabled = !state.id && !state.busy; $('interview-voice-end').textContent = mode === 'preview' ? t('停止试听') : t('结束面试');
    (/** @type {HTMLButtonElement} */ ($('interview-voice-mute'))).disabled = state.phase !== 'connected' || state.test || state.paused || state.controlBusy;
    $('interview-voice-mute').textContent = state.muted ? t('打开麦克风') : t('麦克风静音'); $('interview-voice-mute').setAttribute('aria-pressed',String(state.muted));
    $('interview-voice-play').hidden = !state.needsPlayback || state.paused;
    (/** @type {HTMLButtonElement} */ ($('interview-voice-stop'))).disabled = state.phase !== 'connected' || state.controlBusy || state.paused;
    (/** @type {HTMLButtonElement} */ ($('interview-voice-pause'))).disabled = state.phase !== 'connected' || (state.controlBusy && !state.resuming);
    $('interview-voice-pause').textContent = state.paused && !state.resuming ? t('继续对话') : t('暂停对话');
    $('interview-voice-pause').setAttribute('aria-pressed',String(state.paused && !state.resuming));
    const canMove = !operation && !state.controlBusy && !state.paused && !state.inputSpeaking && !state.processing && !state.backendThinking && !state.delegating && !state.outputSpeaking && mode === 'interview' && state.phase === 'connected' && progress?.stage === 'ready';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-next'))).disabled = !canMove; (/** @type {HTMLButtonElement} */ ($('interview-voice-retry'))).disabled = !canMove;
    $('interview-voice-next').textContent = progress && progress.questionIndex+1 === progress.questionCount ? t('完成本次面试') : t('下一题 →');
    $('interview-voice-sample').hidden = !state.test || mode !== 'interview';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-sample'))).disabled = operation || state.paused || state.controlBusy || !['answering','ready'].includes(progress?.stage) || state.phase !== 'connected';
    $('interview-voice-stats').textContent = message('voice.stats',{seconds:state.elapsed,sent:(state.sent/1024).toFixed(1),received:(state.received/1024).toFixed(1)});
    controls.lock(state.busy || !!state.id || operation || preparing);
    if (mode === 'preview' && state.phase === 'connected') {
      if (state.outputSpeaking) { previewHeard = true; previewQuietAt = 0; }
      else if (previewHeard) {
        previewQuietAt ||= Date.now();
        if (previewDone && !state.needsPlayback && Date.now()-previewQuietAt > 900 && !previewStopping) { previewStopping = true; void conversation.end(); }
      }
    }
  }
  function draw() {
    if (!mounted) return;
    const index = progress?.questionIndex ?? 0, question = content?.language === controls?.read().language ? content.questions[index] : record.questions[index], round = progress?.round;
    $('interview-question-number').textContent = message('interview.voice.question',{number:String(index+1).padStart(2,'0'),total:record.questions.length});
    $('interview-question-text').lang = progress?.settings.language ?? (content?.language === controls?.read().language ? content.language : record.language ?? '');
    $('interview-question-text').textContent = progress?.question.text ?? question.question;
    const show = controls?.read().showTips ?? record.voiceSettings?.showTips ?? true;
    $('interview-answer-tips').hidden = !show;
    $('interview-tips-list').innerHTML = show ? (progress?.question.tips ?? (question.tips?.length ? question.tips : [question.focus])).map(tip => '<li>'+escape(tip)+'</li>').join('') : '';
    const partialText = role => [...partial.values()].filter(part => part.role === role).map(part => part.text).join('');
    const userText = partialText('user'), assistantText = partialText('assistant');
    const answer = (round?.answer ?? '')+(userText ? (round?.answer ? '\n' : '')+userText : ''), feedback = (round?.feedback ?? '')+(progress?.responseKind === 'answer' ? assistantText : '');
    const assisting = ['sample','clarification'].includes(progress?.responseKind), reply = (progress?.reply ?? '')+(assisting ? assistantText : '');
    $('interview-answer-live').textContent = answer || t('你的语音回答会转写到这里。');
    $('interview-feedback-live').textContent = feedback || t('Codex 听完回答后，会指出具体的表达问题与改进重点。');
    $('interview-reply-section').hidden = !assisting && !reply;
    $('interview-reply-title').textContent = progress?.responseKind === 'sample' ? t('示范回答') : t('本轮交流');
    $('interview-reply-live').textContent = reply || t('正在回应你的请求…');
    $('interview-answer-length').textContent = answer ? message('interview.voice.answerLength',{count:answer.length,tips:round?.tipsShown ? t('本题使用过 tips') : t('本题未使用 tips')}) : '';
    if (conversation) stateChanged(conversation.state());
  }
  function handleEvent(name, value) {
    if (!mounted) return;
    if (name === 'model-verified') { void controls.load().then(() => { if (mounted) stateChanged(conversation.state()); }); return; }
    if (name === 'interview-notice') { toast(t(value.message)); return; }
    if (['input-started','response-started','response-ended'].includes(name)) {
      if (mode !== 'interview' || !progress?.round || !Number.isSafeInteger(value.inputRevision)) return;
      const owner = conversation, token = generation, id = owner.state().id, revision = value.inputRevision;
      if (!id) return;
      if (!inputRounds.has(revision)) inputRounds.set(revision,progress.round.at);
      const roundAt = inputRounds.get(revision);
      while (inputRounds.size > 32) inputRounds.delete(inputRounds.keys().next().value);
      if (name === 'response-started') return;
      if (roundAt !== progress.round.at) return;
      if (name === 'input-started') { progress = {...progress,stage:'answering'}; draw(); }
      bridge = bridge.catch(() => {}).then(async () => {
        if (!mounted || token !== generation || owner !== conversation || owner.state().id !== id || progress?.round?.at !== roundAt) return;
        const result = await api(`/api/voice/sessions/${id}/action`,'POST',{action:name === 'input-started' ? 'answer-started' : 'response-complete',roundAt,inputRevision:revision});
        if (mounted && token === generation && owner === conversation && owner.state().id === id && progress?.round?.at === roundAt) handleEvent('interview-progress',result);
      }).catch(error => { if (mounted && token === generation && owner === conversation) toast(error.message); });
      return;
    }
    if (name !== 'interview-progress') return;
    if (value.round?.at !== roundStamp) { partial.clear(); roundStamp = value.round?.at ?? ''; }
    progress = value;
    if (value.round && !inputRounds.has(value.inputRevision ?? 0)) inputRounds.set(value.inputRevision ?? 0,value.round.at);
    if (value.stage === 'ready') for (const [key,part] of partial) if (part.role === 'assistant') partial.delete(key);
    draw();
  }
  function transcript(line) {
    if (!mounted) return;
    if (mode === 'preview') { if (line.role === 'assistant' && line.done) { previewDone = true; previewCaption = line.text; controls.setPreview(true,message('voice.preview.caption',{caption:line.text})); } return; }
    if (mode === 'probe') { if (line.done) $('interview-probe-result').textContent = (line.role === 'assistant' ? 'Codex：' : t('合成语音：'))+line.text; return; }
    const key = line.role+':'+(line.itemId ?? 'current');
    if (!line.done && (line.role === 'user' || progress?.responseKind === 'answer' || ['sample','clarification'].includes(progress?.responseKind))) partial.set(key,{role:line.role,text:(partial.get(key)?.text ?? '')+line.text});
    if (line.done) partial.delete(key);
    draw();
  }
  async function reload() {
    if (!record || historyReloading) return;
    historyReloading = true; const id = record.id;
    try {
      const saved = await api(`/api/interviews/${id}`);
      if (!mounted || record.id !== id) return;
      record = saved; const entries = getState().interviews ?? [], index = entries.findIndex(set => set.id === id); if (index !== -1) entries[index] = saved;
      renderHistory();
    } catch (error) { if (mounted) toast(error.message); }
    finally { historyReloading = false; }
  }
  async function start(test = false) {
    if (!controls.ready() || !account?.authenticated) return;
    const owner = conversation; await controls.flush();
    if (!mounted || owner !== conversation) return;
    mode = 'interview'; progress = null; partial.clear(); inputRounds.clear(); bridge = Promise.resolve(); roundStamp = ''; $('interview-probe-result').textContent = '';
    try { await prepareContent(controls.read()); } catch (error) { if (mounted) toast(error.message); return; }
    if (!mounted || owner !== conversation) return;
    await conversation.start({...controls.read(),interviewId:record.id,synthetic:test},test);
  }
  async function prepareContent(settings) {
    const token = generation, id = record.id;
    preparing = true; stateChanged(conversation.state());
    try {
      const result = await api(`/api/interviews/${id}/voice-content`,'POST',{language:settings.language});
      if (mounted && token === generation) { content = result; draw(); }
    } finally { if (mounted && token === generation) { preparing = false; stateChanged(conversation.state()); } }
  }
  async function preview(settings) {
    const owner = conversation;
    if (mode === 'preview' && (owner.state().id || owner.state().busy)) { await owner.end(); return; }
    if (owner.state().busy || owner.state().id || preparing || operation) return;
    mode = 'preview'; previewHeard = false; previewDone = false; previewQuietAt = 0; previewStopping = false; previewCaption = '';
    controls.setPreview(true,message('voice.preview.connecting',{voice:settings.voice}));
    await owner.start({...settings,preview:true},true);
  }
  async function connected() {
    const owner = conversation;
    if (mode === 'preview') {
      const id = owner.state().id;
      previewTimer = setTimeout(() => { if (mounted && owner === conversation && owner.state().id === id) void owner.end(previewHeard ? '' : t('没有收到试听声音，请重试。')); },22000);
      await api(`/api/voice/sessions/${id}/preview`,'POST',{}); return;
    }
    if (mode === 'probe') {
      const id = owner.state().id;
      await owner.playClip('/voice-test-2.wav'); await new Promise(resolve => setTimeout(resolve,6000));
      if (!mounted || owner !== conversation || owner.state().id !== id) return;
      $('interview-probe-result').textContent += owner.state().energy > 0 ? t(' · 已收到真实语音。') : t(' · 尚未收到有声回复。');
      await owner.end(); return;
    }
    const result = await api(`/api/voice/sessions/${owner.state().id}/action`,'POST',{action:'begin'});
    if (!mounted || owner !== conversation) return;
    handleEvent('interview-progress',result);
  }
  async function action(name) {
    if (!conversation.state().id || operation) return;
    operation = true; stateChanged(conversation.state());
    try {
      const result = await api(`/api/voice/sessions/${conversation.state().id}/action`,'POST',{action:name});
      handleEvent('interview-progress',result);
      if (name === 'finish') { await conversation.end(); await reload(); }
    } catch (error) { toast(error.message); }
    finally { operation = false; if (mounted) stateChanged(conversation.state()); }
  }
  async function sample() {
    if (operation) return; operation = true; stateChanged(conversation.state());
    try { await conversation.playClip('/interview-test.wav'); } catch (error) { toast(error.message); }
    finally { operation = false; if (mounted) stateChanged(conversation.state()); }
  }
  function renderHistory() {
    if (!mounted) return;
    $('interview-voice-history').innerHTML = (record.voiceAttempts ?? []).slice().reverse().map((attempt,index) => '<details class="card flat voice-attempt"><summary>'+escape(date(attempt.at))+' · '+(attempt.synthetic ? t('合成语音测试') : t('语音面试'))+' · '+message('interview.voice.rounds',{count:attempt.rounds.length})+' · '+escape({active:t('进行中'),completed:t('已完成'),stopped:t('已结束'),failed:t('连接失败'),interrupted:t('连接中断')}[attempt.status])+'</summary>'+attempt.rounds.map(round => '<section class="voice-history-round"><h3>'+escape(round.question)+'</h3><span class="tag">'+(round.tipsShown ? t('使用过 tips') : t('未使用 tips'))+t('</span><h4>我的回答</h4><p>')+escape(round.answer || t('未留下完整回答。'))+t('</p><h4>Codex 点评</h4><p>')+escape(round.feedback || t('未完成点评。'))+'</p></section>').join('')+'</details>').join('') || t('<p class="voice-empty-history">完成语音回答后，这里保存转写和点评。</p>');
    const old = Object.entries(record.answers).filter(([,answer]) => answer.trim());
    $('interview-written-history').innerHTML = old.length || record.reviews.length ? t('<details class="card flat voice-attempt"><summary>此前的文字回答与评价</summary>')+old.map(([id,answer]) => '<h3>'+escape(record.questions.find(q => q.id === id)?.question ?? id)+'</h3><p class="problem-copy">'+escape(answer)+'</p>').join('')+record.reviews.map(review => '<details><summary>'+escape(date(review.at))+' · '+escape(review.summary)+'</summary>'+review.items.map(item => '<h4>'+escape(record.questions.find(q => q.id === item.questionId)?.question ?? item.questionId)+'</h4><p>'+escape(item.summary)+'</p><dl class="interview-dimensions">'+Object.entries(item.dimensions).map(([label,value]) => '<div><dt>'+escape({relevance:t('切题'),conciseness:t('简洁'),structure:t('结论与结构'),evidence:t('事实依据')}[label])+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>').join('')+'</details>').join('')+'</details>' : '';
  }
  function render(set) {
    dispose(); const token = ++generation; mounted = true; record = set; progress = null; account = null; operation = false; mode = 'interview'; partial.clear(); inputRounds.clear(); bridge = Promise.resolve(); roundStamp = ''; preparing = false;
    const initial = {language:getState().settings?.userLanguage ?? 'zh',...set.voiceSettings}; content = set.voiceContents?.[initial.language] ?? null;
    controls = createVoiceControls({api,escape,prefix:'interview',tips:true,language:true,preview:true,initial,onError:error => toast(error.message),onChange:async settings => {
      const changedLanguage = record?.voiceSettings?.language !== settings.language;
      const result = await api(`/api/interviews/${set.id}/voice-settings`,'PUT',settings);
      if (mounted && token === generation) {
        record.voiceSettings = result;
        if (changedLanguage && !conversation.state().id && !conversation.state().busy) {
          mode = 'interview'; progress = null; partial.clear();
          try { await prepareContent(result); } catch (error) { if (mounted && token === generation) toast(error.message); }
        }
        draw();
      }
      return result;
    },onTest:async settings => {
      mode = 'probe'; $('interview-probe-result').textContent = t('正在验证所选模型…'); await conversation.start(settings,true);
    },onPreview:settings => preview(settings)});
    element('#page').innerHTML = pageHeading('VOICE INTERVIEW',escape(set.title),t('Codex 语音提问，你用语音回答。听完点评后，可以重答或继续下一题。'),t('<a class="button flat" href="#interview">选择下一组 ＋</a>'))+controls.render()+
      t('<section id="interview-voice-session" class="interview-voice-layout"><article class="card flat interview-voice-question"><div class="section-heading"><span class="eyebrow" id="interview-question-number"></span><span class="tag">逐题语音面试</span></div><h2 id="interview-question-text"></h2><section id="interview-answer-tips" class="interview-answer-tips pressed"><h3>回答重点 · tips</h3><ul id="interview-tips-list"></ul></section><div id="interview-voice-activity" class="voice-activity pressed" data-activity="idle" data-recording="false" data-animate="false"><div class="voice-activity-visual" aria-hidden="true"><div class="voice-activity-halo"></div><svg class="voice-activity-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg></div><div class="voice-activity-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><strong id="interview-activity-label"></strong><p id="interview-activity-detail" role="status"></p></div><p id="interview-voice-status" class="voice-interview-status" role="status"></p><p id="interview-voice-account" class="voice-account"></p><div class="voice-actions"><button id="interview-voice-start" class="button primary" type="button" disabled>开始语音面试</button><button id="interview-voice-stop" class="button flat" type="button" disabled>停止本轮回复</button><button id="interview-voice-pause" class="button flat" type="button" disabled aria-pressed="false">暂停对话</button><button id="interview-voice-end" class="button flat" type="button" disabled>结束面试</button><button id="interview-voice-mute" class="button flat" type="button" disabled>麦克风静音</button></div><audio id="interview-voice-output" autoplay></audio><button id="interview-voice-play" class="button mint" type="button" hidden>允许播放声音</button><p id="interview-voice-error" class="voice-error" role="alert" hidden></p><p class="voice-note">麦克风音频会发送给 OpenAI。本机保存回答转写与点评，不保存录音；离开此模块会结束通话。字幕可能有识别误差。</p><div class="voice-actions"><button id="interview-voice-retry" class="button flat" type="button" disabled>重答这题</button><button id="interview-voice-next" class="button mint" type="button" disabled>下一题 →</button></div><p id="interview-voice-stats" class="voice-stats"></p><details class="voice-interview-test"><summary>无需麦克风测试语音面试</summary><p class="voice-note">用一段没有明确结论、带重复背景的合成回答，检查提问与点评。测试记录会单独标注。</p><button id="interview-voice-test" class="button flat small" type="button" disabled>用合成语音连接面试</button><button id="interview-voice-sample" class="button flat small" type="button" hidden disabled>播放合成回答</button></details><p id="interview-probe-result" class="voice-note" role="status"></p></article><article class="card flat interview-voice-feedback"><span class="eyebrow">YOUR ANSWER</span><h2>我的语音回答</h2><p id="interview-answer-live" class="voice-answer-text" aria-live="polite"></p><p id="interview-answer-length" class="voice-note"></p><hr><span class="eyebrow">CODEX FEEDBACK</span><h2>这次的点评</h2><p id="interview-feedback-live" class="voice-answer-text" aria-live="polite"></p><section id="interview-reply-section" hidden><hr><h2 id="interview-reply-title">本轮交流</h2><p id="interview-reply-live" class="voice-answer-text" aria-live="polite"></p></section></article></section><section class="language-history"><div class="section-heading"><div><h2>语音面试记录</h2><p class="card-subtitle">保存每次回答与具体点评；使用 tips 的练习单独标记。</p></div></div><div id="interview-voice-history"></div><div id="interview-written-history"></div></section>');
    conversation = createVoiceSession({api,audio:() => token === generation ? $('interview-voice-output') : null,onState:value => { if (token === generation) stateChanged(value); },onTranscript:line => { if (token === generation) transcript(line); },onEvent:(name,value) => { if (token === generation) handleEvent(name,value); },onConnected:() => token === generation ? connected() : undefined,onEnded:async () => {
      if (token !== generation) return;
      clearTimeout(previewTimer); previewTimer = null;
      if (mode === 'preview') controls.setPreview(false,conversation.state().error ? message('voice.preview.error',{error:t(conversation.state().error)}) : previewHeard ? message('voice.preview.completed',{voice:controls.read().voice,caption:previewCaption}) : t('试听已停止。'));
      await Promise.all([reload(),controls.load()]); if (mounted && token === generation) stateChanged(conversation.state());
    }});
    void controls.bind().then(() => { if (mounted && token === generation) { draw(); stateChanged(conversation.state()); } }); draw(); renderHistory();
    void api('/api/voice/status').then(result => { if (!mounted || token !== generation) return; account = result; $('interview-voice-account').textContent = result.authenticated ? t('Codex CLI 已登录，可以开始面试。') : t('请先在终端运行 codex login。'); stateChanged(conversation.state()); }).catch(error => { if (mounted && token === generation) $('interview-voice-account').textContent = error.message; });
    $('interview-voice-start').onclick = () => { void start(); }; $('interview-voice-test').onclick = () => { void start(true); };
    $('interview-voice-end').onclick = async () => { await conversation.end(); await reload(); };
    $('interview-voice-mute').onclick = () => conversation.mute(); $('interview-voice-play').onclick = () => { void conversation.allowPlayback().catch(error => toast(error.message)); };
    $('interview-voice-stop').onclick = () => { void conversation.stopCurrent(); };
    $('interview-voice-pause').onclick = () => { const state = conversation.state(); void (state.paused && !state.resuming ? conversation.resume() : conversation.pause()); };
    $('interview-voice-next').onclick = () => { void action(progress.questionIndex+1 === progress.questionCount ? 'finish' : 'next'); };
    $('interview-voice-retry').onclick = () => { void action('retry'); }; $('interview-voice-sample').onclick = () => { void sample(); };
  }
  function dispose() { mounted = false; generation++; clearTimeout(previewTimer); previewTimer = null; controls?.dispose(); void conversation?.end(); conversation = null; record = null; content = null; }
  return {render,dispose,hasWorkspace:() => mounted,updateRecord(set) { if (mounted && record.id === set.id) { record = set; renderHistory(); } }};
}
