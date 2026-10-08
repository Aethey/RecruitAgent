import { t, message } from './i18n.js';
import { interviewTitle } from './interview-title.js';
import { element } from './dom.ts';
import './voice.css';
import { createVoiceSession } from './voice-session.js';
import { createVoiceControls } from './voice-controls.js';
import { interviewActivity } from './voice-activity.js';
import { createTranscriptScroller } from './interview-transcript.js';

/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceInterview({ api, escape, pageHeading, date, getState }) {
  let mounted = false, record = null, controls = null, conversation = null, progress = null, account = null, operation = false, mode = 'interview';
  let partial = new Map(), roundStamp = '', historyReloading = false, generation = 0, content = null, preparing = false;
  let inputRounds = new Map(), bridge = Promise.resolve();
  let previewTimer = null, previewHeard = false, previewDone = false, previewQuietAt = 0, previewStopping = false;
  let transcripts = {}, lastIssue = '', sampleReply = '';
  let messages = new Map(), anonymousMessages = new Map(), bubbles = [], messageSequence = 0;
  let pendingUserBubble = null;
  const $ = id => document.getElementById(id);
  const reportError = error => console.error('Voice interview:', error);
  function stateChanged(state) {
    if (!mounted) return;
    controls?.setSession(state);
    $('interview-voice-session').dataset.state = state.phase; $('interview-voice-session').dataset.rxEnergy = String(state.energy); $('interview-voice-session').dataset.rxBytes = String(state.received);
    const issue = state.error || state.notice;
    if (issue && issue !== lastIssue) reportError(issue);
    lastIssue = issue;
    const activity = interviewActivity(state,preparing), indicator = $('interview-voice-activity');
    if (indicator.dataset.activity !== activity.activity) indicator.dataset.activity = activity.activity;
    indicator.hidden = activity.activity === 'idle';
    indicator.style.setProperty('--voice-level',String(activity.level));
    if ($('interview-activity-label').textContent !== activity.label) $('interview-activity-label').textContent = activity.label;
    for (const id of ['interview-voice-start','interview-voice-test']) (/** @type {HTMLButtonElement} */ ($(id))).disabled = operation || preparing || state.busy || !!state.id || !account?.authenticated || !controls.ready();
    const live = mode === 'interview' && (!!state.id || state.busy);
    $('interview-voice-start').hidden = live || (mode === 'preview' && (!!state.id || state.busy));
    $('interview-voice-end').hidden = !live;
    (/** @type {HTMLButtonElement} */ ($('interview-voice-end'))).disabled = state.phase === 'ending';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-mute'))).disabled = state.phase !== 'connected' || state.test || state.paused || state.controlBusy;
    $('interview-voice-mute').hidden = !live || state.test || state.phase !== 'connected';
    $('interview-voice-mute').title = state.muted ? t("ui.turnOnMicrophone") : t("ui.muteMicrophone");
    $('interview-voice-mute').setAttribute('aria-label',$('interview-voice-mute').title);
    $('interview-voice-mute').setAttribute('aria-pressed',String(state.muted));
    $('interview-voice-play').hidden = !state.needsPlayback || state.paused;
    (/** @type {HTMLButtonElement} */ ($('interview-voice-stop'))).disabled = state.phase !== 'connected' || state.controlBusy || state.paused;
    $('interview-voice-stop').hidden = !live || activity.activity !== 'speaking';
    $('interview-voice-pause').hidden = !live || state.phase !== 'connected';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-pause'))).disabled = state.phase !== 'connected' || (state.controlBusy && !state.resuming);
    $('interview-voice-pause').textContent = state.paused && !state.resuming ? t("ui.continueConversation") : t("ui.pauseConversation");
    $('interview-voice-pause').setAttribute('aria-pressed',String(state.paused && !state.resuming));
    const canMove = !operation && !state.controlBusy && !state.paused && !state.inputSpeaking && !state.processing && !state.backendThinking && !state.delegating && !state.outputSpeaking && mode === 'interview' && state.phase === 'connected' && progress?.stage === 'ready';
    $('interview-question-actions').hidden = !live || progress?.stage !== 'ready';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-next'))).disabled = !canMove; (/** @type {HTMLButtonElement} */ ($('interview-voice-retry'))).disabled = !canMove;
    $('interview-voice-next').textContent = progress && progress.questionIndex+1 === progress.questionCount ? t("ui.finishThisInterview") : t("ui.nextQuestion");
    $('interview-voice-sample').hidden = !state.test || mode !== 'interview';
    (/** @type {HTMLButtonElement} */ ($('interview-voice-sample'))).disabled = operation || state.paused || state.controlBusy || !['answering','ready'].includes(progress?.stage) || state.phase !== 'connected';
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
    $('interview-tips-list').innerHTML = show ? (progress?.question.tips ?? (question.tips?.length ? question.tips : [question.focus])).map(tip => `<li>`+escape(tip)+`</li>`).join('') : '';
    const partialText = role => [...partial.values()].filter(part => part.role === role).map(part => part.text).join('');
    const assistantText = partialText('assistant');
    const feedback = (round?.feedback ?? '')+(progress?.responseKind === 'answer' ? assistantText : '');
    const assisting = ['sample','clarification'].includes(progress?.responseKind), reply = (progress?.reply ?? '')+(assisting ? assistantText : '');
    transcripts.feedback.update(feedback || t("ui.afterListeningToYourAnswerCodexWillPoint"));
    $('interview-feedback-live').classList.toggle('interview-placeholder',!feedback);
    if (progress?.responseKind === 'sample') sampleReply = reply;
    $('interview-sample-tab').hidden = !sampleReply && progress?.responseKind !== 'sample';
    transcripts.sample.update(sampleReply || t("ui.respondingToYourRequest"));
    $('interview-sample-live').classList.toggle('interview-placeholder',!sampleReply);
    if (conversation) stateChanged(conversation.state());
  }
  function handleEvent(name, value) {
    if (!mounted) return;
    if (name === 'model-verified') { void controls.load().then(() => { if (mounted) stateChanged(conversation.state()); }); return; }
    if (name === 'interview-notice') { reportError(value.message); return; }
    if (['input-started','response-started','response-ended'].includes(name)) {
      if (mode !== 'interview' || !progress?.round || !Number.isSafeInteger(value.inputRevision)) return;
      const owner = conversation, token = generation, id = owner.state().id, revision = value.inputRevision;
      if (!id) return;
      if (!inputRounds.has(revision)) inputRounds.set(revision,progress.round.at);
      const roundAt = inputRounds.get(revision);
      while (inputRounds.size > 32) inputRounds.delete(inputRounds.keys().next().value);
      if (name === 'response-started') return;
      if (roundAt !== progress.round.at) return;
      if (name === 'input-started') {
        // Audio can finish transcribing after the AI reply arrives. Reserve
        // this position when speech starts so the conversation stays ordered.
        pendingUserBubble = bubbles.at(-1)?.role === 'user' ? bubbles.at(-1) : createBubble('user');
        progress = {...progress,stage:'answering'}; draw();
      }
      bridge = bridge.catch(() => {}).then(async () => {
        if (!mounted || token !== generation || owner !== conversation || owner.state().id !== id || progress?.round?.at !== roundAt) return;
        const result = await api(`/api/voice/sessions/${id}/action`,'POST',{action:name === 'input-started' ? 'answer-started' : 'response-complete',roundAt,inputRevision:revision});
        if (mounted && token === generation && owner === conversation && owner.state().id === id && progress?.round?.at === roundAt) handleEvent('interview-progress',result);
      }).catch(error => { if (mounted && token === generation && owner === conversation) reportError(error); });
      return;
    }
    if (name !== 'interview-progress') return;
    if (value.round?.at !== roundStamp) { resetTranscripts(); roundStamp = value.round?.at ?? ''; }
    progress = value;
    if (value.round && !inputRounds.has(value.inputRevision ?? 0)) inputRounds.set(value.inputRevision ?? 0,value.round.at);
    if (value.stage === 'ready') for (const [key,part] of partial) if (part.role === 'assistant') partial.delete(key);
    draw();
  }
  function transcript(line) {
    if (!mounted) return;
    if (mode === 'preview') { if (line.role === 'assistant' && line.done) previewDone = true; return; }
    if (!['user','assistant'].includes(line.role)) return;
    appendDialogue(line);
    const key = line.role+':'+(line.itemId ?? 'current');
    if (!line.done && (line.role === 'user' || progress?.responseKind === 'answer' || ['sample','clarification'].includes(progress?.responseKind))) partial.set(key,{role:line.role,text:(partial.get(key)?.text ?? '')+line.text});
    // The following progress event commits the final text. Drawing between the
    // two events would briefly empty the viewport and lose a reader's position.
    if (line.done) { partial.delete(key); return; }
    draw();
  }
  function appendDialogue(line) {
    const key = line.itemId ? line.role+':'+line.itemId : anonymousMessages.get(line.role) ?? line.role+':anonymous-'+(++messageSequence);
    if (!line.itemId) anonymousMessages.set(line.role,key);
    let entry = messages.get(key);
    if (!entry) {
      let bubble = line.role === 'user' && pendingUserBubble ? pendingUserBubble : bubbles.at(-1);
      if (!bubble || bubble.role !== line.role) bubble = createBubble(line.role);
      entry = {text:'',bubble}; bubble.parts.push(entry); messages.set(key,entry);
    }
    const next = line.done ? line.text : entry.text+line.text;
    transcripts.dialogue.update(() => {
      if (entry.text === next) return false;
      entry.text = next;
      if (!entry.bubble.node.isConnected) {
        const nextBubble = bubbles.slice(bubbles.indexOf(entry.bubble)+1).find(bubble => bubble.node.isConnected);
        $('interview-dialogue-live').insertBefore(entry.bubble.node,nextBubble?.node ?? null);
      }
      entry.bubble.copy.textContent = entry.bubble.parts.map(part => part.text).filter(Boolean).join('\n');
      $('interview-dialogue-empty').hidden = true;
    });
    if (line.done && !line.itemId) anonymousMessages.delete(line.role);
    if (line.done && line.role === 'user') pendingUserBubble = null;
  }
  function createBubble(role) {
    const node = document.createElement('article'), label = document.createElement('span'), copy = document.createElement('p');
    node.className = 'interview-message interview-message-'+role;
    label.className = 'interview-message-author'; label.textContent = role === 'user' ? t('ui.you') : t('interview.voice.ai');
    copy.className = 'voice-answer-text'; node.append(label,copy);
    const bubble = {role,node,copy,parts:[]}; bubbles.push(bubble);
    return bubble;
  }
  function selectPanel(name) {
    for (const panel of ['dialogue','feedback','sample']) {
      const selected = panel === name, tab = $('interview-'+panel+'-tab');
      tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
      $('interview-'+panel+'-panel').hidden = !selected;
    }
    transcripts[name]?.reveal();
  }
  function resetTranscripts() {
    partial.clear(); messages.clear(); anonymousMessages.clear(); bubbles = []; pendingUserBubble = null; messageSequence = 0; sampleReply = '';
    $('interview-dialogue-live').replaceChildren(); $('interview-dialogue-empty').hidden = false;
    $('interview-question-scroll').scrollTop = 0;
    $('interview-sample-tab').hidden = true;
    Object.values(transcripts).forEach(view => view.reset()); selectPanel('dialogue');
  }
  async function reload() {
    if (!record || historyReloading) return;
    historyReloading = true; const id = record.id;
    try {
      const saved = await api(`/api/interviews/${id}`);
      if (!mounted || record.id !== id) return;
      record = saved; const entries = getState().interviews ?? [], index = entries.findIndex(set => set.id === id); if (index !== -1) entries[index] = saved;
      renderHistory();
    } catch (error) { if (mounted) reportError(error); }
    finally { historyReloading = false; }
  }
  async function start(test = false) {
    if (!controls.ready() || !account?.authenticated) return;
    const owner = conversation; await controls.flush();
    if (!mounted || owner !== conversation) return;
    mode = 'interview'; progress = null; resetTranscripts(); inputRounds.clear(); bridge = Promise.resolve(); roundStamp = '';
    draw();
    try { await prepareContent(controls.read()); } catch (error) { if (mounted) reportError(error); return; }
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
    mode = 'preview'; previewHeard = false; previewDone = false; previewQuietAt = 0; previewStopping = false;
    controls.setPreview(true);
    await owner.start({...settings,preview:true},true);
  }
  async function connected() {
    const owner = conversation;
    if (mode === 'preview') {
      const id = owner.state().id;
      previewTimer = setTimeout(() => { if (mounted && owner === conversation && owner.state().id === id) void owner.end(previewHeard ? '' : t("ui.noPreviewAudioWasReceivedPleaseTryAgain")); },22000);
      await api(`/api/voice/sessions/${id}/preview`,'POST',{}); return;
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
    } catch (error) { reportError(error); }
    finally { operation = false; if (mounted) stateChanged(conversation.state()); }
  }
  async function sample() {
    if (operation) return; operation = true; stateChanged(conversation.state());
    try { await conversation.playClip('/interview-test.wav'); } catch (error) { reportError(error); }
    finally { operation = false; if (mounted) stateChanged(conversation.state()); }
  }
  function renderHistory() {
    if (!mounted) return;
    $('interview-voice-history').innerHTML = (record.voiceAttempts ?? []).slice().reverse().map((attempt,index) => `<details class="card flat voice-attempt"><summary>`+escape(date(attempt.at))+' · '+(attempt.synthetic ? t("ui.speechSynthesisTest") : t("ui.voiceInterview"))+' · '+message('interview.voice.rounds',{count:attempt.rounds.length})+' · '+escape({active:t("ui.inProgress"),completed:t("ui.completed"),stopped:t("ui.ended"),failed:t("ui.connectionFailed"),interrupted:t("ui.connectionInterrupted")}[attempt.status])+`</summary>`+attempt.rounds.map(round => `<section class="voice-history-round"><h3>`+escape(round.question)+`</h3><span class="tag">`+(round.tipsShown ? t("ui.usedTips") : t("ui.unusedTips"))+`</span><h4>${t("ui.myAnswer")}</h4><p>`+escape(round.answer || t("ui.noCompleteAnswerWasLeft"))+`</p><h4>${t("ui.codexFeedback")}</h4><p>`+escape(round.feedback || t("ui.reviewNotCompleted"))+`</p></section>`).join('')+`</details>`).join('') || `<p class="voice-empty-history">${t("ui.afterYouFinishTheVoiceAnswerTheTranscript")}</p>`;
    const old = Object.entries(record.answers).filter(([,answer]) => answer.trim());
    $('interview-written-history').innerHTML = old.length || record.reviews.length ? `<details class="card flat voice-attempt"><summary>${t("ui.previousTextAnswersAndEvaluations")}</summary>`+old.map(([id,answer]) => `<h3>`+escape(record.questions.find(q => q.id === id)?.question ?? id)+`</h3><p class="problem-copy">`+escape(answer)+`</p>`).join('')+record.reviews.map(review => `<details><summary>`+escape(date(review.at))+' · '+escape(review.summary)+`</summary>`+review.items.map(item => `<h4>`+escape(record.questions.find(q => q.id === item.questionId)?.question ?? item.questionId)+`</h4><p>`+escape(item.summary)+`</p><dl class="interview-dimensions">`+Object.entries(item.dimensions).map(([label,value]) => `<div><dt>`+escape({relevance:t("ui.relevance"),conciseness:t("ui.conciseness"),structure:t("ui.conclusionAndStructure"),evidence:t("ui.evidence")}[label])+`</dt><dd>`+escape(value)+`</dd></div>`).join('')+`</dl>`).join('')+`</details>`).join('')+`</details>` : '';
  }
  function renderTranscript(name, label) {
    return `<section id="interview-${name}-panel" class="interview-content-panel" role="tabpanel" aria-labelledby="interview-${name}-tab" ${name === 'dialogue' ? '' : 'hidden'}>
      <div class="voice-transcript-scroll" id="interview-${name}-scroll" tabindex="0" role="region" aria-label="${escape(label)}">
        ${name === 'dialogue' ? `<p id="interview-dialogue-empty" class="interview-placeholder">${t('ui.conversationCaptionsWillAppearHereAfterTheCall')}</p><div id="interview-dialogue-live" class="interview-messages"></div>` : `<h3>${escape(label)}</h3><p id="interview-${name}-live" class="voice-answer-text"></p>`}
      </div>
      <button id="interview-${name}-latest" class="button flat small voice-transcript-latest" type="button" aria-controls="interview-${name}-scroll" hidden>${t('interview.transcript.latest')}</button>
    </section>`;
  }
  function render(set) {
    dispose(); const token = ++generation; mounted = true; record = set; progress = null; account = null; operation = false; mode = 'interview'; partial.clear(); inputRounds.clear(); bridge = Promise.resolve(); roundStamp = ''; preparing = false; lastIssue = '';
    const initial = {language:getState().settings?.userLanguage ?? 'zh',...set.voiceSettings}; content = set.voiceContents?.[initial.language] ?? null;
    controls = createVoiceControls({api,escape,prefix:'interview',tips:true,language:true,preview:true,compact:true,initial,onError:reportError,onChange:async settings => {
      const changedLanguage = record?.voiceSettings?.language !== settings.language;
      const result = await api(`/api/interviews/${set.id}/voice-settings`,'PUT',settings);
      if (mounted && token === generation) {
        record.voiceSettings = result;
        if (changedLanguage && !conversation.state().id && !conversation.state().busy) {
          mode = 'interview'; progress = null; roundStamp = ''; resetTranscripts();
          try { await prepareContent(result); } catch (error) { if (mounted && token === generation) reportError(error); }
        }
        draw();
      }
      return result;
    },onPreview:settings => preview(settings)});
    element('#page').innerHTML = pageHeading(t("chrome.voiceInterview"),escape(interviewTitle(set)),t("ui.codexAsksQuestionsByVoiceAndYouAnswer"),`<a class="button flat" href="#interview">${t("ui.chooseNextSet")}</a>`)+
      `<details class="interview-settings"><summary>${t('ui.voiceSettings')}</summary>${controls.render()}
        <details class="voice-interview-test"><summary>${t("ui.testVoiceInterviewWithoutAMicrophone")}</summary><p class="voice-note">${t("ui.useASyntheticAnswerWithNoClearConclusion")}</p><button id="interview-voice-test" class="button flat small" type="button" disabled>${t("ui.connectToTheInterviewWithSyntheticSpeech")}</button><button id="interview-voice-sample" class="button flat small" type="button" hidden disabled>${t("ui.playSynthesizedAnswer")}</button></details>
      </details>`+
      `<section id="interview-voice-session" class="interview-voice-layout">
        <article class="card flat interview-voice-question">
          <header class="interview-panel-heading"><h2 id="interview-question-number"></h2></header>
          <div id="interview-question-scroll" class="interview-question-body" tabindex="0" role="region" aria-labelledby="interview-question-number">
            <h3 id="interview-question-text"></h3>
            <section id="interview-answer-tips" class="interview-answer-tips"><h3>${t("ui.answerFocusTips")}</h3><ul id="interview-tips-list"></ul></section>
          </div>
          <section class="interview-call-controls" aria-label="${escape(t('chrome.voiceInterview'))}">
            <div id="interview-voice-activity" class="interview-activity" data-activity="idle" hidden>
              <div class="interview-activity-icon" aria-hidden="true">
                <svg class="interview-activity-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>
                <span class="interview-activity-spinner"></span>
                <svg class="interview-activity-speaker" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4 5 9H2v6h3l6 5V4Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14"/></svg>
              </div>
              <div class="interview-activity-copy"><strong id="interview-activity-label" role="status" aria-live="polite" aria-atomic="true"></strong><div class="voice-activity-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div>
            </div>
            <p id="interview-login-note" class="voice-note" hidden>${t("ui.pleaseRunCodexLoginInTheTerminalFirst")}</p>
            <div class="voice-actions interview-session-actions">
              <button id="interview-voice-start" class="button primary" type="button" disabled>${t("ui.startVoiceInterview")}</button>
              <button id="interview-voice-pause" class="button flat" type="button" disabled aria-pressed="false" hidden>${t("ui.pauseConversation")}</button>
              <button id="interview-voice-end" class="button flat interview-end-button" type="button" disabled hidden>${t("ui.endCall")}</button>
              <button id="interview-voice-mute" class="button interview-mute-button" type="button" aria-label="${escape(t('ui.muteMicrophone'))}" title="${escape(t('ui.muteMicrophone'))}" aria-pressed="false" disabled hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/><path class="interview-mic-slash" d="m3 3 18 18"/></svg></button>
            </div>
            <audio id="interview-voice-output" autoplay></audio>
            <button id="interview-voice-play" class="button mint" type="button" hidden>${t("ui.allowSoundPlayback")}</button>
            <div id="interview-question-actions" class="voice-actions interview-question-actions" hidden><button id="interview-voice-retry" class="button flat" type="button" disabled>${t("ui.answerThisQuestionAgain")}</button><button id="interview-voice-next" class="button mint" type="button" disabled>${t("ui.nextQuestion")}</button></div>
          </section>
        </article>
        <article class="card flat interview-voice-feedback">
          <header class="interview-panel-heading"><h2>${t('interview.voice.content')}</h2><button id="interview-voice-stop" class="button small interview-interrupt-button" type="button" disabled hidden>${t('interview.voice.interrupt')}</button></header>
          <div id="interview-content-tabs" class="interview-content-tabs" role="tablist" aria-label="${escape(t('interview.voice.content'))}">
            <button id="interview-dialogue-tab" type="button" role="tab" aria-selected="true" aria-controls="interview-dialogue-panel">${t('interview.voice.conversation')}</button>
            <button id="interview-feedback-tab" type="button" role="tab" aria-selected="false" aria-controls="interview-feedback-panel" tabindex="-1">${t('interview.voice.feedback')}</button>
            <button id="interview-sample-tab" type="button" role="tab" aria-selected="false" aria-controls="interview-sample-panel" tabindex="-1" hidden>${t('ui.sampleAnswer')}</button>
          </div>
          ${renderTranscript('dialogue',t('interview.voice.conversation'))}
          ${renderTranscript('feedback',t("ui.feedbackOnThisAnswer"))}
          ${renderTranscript('sample',t('ui.sampleAnswer'))}
        </article>
      </section>
      <details class="interview-privacy"><summary>${t('interview.voice.privacy')}</summary><p class="voice-note">${t("ui.microphoneAudioWillBeSentToOpenAIAnswer")}</p></details>
      <section class="language-history"><div class="section-heading"><div><h2>${t("ui.voiceInterviewRecords")}</h2><p class="card-subtitle">${t("ui.saveEachAnswerAndItsSpecificFeedbackMark")}</p></div></div><div id="interview-voice-history"></div><div id="interview-written-history"></div></section>`;
    transcripts = Object.fromEntries(['dialogue','feedback','sample'].map(name => [name,createTranscriptScroller({viewport:$('interview-'+name+'-scroll'),text:name === 'dialogue' ? null : $('interview-'+name+'-live'),latest:$('interview-'+name+'-latest')})]));
    resetTranscripts();
    const tabs = [...$('interview-content-tabs').querySelectorAll('button')];
    for (const tab of tabs) {
      tab.onclick = () => selectPanel(tab.id.replace('interview-','').replace('-tab',''));
      tab.onkeydown = event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const visible = tabs.filter(item => !item.hidden), index = visible.indexOf(tab);
        const target = visible[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+visible.length)%visible.length];
        target.click(); target.focus({preventScroll:true});
      };
    }
    conversation = createVoiceSession({api,audio:() => token === generation ? $('interview-voice-output') : null,onState:value => { if (token === generation) stateChanged(value); },onTranscript:line => { if (token === generation) transcript(line); },onEvent:(name,value) => { if (token === generation) handleEvent(name,value); },onConnected:() => token === generation ? connected() : undefined,onEnded:async () => {
      if (token !== generation) return;
      clearTimeout(previewTimer); previewTimer = null;
      if (mode === 'preview') controls.setPreview(false);
      await Promise.all([reload(),controls.load()]); if (mounted && token === generation) stateChanged(conversation.state());
    }});
    void controls.bind().then(() => { if (mounted && token === generation) { draw(); stateChanged(conversation.state()); } }); draw(); renderHistory();
    void api('/api/voice/status').then(result => { if (!mounted || token !== generation) return; account = result; $('interview-login-note').hidden = result.authenticated; stateChanged(conversation.state()); }).catch(reportError);
    $('interview-voice-start').onclick = () => { void start(); }; $('interview-voice-test').onclick = () => { void start(true); };
    $('interview-voice-end').onclick = async () => { await conversation.end(); await reload(); };
    $('interview-voice-mute').onclick = () => conversation.mute(); $('interview-voice-play').onclick = () => { void conversation.allowPlayback().catch(reportError); };
    $('interview-voice-stop').onclick = () => { void conversation.stopCurrent(); };
    $('interview-voice-pause').onclick = () => { const state = conversation.state(); void (state.paused && !state.resuming ? conversation.resume() : conversation.pause()); };
    $('interview-voice-next').onclick = () => { void action(progress.questionIndex+1 === progress.questionCount ? 'finish' : 'next'); };
    $('interview-voice-retry').onclick = () => { void action('retry'); }; $('interview-voice-sample').onclick = () => { void sample(); };
  }
  function dispose() { Object.values(transcripts).forEach(view => view.dispose()); transcripts = {}; messages.clear(); anonymousMessages.clear(); bubbles = []; pendingUserBubble = null; mounted = false; generation++; clearTimeout(previewTimer); previewTimer = null; controls?.dispose(); void conversation?.end(); conversation = null; record = null; content = null; }
  return {render,dispose,hasWorkspace:() => mounted,updateRecord(set) { if (mounted && record.id === set.id) { record = set; renderHistory(); } }};
}
