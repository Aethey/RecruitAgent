import { element, elements } from './dom.ts';
import './voice.css';
import { createVoiceSession } from './voice-session.js';
import { createVoiceControls } from './voice-controls.js';
import { voiceActivity } from './voice-activity.js';
import { t } from './i18n.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceDemo({ api, escape, pageHeading }) {
  let mounted = false, account = null, conversation = null, controls = null, lines = [], pending = new Map(), testKind = '', generation = 0;
  const $ = selector => element(selector);
  const phases = {idle:'等待开始',connecting:'正在连接',connected:'通话中',ending:'正在结束',ended:'通话已结束',error:'连接失败'};
  function update(state = conversation?.state()) {
    if (!mounted || !state) return;
    $('#voice-demo').dataset.state = state.phase;
    $('#voice-demo').dataset.rxEnergy = String(state.energy); $('#voice-demo').dataset.rxBytes = String(state.received);
    const activity = voiceActivity(state,state.test ? 'probe' : 'demo');
    $('#voice-demo').dataset.activity = activity.activity; $('#voice-demo').dataset.animate = String(activity.animate);
    $('#voice-phase').textContent = state.phase === 'connected' ? activity.label : phases[state.phase];
    $('#voice-message').textContent = state.error || (state.phase === 'connected' ? activity.detail : '你说一句，Codex 用语音回一句。');
    $('#voice-error').hidden = !state.error; $('#voice-error').textContent = state.error;
    $('#voice-account').textContent = account ? account.authenticated ? 'Codex CLI 已登录 · '+(account.authType === 'chatgpt' ? 'ChatGPT 登录' : account.authType) : 'Codex CLI 尚未登录' : '正在检查 Codex CLI…';
    for (const id of ['#voice-start','#voice-test','#voice-status-refresh']) $(id).disabled = state.busy || !!state.id || !account?.authenticated;
    $('#voice-end').disabled = !state.id && !state.busy; $('#voice-mute').disabled = state.phase !== 'connected' || state.test || state.paused || state.controlBusy;
    $('#voice-stop').disabled = state.phase !== 'connected' || state.paused || state.controlBusy;
    const recovering = state.resuming || state.stopped && state.controlBusy, suspended = state.paused && !recovering;
    $('#voice-pause').disabled = state.phase !== 'connected' || state.controlBusy && suspended;
    $('#voice-pause').textContent = suspended ? '继续对话' : '暂停对话'; $('#voice-pause').setAttribute('aria-pressed',String(suspended));
    $('#voice-mute').textContent = state.muted ? '打开麦克风' : '麦克风静音'; $('#voice-mute').setAttribute('aria-pressed',String(state.muted));
    $('#voice-play').hidden = !state.needsPlayback || state.paused;
    $('#voice-time').textContent = state.phase === 'connected' ? state.elapsed+' 秒' : '—';
    $('#voice-stats').textContent = '发送 '+(state.sent/1024).toFixed(1)+' KB · 接收 '+(state.received/1024).toFixed(1)+' KB';
    controls?.lock(state.busy || !!state.id);
  }
  function transcript(line) {
    if (!mounted || !line.text) return;
    let current = pending.get(line.role);
    if (!current) { current = {role:line.role,text:''}; lines.push(current); pending.set(line.role,current); }
    current.text = line.done ? line.text : current.text+line.text;
    if (line.done) pending.delete(line.role);
    $('#voice-transcripts').innerHTML = lines.slice(-100).map(item => '<div class="voice-turn '+(item.role === 'user' ? 'voice-user' : 'voice-assistant')+'"><strong>'+(item.role === 'user' ? '你' : 'Codex')+'</strong><p>'+escape(item.text)+'</p></div>').join('');
    $('#voice-transcripts').scrollTop = $('#voice-transcripts').scrollHeight;
  }
  async function refresh() {
    const owner = conversation;
    try { const result = await api('/api/voice/status'); if (!mounted || owner !== conversation) return; account = result; update(); }
    catch (error) { if (mounted && owner === conversation) { $('#voice-account').textContent = error.message; } }
  }
  async function start(test, kind = 'conversation') {
    if (!account?.authenticated || !controls.ready()) return;
    const owner = conversation; await controls.flush();
    if (!mounted || owner !== conversation) return;
    lines = []; pending.clear(); $('#voice-transcripts').innerHTML = ''; $('#voice-test-progress').textContent = ''; testKind = kind;
    await conversation.start(controls.read(),test);
  }
  async function connected() {
    const owner = conversation, id = owner.state().id, revision = owner.state().revision;
    if (!owner.state().test) return;
    const clips = testKind === 'model' ? [2] : [1,2];
    for (const clip of clips) {
      if (!mounted || owner !== conversation || owner.state().id !== id || owner.state().revision !== revision) return;
      $('#voice-test-progress').textContent = testKind === 'model' ? '正在发送合成语音，验证所选模型。' : clip === 1 ? '第 1 轮：请记住暗号「蓝鲸」。' : '第 2 轮：询问刚才的暗号。';
      await owner.playClip('/voice-test-'+clip+'.wav');
      await new Promise(resolve => setTimeout(resolve,testKind === 'model' ? 6000 : 9000));
    }
    if (!mounted || owner !== conversation || owner.state().id !== id || owner.state().revision !== revision) return;
    $('#voice-test-progress').textContent = owner.state().energy > 0 ? '已收到真实语音，请查看字幕和模型验证结果。' : '尚未收到有声回复，请检查字幕和连接状态。';
    if (testKind === 'model') { await owner.end(); await controls.load(); }
  }
  function dispose() { if (!mounted) return; mounted = false; generation++; controls?.dispose(); void conversation?.end(); conversation = null; }
  function render() {
    if (mounted && $('#voice-demo')) return;
    const token = ++generation; mounted = true; account = null; lines = []; pending.clear();
    controls = createVoiceControls({api,escape,prefix:'demo-voice',onTest:() => start(true,'model'),onError:error => { if (mounted) $('#voice-error').textContent = error.message; }});
    $('#page').innerHTML = pageHeading('CODEX VOICE DEMO','和 Codex，说几句话。','直接语音交流，保留本次通话的上下文。',t('<a class="button flat" href="#settings">返回设置</a>'))+controls.render()+
      '<section id="voice-demo" class="voice-layout"><article class="card flat voice-console"><div class="voice-top"><span class="tag">直连 Codex · 实验性</span><span id="voice-time">—</span></div><div class="voice-orb convex" aria-hidden="true"><span>◉</span></div><h2 id="voice-phase" role="status">等待开始</h2><p id="voice-message"></p><p id="voice-account" class="voice-account"></p><div class="voice-actions"><button id="voice-start" class="button primary" type="button" disabled>开始语音对话</button><button id="voice-stop" class="button flat" type="button" disabled>停止本轮回复</button><button id="voice-pause" class="button flat" type="button" disabled aria-pressed="false">暂停对话</button><button id="voice-end" class="button flat" type="button" disabled>结束通话</button><button id="voice-mute" class="button flat" type="button" disabled>麦克风静音</button></div><audio id="voice-output" autoplay></audio><button id="voice-play" class="button mint" type="button" hidden>允许播放声音</button><p class="voice-note">麦克风音频会发送给 OpenAI。结束通话或离开此模块会停止录音。本 Demo 不保存录音或字幕。</p><p id="voice-error" class="voice-error" role="alert" hidden></p><div class="voice-test-box pressed"><strong>先检测语音连接</strong><p>发送两段合成语音：先记住「蓝鲸」，再询问暗号。无需麦克风。</p><div class="voice-actions"><button id="voice-test" class="button mint" type="button" disabled>运行连接测试</button><button id="voice-status-refresh" class="button flat small" type="button" disabled>重新检查登录</button></div><p id="voice-test-progress" role="status"></p></div><p id="voice-stats" class="voice-stats"></p></article><article class="card flat voice-caption-panel"><div class="section-heading"><div><h2>这次的对话</h2><p class="card-subtitle">实时字幕可能与实际说话略有差异。</p></div><span class="section-number">LIVE</span></div><div id="voice-transcripts" class="voice-transcripts" role="log" aria-live="polite"><p class="voice-empty">通话开始后，对话字幕会显示在这里。</p></div></article></section>';
    conversation = createVoiceSession({api,audio:() => token === generation ? $('#voice-output') : null,onState:value => { if (token === generation) update(value); },onTranscript:line => { if (token === generation) transcript(line); },onConnected:() => token === generation ? connected() : undefined,onEnded:async () => { if (token !== generation) return; await controls.load(); if (mounted && token === generation) update(); },onEvent:name => { if (token === generation && name === 'model-verified') void controls.load(); }});
    void controls.bind().then(() => { if (mounted && token === generation) update(); }); update(); void refresh();
    $('#voice-start').onclick = () => { void start(false); }; $('#voice-test').onclick = () => { void start(true); };
    $('#voice-end').onclick = () => { void conversation.end(); }; $('#voice-mute').onclick = () => conversation.mute();
    $('#voice-stop').onclick = () => { void conversation.stopCurrent(); };
    $('#voice-pause').onclick = () => { const state = conversation.state(); void (state.paused && !state.resuming && !(state.stopped && state.controlBusy) ? conversation.resume() : conversation.pause()); };
    $('#voice-status-refresh').onclick = () => { void refresh(); void controls.load(); };
    $('#voice-play').onclick = () => { void conversation.allowPlayback().catch(() => {}); };
  }
  return {render,dispose};
}
