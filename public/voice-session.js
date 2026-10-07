import { t, message, errorText } from './i18n.js';
import { eventData, readApiResponse } from './api.ts';
// Shared microphone/WebRTC lifecycle for the demo and the interview module.
/** @param {{api: import('../src/generated/api-client.js').ApiClient, [option: string]: any}} options */
export function createVoiceSession({ api, audio, onState = () => {}, onTranscript = () => {}, onEvent = () => {}, onConnected = () => {}, onEnded = () => {} }) {
  let epoch = 0, peer = null, channel = null, stream = null, context = null, destination = null, events = null, timer = null, source = null, silence = null, verified = false, ending = null;
  let verifying = false, verifyAfter = 0, lastDiagnostic = '', diagnosticsReady = false;
  let inputNode = null, outputNode = null, inputMeter = null, outputMeter = null, meterTimer = null, lastOutput = 0, lastInput = 0, outputQuietAt = 0, resumeAt = 0, protocol = 'live', controlQueue = /** @type {Promise<unknown>} */ (Promise.resolve());
  const initial = () => ({phase:'idle',id:null,busy:false,muted:false,test:false,recording:false,audioVerified:false,inputLevel:0,outputLevel:0,outputSpeaking:false,inputSpeaking:false,processing:false,backendThinking:false,delegating:false,processingSince:0,processingElapsed:0,paused:false,stopped:false,resuming:false,controlBusy:false,playbackBlocked:false,revision:0,notice:'',error:'',elapsed:0,sent:0,received:0,energy:0,needsPlayback:false});
  let state = initial();
  let inputRevision = 0, activeResponseRevision = null, activeResponseId = null;
  const responseRevisions = new Map();
  /** @param {import('../src/contracts/api.ts').VoiceDiagnosticInput['event']} event */
  function diagnostic(event, detail = {}, id = state.id) {
    if (id && diagnosticsReady) void api(`/api/voice/sessions/${id}/diagnostics`,'POST',{event,...detail}).catch(() => {});
  }
  const notify = () => {
    const detail = {phase:state.phase,recording:state.recording,processing:state.processing,backendThinking:state.backendThinking,paused:state.paused,outputSpeaking:state.outputSpeaking,audioVerified:state.audioVerified,revision:state.revision,message:state.error || state.notice};
    const key = JSON.stringify(detail);
    if (state.id && key !== lastDiagnostic) { lastDiagnostic = key; diagnostic('state',detail); }
    onState({ ...state });
  };
  const pending = (backendThinking = state.backendThinking) => {
    state = {...state,inputSpeaking:false,processing:true,backendThinking,processingSince:state.processingSince || Date.now(),notice:''}; notify();
  };
  const cancelEvents = new Set();
  function send(type) {
    if (channel?.readyState !== 'open') return;
    const event_id = 'voice-control-'+crypto.randomUUID(); cancelEvents.add(event_id);
    channel.send(JSON.stringify({type,event_id}));
  }
  function receiveActivity(value) {
    if (state.paused && !['failed','timeout'].includes(value.activity)) return;
    if (value.activity === 'thinking') pending(true);
    else if (value.activity === 'waiting') pending();
    else if (value.activity === 'processing') { state = {...state,backendThinking:false,delegating:false,processingSince:0}; pending(false); }
    else if (['failed','timeout'].includes(value.activity)) {
      state = {...state,backendThinking:false,delegating:false,processing:false,processingSince:0,notice:errorText(value.message) || t("ui.thisTurnFailedYouCanStopThisTurn")}; notify();
      if (value.activity === 'timeout' && !state.paused) void stopCurrent(value.message);
    } else if (value.activity === 'listening') { state = {...state,backendThinking:false,notice:''}; notify(); }
  }
  function receiveTranscript(line) {
    if (!state.paused) {
      if (line.role === 'assistant' && state.notice) { state = {...state,notice:''}; notify(); }
      if (line.role === 'user' && line.done) pending();
      if (line.role === 'assistant' && line.done && line.source !== 'segment' && !state.backendThinking && !state.delegating) { state = {...state,processing:false,processingSince:0,processingElapsed:0}; notify(); }
    }
    onTranscript(line);
  }
  function receiveMessage(message) {
    if (['error','response.created','response.done','turn.created','turn.done','delegation.created','session.delegation.created'].includes(message.type)) diagnostic(message.type === 'error' ? 'error' : 'response',{type:message.type,responseId:message.response?.id ?? message.turn?.id ?? message.response_id,inputRevision,code:message.error?.code,message:message.error?.message});
    if (message.type === 'error') {
      const error = message.error ?? {};
      // Canceling a response that has just completed is an expected race.
      if (cancelEvents.has(error.event_id ?? error.client_event_id) && error.code === 'response_cancel_not_active') return;
      void end(error.message ?? t("ui.theVoiceServiceReturnedAnError")); return;
    }
    if (state.paused) return;
    const type = message.type, role = message.turn?.role;
    if (type === 'input_audio_buffer.speech_started' || type === 'turn.created' && role === 'user') {
      inputRevision++; onEvent('input-started',{inputRevision});
    }
    const responseId = message.response?.id ?? message.turn?.id ?? message.response_id;
    if (type === 'response.created' || type === 'turn.created' && role === 'assistant') {
      state = {...state,notice:''};
      activeResponseRevision = inputRevision;
      activeResponseId = responseId ?? null;
      if (responseId) responseRevisions.set(responseId,inputRevision);
      onEvent('response-started',{inputRevision,...(responseId ? {responseId} : {})});
    }
    if (type === 'response.done' || type === 'turn.done' && role === 'assistant') {
      const revision = responseId ? responseRevisions.get(responseId) : activeResponseRevision;
      const status = message.response?.status ?? message.turn?.status ?? message.status;
      if (revision != null && !['cancelled','canceled','failed','error','incomplete'].includes(status) && !message.error) onEvent('response-ended',{inputRevision:revision,...(responseId ? {responseId} : {})});
      if (responseId) responseRevisions.delete(responseId);
      if (!responseId || responseId === activeResponseId) { activeResponseRevision = null; activeResponseId = null; }
    }
    if (type === 'input_audio_buffer.speech_started' || type === 'input_transcript.added' || type === 'session.input_transcript.delta' || (type === 'turn.created' && role === 'user')) {
      lastInput = Date.now(); state = {...state,inputSpeaking:true,processing:false,processingSince:state.delegating || state.backendThinking ? state.processingSince : 0,notice:''}; notify();
    } else if (type === 'delegation.created' || type === 'session.delegation.created') { state = {...state,delegating:true}; pending(); }
    else if (type === 'input_audio_buffer.speech_stopped' || type === 'response.created' || (type === 'turn.done' && role === 'user')) pending();
    else if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared' || type === 'response.done' || (type === 'turn.done' && role === 'assistant')) {
      if (!state.backendThinking && !state.delegating) { state = {...state,processing:false,processingSince:0,processingElapsed:0}; notify(); }
    }
  }
  function meter(media) {
    const node = context.createMediaStreamSource(media), analyser = context.createAnalyser();
    analyser.fftSize = 256; node.connect(analyser);
    return {node,analyser,data:new Uint8Array(analyser.fftSize)};
  }
  function level(meter) {
    if (!meter) return 0;
    meter.analyser.getByteTimeDomainData(meter.data);
    return Math.min(1,Math.sqrt(meter.data.reduce((sum,value) => sum+((value-128)/128)**2,0)/meter.data.length)*4);
  }
  function release() {
    clearInterval(timer); timer = null; events?.close(); events = null;
    clearInterval(meterTimer); meterTimer = null;
    inputNode?.disconnect(); outputNode?.disconnect(); inputNode = null; outputNode = null; inputMeter = null; outputMeter = null;
    source?.stop(); source = null; silence?.stop(); silence = null; stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (channel) { channel.onmessage = null; channel.onopen = null; channel = null; }
    if (peer) { peer.onconnectionstatechange = null; peer.ontrack = null; peer.close(); peer = null; }
    const output = audio(); if (output) { output.pause(); output.srcObject = null; }
    void context?.close().catch(() => {}); context = null; destination = null;
    window.removeEventListener('pagehide',leave);
  }
  async function end(error = '') {
    if (ending) return ending;
    ending = (async () => {
      diagnostic('transport',{type:'ending',message:error});
      diagnosticsReady = false;
      epoch++; const id = state.id; release();
      resumeAt = 0;
      state = { ...state, id:null, busy:true, recording:false, inputLevel:0, outputLevel:0, outputSpeaking:false, inputSpeaking:false,processing:false,backendThinking:false,delegating:false,paused:false,stopped:false,resuming:false,controlBusy:false,phase:error ? 'error' : 'ending', error:errorText(error), needsPlayback:false }; notify();
      if (id) {
        try {
          const response = await fetch('/api/voice/sessions/'+id,{method:'DELETE',keepalive:true});
          await readApiResponse('DELETE /api/voice/sessions/{id}',response,errorText);
        } catch (failure) { state = {...state,phase:'error',error:failure.message}; }
      }
      try { await onEnded(); }
      finally { state = {...state,busy:false,phase:state.error ? 'error' : 'ended'}; notify(); }
    })();
    try { await ending; } finally { ending = null; }
  }
  function leave() { void end(); }
  async function stats(token, options) {
    if (!peer || token !== epoch) return;
    try {
      const report = await peer.getStats(); if (token !== epoch) return;
      let sent = 0, received = 0, energy = 0;
      report.forEach(item => {
        if ((item.kind ?? item.mediaType) !== 'audio') return;
        if (item.type === 'outbound-rtp') sent += item.bytesSent ?? 0;
        if (item.type === 'inbound-rtp') { received += item.bytesReceived ?? 0; energy += item.totalAudioEnergy ?? 0; }
      });
      state = { ...state, sent, received, energy }; notify();
      if (!verified && !verifying && Date.now() >= verifyAfter && options.model && energy > 0 && received > 0) {
        const id = state.id; verifying = true;
        void api(`/api/voice/sessions/${id}/verify`,'POST',{energy,received}).then(() => {
          if (token !== epoch || state.id !== id) return;
          verified = true; state = {...state,audioVerified:true}; notify(); onEvent('model-verified',{});
        }).catch(error => {
          if (token !== epoch || state.id !== id) return;
          verifyAfter = Date.now()+5000; diagnostic('verification',{type:'failed',message:error.message});
        }).finally(() => { if (token === epoch) verifying = false; });
      }
    } catch { /* Closing a peer invalidates its statistics. */ }
  }
  async function start(options = {}, test = false) {
    if (ending || state.busy || state.id) return;
    const token = ++epoch; verified = false; verifying = false; verifyAfter = 0; lastDiagnostic = ''; diagnosticsReady = false;
    lastOutput = 0; lastInput = 0; outputQuietAt = 0; resumeAt = 0; cancelEvents.clear(); responseRevisions.clear(); inputRevision = 0; activeResponseRevision = null; activeResponseId = null; controlQueue = /** @type {Promise<unknown>} */ (Promise.resolve());
    protocol = options.model?.startsWith('gpt-realtime') ? 'realtime' : 'live';
    state = {...initial(),phase:'connecting',busy:true,test}; notify();
    const output = audio(); if (output) output.muted = false;
    window.addEventListener('pagehide',leave);
    try {
      if (!window.isSecureContext || !window.RTCPeerConnection || !window.AudioContext) throw new Error(t("ui.pleaseOpenThisThroughLocalhostOrHTTPSIn"));
      context = new AudioContext(); await context.resume(); if (token !== epoch) return;
      if (test) {
        destination = context.createMediaStreamDestination(); stream = destination.stream;
        // Keep audio frames flowing while the interviewer starts speaking before a sample is played.
        silence = context.createConstantSource(); silence.offset.value = 0; silence.connect(destination); silence.start();
      }
      else {
        const microphone = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        if (token !== epoch) { microphone.getTracks().forEach(track => track.stop()); return; }
        stream = microphone;
        inputMeter = meter(stream); inputNode = inputMeter.node;
        stream.getAudioTracks().forEach(track => { track.onended = () => { if (token === epoch) void end(t("ui.microphoneDisconnectedPleaseStartAgain")); }; });
      }
      meterTimer = setInterval(() => {
        if (token !== epoch) return;
        const now = Date.now(), rawOutput = level(outputMeter);
        if (rawOutput > .025) outputQuietAt = 0; else outputQuietAt ||= now;
        if (resumeAt && state.phase === 'connected' && state.resuming && outputQuietAt && now-outputQuietAt > 700) {
          resumeAt = 0; state = {...state,paused:false,stopped:false,resuming:false,playbackBlocked:false,controlBusy:false,notice:''};
          stream?.getAudioTracks().forEach(track => { track.enabled = !state.muted; });
          const output = audio(), revision = state.revision; if (output) { output.muted = false; void output.play().catch(() => { if (token === epoch && revision === state.revision) { state = {...state,needsPlayback:true}; notify(); } }); }
        } else if (resumeAt && now-resumeAt > 5000) {
          resumeAt = 0; state = {...state,resuming:false,controlBusy:false,notice:t("ui.thePreviousResponseStillHasNotStoppedSo")};
        }
        const recording = state.phase === 'connected' && !state.paused && !state.test && !state.muted && stream?.getAudioTracks().some(track => track.readyState === 'live' && track.enabled);
        const inputLevel = recording ? level(inputMeter) : 0, outputLevel = state.playbackBlocked ? 0 : rawOutput;
        if (outputLevel > .025) lastOutput = now;
        const outputSpeaking = !state.paused && !state.playbackBlocked && state.phase === 'connected' && now-lastOutput < 550;
        if (outputSpeaking) state = {...state,notice:''};
        if (inputLevel > .04) { lastInput = now; state = {...state,inputSpeaking:true,processing:false,processingSince:state.delegating || state.backendThinking ? state.processingSince : 0,notice:''}; }
        else if (state.inputSpeaking && now-lastInput > 900 && !state.paused) pending();
        if ((outputSpeaking || state.outputSpeaking && !outputSpeaking) && !state.backendThinking && !state.delegating) state = {...state,processing:false,processingSince:0,processingElapsed:0};
        state = {...state,recording:!!recording,inputLevel,outputLevel,outputSpeaking}; notify();
      },100);
      peer = new RTCPeerConnection(); stream.getTracks().forEach(track => peer.addTrack(track,stream));
      channel = peer.createDataChannel('oai-events',{ordered:true});
      channel.onmessage = event => {
        if (token !== epoch) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        receiveMessage(message);
      };
      let connectedOnce = false, negotiatedAt = 0, connectedAt = 0;
      function connected() {
        if (token !== epoch || connectedOnce || peer?.connectionState !== 'connected' || channel.readyState !== 'open') return;
        connectedOnce = true; connectedAt = Date.now(); state = {...state,phase:'connected',busy:false,recording:!test && !state.muted}; notify();
        void Promise.resolve(onConnected()).catch(error => { if (token === epoch) void end(error.message); });
      }
      channel.onopen = connected;
      peer.onconnectionstatechange = () => {
        if (token !== epoch) return;
        diagnostic('transport',{type:peer.connectionState});
        if (peer.connectionState === 'failed') void end(t("ui.voiceNetworkConnectionFailedPleaseTryAgain")); else connected();
      };
      peer.ontrack = event => {
        if (token !== epoch) return;
        const output = audio(); if (!output) return;
        output.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        outputNode?.disconnect(); outputMeter = meter(output.srcObject); outputNode = outputMeter.node;
        void output.play().catch(() => { if (token === epoch) { state = {...state,needsPlayback:true}; notify(); } });
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') await new Promise(resolve => {
        const rtc = peer, timeout = setTimeout(finish,3000);
        function finish() { clearTimeout(timeout); rtc.removeEventListener('icegatheringstatechange',changed); resolve(); }
        function changed() { if (rtc.iceGatheringState === 'complete') finish(); }
        rtc.addEventListener('icegatheringstatechange',changed);
      });
      if (token !== epoch) return;
      const id = crypto.randomUUID(); state = {...state,id}; notify();
      const result = await api('/api/voice/sessions','POST',{...options,id,sdp:peer.localDescription.sdp});
      if (token !== epoch) { await fetch('/api/voice/sessions/'+id,{method:'DELETE',keepalive:true}); return; }
      diagnosticsReady = true;
      if (result.interview) onEvent('interview-progress',result.interview);
      events = new EventSource(`/api/voice/sessions/${id}/events`);
      events.addEventListener('transcript',event => { if (token === epoch) receiveTranscript(eventData('transcript', event)); });
      events.addEventListener('voice-activity',event => { if (token === epoch) receiveActivity(eventData('voice-activity', event)); });
      events.addEventListener('voice-control',event => {
        if (token !== epoch) return;
        let action;
        try { ({action} = eventData('voice-control', event)); } catch { return; }
        if (action === 'stop') void stopCurrent();
        else if (action === 'pause') void pause();
        else if (action === 'resume') void resume();
      });
      events.addEventListener('interview-progress',event => { if (token === epoch) onEvent('interview-progress',eventData('interview-progress', event)); });
      events.addEventListener('voice-error',event => { if (token === epoch) void end(eventData('voice-error', event).message); });
      events.addEventListener('ended',() => { if (token === epoch) void end(); });
      events.onerror = () => { if (token === epoch && events?.readyState === EventSource.CLOSED) void end(t("ui.theCaptionConnectionWasLostStartAgain")); };
      await peer.setRemoteDescription({type:'answer',sdp:result.sdp}); negotiatedAt = Date.now();
      timer = setInterval(() => {
        if (token !== epoch) return;
        state = {...state,elapsed:connectedAt ? Math.floor((Date.now()-connectedAt)/1000) : 0,processingElapsed:state.processingSince ? Math.floor((Date.now()-state.processingSince)/1000) : 0};
        if ((state.processing || state.backendThinking || state.delegating) && state.processingElapsed >= 45 && !state.paused && !state.controlBusy) void stopCurrent(t("ui.thisTurnTimedOutStoppingTheOldResponse"));
        void stats(token,options);
        if (!connectedOnce && Date.now()-negotiatedAt > 20000) void end(t("ui.voiceNetworkNegotiationTimedOutPleaseTryAgain"));
      },1000);
      connected();
    } catch (error) {
      if (token !== epoch) return;
      const message = error.name === 'NotAllowedError' ? t("ui.pleaseAllowMicrophoneAccessForThisPageOr") : error.name === 'NotFoundError' ? t("ui.noMicrophoneWasFoundYouCanTestWith") : error.message;
      await end(message);
    }
  }
  async function playClip(url) {
    if (state.phase !== 'connected' || !state.test || !context || !destination) throw new Error(t("ui.pleaseConnectTheSyntheticVoiceTestFirst"));
    if (state.paused || state.controlBusy) throw new Error(t("ui.pleaseContinueTheConversationFirst"));
    const token = epoch, revision = state.revision, ctx = context, target = destination;
    const response = await fetch(url); if (!response.ok) throw new Error(t("ui.testAudioFailedToLoad"));
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (token !== epoch || revision !== state.revision) return;
    const clip = ctx.createBufferSource(); source = clip; clip.buffer = buffer; clip.connect(target); clip.start();
    await new Promise(resolve => { clip.onended = resolve; });
    if (source === clip) source = null;
  }
  function mute() {
    if (state.phase !== 'connected' || state.test || state.paused || state.controlBusy) return;
    state = {...state,muted:!state.muted,recording:state.muted,inputLevel:0}; stream?.getAudioTracks().forEach(track => { track.enabled = !state.muted; }); notify();
  }
  function currentControl(token, revision) { return token === epoch && revision === state.revision && state.phase === 'connected'; }
  function control(id, action, token, revision) {
    // A newer pause takes effect locally immediately, then follows any in-flight server control.
    const request = controlQueue.then(() => {
      if (!currentControl(token,revision)) return;
      return api(`/api/voice/sessions/${id}/control`,'POST',{action});
    });
    controlQueue = request.catch(() => {});
    return request;
  }
  async function resumeControl(token, id, revision) {
    await control(id,'resume',token,revision);
    if (!currentControl(token,revision)) return;
    // Acknowledgement alone does not prove the old audio has drained.
    resumeAt = Date.now(); outputQuietAt = resumeAt;
  }
  async function suspend(action, notice = '') {
    if (state.phase !== 'connected') return;
    if (action === 'stop' && (state.controlBusy || state.paused)) return;
    if (action === 'pause' && state.paused && !state.stopped && !state.resuming) return;
    const token = epoch, id = state.id, revision = state.revision+1; resumeAt = 0; lastOutput = 0; outputQuietAt = 0;
    responseRevisions.clear(); activeResponseRevision = null; activeResponseId = null;
    let cancelled = false;
    state = {...state,paused:true,stopped:action === 'stop',resuming:action === 'stop',controlBusy:true,playbackBlocked:true,revision,recording:false,inputSpeaking:false,inputLevel:0,outputLevel:0,outputSpeaking:false,processing:false,backendThinking:false,delegating:false,processingSince:0,processingElapsed:0,needsPlayback:false,notice};
    stream?.getAudioTracks().forEach(track => { track.enabled = false; }); source?.stop(); source = null;
    const output = audio(); if (output) { output.muted = true; output.pause(); }
    if (protocol === 'realtime') { send('response.cancel'); send('output_audio_buffer.clear'); send('input_audio_buffer.clear'); }
    notify();
    try {
      await control(id,action,token,revision);
      if (!currentControl(token,revision)) return;
      cancelled = true;
      if (action === 'stop') {
        await resumeControl(token,id,revision);
      } else { state = {...state,controlBusy:false}; notify(); }
    } catch (error) {
      if (currentControl(token,revision)) {
        state = {...state,resuming:false,controlBusy:false,notice:message(cancelled ? 'voice.resume.error' : 'voice.cancel.error',{error:errorText(error.message)})}; notify();
      }
    }
  }
  function stopCurrent(notice = '') { return suspend('stop',notice); }
  function pause() { return suspend('pause'); }
  async function resume() {
    if (state.phase !== 'connected' || !state.paused || state.controlBusy) return;
    const token = epoch, id = state.id, revision = state.revision+1; state = {...state,resuming:true,controlBusy:true,revision}; notify();
    try {
      await resumeControl(token,id,revision);
    } catch (error) { if (currentControl(token,revision)) { state = {...state,resuming:false,controlBusy:false,notice:message('voice.resume.error',{error:errorText(error.message)})}; notify(); } }
  }
  async function allowPlayback() { if (state.paused) return; await audio()?.play(); state = {...state,needsPlayback:false}; notify(); }
  return {start,end,playClip,mute,pause,resume,stopCurrent,allowPlayback,state:() => ({...state})};
}
