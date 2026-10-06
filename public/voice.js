import { element, elements } from './dom.ts';
import './voice.css';
import { createVoiceSession } from './voice-session.js';
import { createVoiceControls } from './voice-controls.js';
import { voiceActivity } from './voice-activity.js';
import { t, message, catalogText, errorText } from './i18n.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceDemo({ api, escape, pageHeading }) {
  let mounted = false, account = null, conversation = null, controls = null, lines = [], pending = new Map(), testKind = '', generation = 0;
  const $ = selector => element(selector);
  const phases = {idle:t("ui.waitingToStart"),connecting:t("ui.connecting"),connected:t("ui.onCall"),ending:t("ui.ending"),ended:t("ui.callEnded"),error:t("ui.connectionFailed")};
  function update(state = conversation?.state()) {
    if (!mounted || !state) return;
    controls?.setSession(state);
    $('#voice-demo').dataset.state = state.phase;
    $('#voice-demo').dataset.rxEnergy = String(state.energy); $('#voice-demo').dataset.rxBytes = String(state.received);
    const activity = voiceActivity(state,state.test ? 'probe' : 'demo');
    $('#voice-demo').dataset.activity = activity.activity; $('#voice-demo').dataset.animate = String(activity.animate);
    $('#voice-phase').textContent = state.phase === 'connected' ? activity.label : phases[state.phase];
    $('#voice-message').textContent = errorText(state.error) || (state.phase === 'connected' ? activity.detail : t("ui.saySomethingAndCodexWillReplyByVoice"));
    $('#voice-error').hidden = !state.error; $('#voice-error').textContent = errorText(state.error);
    $('#voice-account').textContent = account ? account.authenticated ? message('voice.account',{method:account.authType === 'chatgpt' ? t("ui.chatGPTLogin") : account.authType ?? ''}) : t("ui.codexCLIIsNotLoggedInYet") : t("ui.checkingCodexCLI");
    for (const id of ['#voice-start','#voice-test','#voice-status-refresh']) $(id).disabled = state.busy || !!state.id || !account?.authenticated;
    $('#voice-end').disabled = !state.id && !state.busy; $('#voice-mute').disabled = state.phase !== 'connected' || state.test || state.paused || state.controlBusy;
    $('#voice-stop').disabled = state.phase !== 'connected' || state.paused || state.controlBusy;
    const recovering = state.resuming || state.stopped && state.controlBusy, suspended = state.paused && !recovering;
    $('#voice-pause').disabled = state.phase !== 'connected' || state.controlBusy && suspended;
    $('#voice-pause').textContent = suspended ? t("ui.continueConversation") : t("ui.pauseConversation"); $('#voice-pause').setAttribute('aria-pressed',String(suspended));
    $('#voice-mute').textContent = state.muted ? t("ui.turnOnMicrophone") : t("ui.muteMicrophone"); $('#voice-mute').setAttribute('aria-pressed',String(state.muted));
    $('#voice-play').hidden = !state.needsPlayback || state.paused;
    $('#voice-time').textContent = state.phase === 'connected' ? message('voice.seconds',{seconds:state.elapsed}) : '—';
    $('#voice-stats').textContent = message('voice.bytes',{sent:(state.sent/1024).toFixed(1),received:(state.received/1024).toFixed(1)});
    controls?.lock(state.busy || !!state.id);
  }
  function transcript(line) {
    if (!mounted || !line.text) return;
    let current = pending.get(line.role);
    if (!current) { current = {role:line.role,text:''}; lines.push(current); pending.set(line.role,current); }
    current.text = line.done ? line.text : current.text+line.text;
    if (line.done) pending.delete(line.role);
    $('#voice-transcripts').innerHTML = lines.slice(-100).map(item => `<div class="voice-turn `+(item.role === 'user' ? 'voice-user' : 'voice-assistant')+`"><strong>`+(item.role === 'user' ? t("ui.you") : 'Codex')+`</strong><p>`+escape(item.text)+`</p></div>`).join('');
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
      $('#voice-test-progress').textContent = testKind === 'model' ? t("ui.sendingSyntheticSpeechToVerifyTheSelectedModel") : clip === 1 ? t("ui.roundRememberThePassphraseBlueWhale") : t("ui.roundAskForThePreviousPassphrase");
      await owner.playClip('/voice-test-'+clip+'.wav');
      await new Promise(resolve => setTimeout(resolve,testKind === 'model' ? 6000 : 9000));
    }
    if (!mounted || owner !== conversation || owner.state().id !== id || owner.state().revision !== revision) return;
    $('#voice-test-progress').textContent = owner.state().energy > 0 ? t("ui.realSpeechReceivedCheckTheCaptionsAndModel") : t("ui.noAudibleResponseHasBeenReceivedYetCheck");
    if (testKind === 'model') { await owner.end(); await controls.load(); }
  }
  function dispose() { if (!mounted) return; mounted = false; generation++; controls?.dispose(); void conversation?.end(); conversation = null; }
  function render() {
    if (mounted && $('#voice-demo')) return;
    const token = ++generation; mounted = true; account = null; lines = []; pending.clear();
    controls = createVoiceControls({api,escape,prefix:'demo-voice',onTest:() => start(true,'model'),onError:error => { if (mounted) $('#voice-error').textContent = error.message; }});
    $('#page').innerHTML = pageHeading(t("chrome.codexVoiceDemo"),t("ui.sayAFewWordsWithCodex"),t("ui.speakDirectlyByVoiceAndKeepTheContext"),`<a class="button flat" href="#settings">${t("ui.backToSettings")}</a>`)+controls.render()+
      `<section id="voice-demo" class="voice-layout"><article class="card flat voice-console"><div class="voice-top"><span class="tag">${t("ui.directCodexConnectionExperimental")}</span><span id="voice-time">—</span></div><div class="voice-orb convex" aria-hidden="true"><span>◉</span></div><h2 id="voice-phase" role="status">${t("ui.waitingToStart")}</h2><p id="voice-message"></p><p id="voice-account" class="voice-account"></p><div class="voice-actions"><button id="voice-start" class="button primary" type="button" disabled>${t("ui.startVoiceConversation")}</button><button id="voice-stop" class="button flat" type="button" disabled>${t("ui.stopThisReply")}</button><button id="voice-pause" class="button flat" type="button" disabled aria-pressed="false">${t("ui.pauseConversation")}</button><button id="voice-end" class="button flat" type="button" disabled>${t("ui.endCall")}</button><button id="voice-mute" class="button flat" type="button" disabled>${t("ui.muteMicrophone")}</button></div><audio id="voice-output" autoplay></audio><button id="voice-play" class="button mint" type="button" hidden>${t("ui.allowSoundPlayback")}</button><p class="voice-note">${t("ui.microphoneAudioWillBeSentToOpenAIEnding")}</p><p id="voice-error" class="voice-error" role="alert" hidden></p><div class="voice-test-box pressed"><strong>${t("ui.checkTheVoiceConnectionFirst")}</strong><p>${t("ui.sendTwoSyntheticVoiceClipsFirstRememberBlue")}</p><div class="voice-actions"><button id="voice-test" class="button mint" type="button" disabled>${t("ui.runConnectionTest")}</button><button id="voice-status-refresh" class="button flat small" type="button" disabled>${t("ui.checkSignInAgain")}</button></div><p id="voice-test-progress" role="status"></p></div><p id="voice-stats" class="voice-stats"></p></article><article class="card flat voice-caption-panel"><div class="section-heading"><div><h2>${t("ui.thisConversation")}</h2><p class="card-subtitle">${t("ui.liveCaptionsMayDifferSlightlyFromTheActual")}</p></div><span class="section-number">${t("chrome.live")}</span></div><div id="voice-transcripts" class="voice-transcripts" role="log" aria-live="polite"><p class="voice-empty">${t("ui.conversationCaptionsWillAppearHereAfterTheCall")}</p></div></article></section>`;
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
