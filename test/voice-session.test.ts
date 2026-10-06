import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module has no TypeScript declarations.
import { createVoiceSession } from '../public/voice-session.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { voiceActivity } from '../public/voice-activity.js';

function browserFixture(t: test.TestContext, control: (action: string) => Promise<unknown> = async () => ({}), verify: () => Promise<unknown> = async () => ({verified:true})) {
  const originals = new Map<string,PropertyDescriptor | undefined>();
  const replace = (name: string,value: unknown) => { originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name)); Object.defineProperty(globalThis,name,{value,writable:true,configurable:true}); };
  let microphoneRequests = 0, stops = 0, closes = 0, deletes = 0;
  const commands:any[] = [], requests:any[] = [], events:any[] = [], eventListeners = new Map<string,(event:any) => void>(), intervals = new Map<number,() => void>();
  let now = Date.now(), intervalId = 0, remotePeer: PeerFake;
  const analysers: {sample:number;fftSize:number;getByteTimeDomainData(data:Uint8Array):void}[] = [];
  t.mock.method(Date,'now',() => now);
  const channel = {readyState:'open',onmessage:null as null | ((event:any) => void),onopen:null,send(value:string) { commands.push(JSON.parse(value)); }};
  const tracks: {enabled:boolean;readyState:string;stop():void}[] = [];
  const media = () => { const track = {enabled:true,readyState:'live',stop() { this.readyState='ended'; stops++; }}; tracks.push(track); return {getTracks:() => [track],getAudioTracks:() => [track]}; };
  class AudioContextFake {
    resume() { return Promise.resolve(); }
    close() { closes++; return Promise.resolve(); }
    createMediaStreamDestination() { return {stream:media()}; }
    createConstantSource() { return {offset:{value:0},connect() {},start() {},stop() {}}; }
    createMediaStreamSource() { return {connect() {},disconnect() {}}; }
    createAnalyser() { const analyser = {sample:128,fftSize:256,getByteTimeDomainData(data: Uint8Array) { data.fill(this.sample); }}; analysers.push(analyser); return analyser; }
  }
  class PeerFake {
    connectionState = 'new'; iceGatheringState = 'complete'; localDescription = {sdp:'offer'};
    constructor() { remotePeer=this; }
    onconnectionstatechange?: () => void; ontrack?: (event:any) => void;
    addTrack() {} createDataChannel() { return channel; }
    createOffer() { return Promise.resolve({sdp:'offer'}); } setLocalDescription() { return Promise.resolve(); }
    setRemoteDescription() { this.connectionState='connected'; this.onconnectionstatechange?.(); return Promise.resolve(); }
    getStats() { return Promise.resolve(new Map()); } close() { this.connectionState='closed'; }
  }
  class EventsFake { readyState = 1; static CLOSED=2; addEventListener(name:string,callback:(event:any) => void) { eventListeners.set(name,callback); } close() { this.readyState=2; } }
  replace('window',{isSecureContext:true,AudioContext:AudioContextFake,RTCPeerConnection:PeerFake,addEventListener() {},removeEventListener() {}});
  replace('AudioContext',AudioContextFake); replace('RTCPeerConnection',PeerFake); replace('EventSource',EventsFake);
  replace('setInterval',(callback: () => void) => { const id=++intervalId; intervals.set(id,callback); return id; });
  replace('clearInterval',(id: number) => intervals.delete(id));
  replace('navigator',{mediaDevices:{getUserMedia:async () => { microphoneRequests++; return media(); }}});
  replace('fetch',async () => { deletes++; return new Response(JSON.stringify({ended:true}),{status:200}); });
  const output = {muted:false,pause() {},play() { return Promise.resolve(); },srcObject:null}, states: any[] = [];
  const session = createVoiceSession({api:async (url: string,_method: string,input: any) => { requests.push({url,input}); if (url.endsWith('/control')) return control(input.action); if (url.endsWith('/verify')) return verify(); return {id:input.id,sdp:'answer'}; },audio:() => output,onState:(state: unknown) => states.push(state),onEvent:(name: string,value: unknown) => events.push({name,value})});
  t.after(async () => { await session.end(); for (const [name,descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,name,descriptor); else Reflect.deleteProperty(globalThis,name); } });
  const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
  return {session,states,events,counts:() => ({microphoneRequests,stops,closes,deletes}),tracks,commands,requests,output,flush,tick:async (ms=100) => { now+=ms; for (const callback of intervals.values()) callback(); await flush(); },setOutputSample:(sample: number) => { if (!output.srcObject) remotePeer.ontrack?.({streams:[media()]}); analysers.at(-1)!.sample=sample; },message:(value:any) => channel.onmessage?.({data:JSON.stringify(value)}),event:(name:string,value:any) => eventListeners.get(name)?.({data:JSON.stringify(value)})};
}

test('microphone capture state turns on after connection, follows mute, and closes all capture resources on end',async t => {
  const {session,states,tracks,counts} = browserFixture(t);
  await session.start({},false); assert.equal(counts().microphoneRequests,1); assert.equal(session.state().recording,true);
  assert(states.filter(s => s.phase === 'connecting').every(s => !s.recording));
  session.mute(); assert.equal(tracks[0].enabled,false); assert.equal(session.state().recording,false); assert.equal(session.state().inputLevel,0);
  session.mute(); assert.equal(tracks[0].enabled,true); assert.equal(session.state().recording,true);
  await Promise.all([session.end(),session.end()]);
  assert.equal(session.state().phase,'ended'); assert.equal(session.state().busy,false); assert.equal(session.state().recording,false);
  assert.equal(counts().deletes,1); assert.equal(counts().stops,1); assert.equal(counts().closes,1);
});

test('a failed background turn does not hide an active microphone, and a new response clears its stale notice',async t => {
  const {session,event,message} = browserFixture(t);
  await session.start({model:'gpt-live-1-codex'},false);
  event('voice-activity',{activity:'failed',message:'当前模型不可用'});
  assert.equal(session.state().recording,true);
  assert.equal(voiceActivity(session.state()).recording,true);
  message({type:'response.created',response:{id:'recovered'}});
  assert.equal(session.state().notice,'');
  assert.equal(voiceActivity(session.state()).activity,'processing');
});

test('audible output clears a failed turn notice even without a data-channel response event',async t => {
  const {session,event,setOutputSample,tick} = browserFixture(t);
  await session.start({},false);
  event('voice-activity',{activity:'failed',message:'当前模型不可用'});
  setOutputSample(170); await tick();
  assert.equal(session.state().notice,'');
  assert.equal(voiceActivity(session.state()).activity,'speaking');
});

test('audio verification retries after a transient failure and notifies only the current session',async t => {
  let attempts = 0;
  const {session,events,requests,tick} = browserFixture(t,undefined,async () => { if (++attempts === 1) throw new Error('temporary failure'); return {verified:true}; });
  // @ts-ignore Mock transport exposes only the statistics this test needs.
  t.mock.method(globalThis.RTCPeerConnection.prototype,'getStats',async () => new Map([['audio',{kind:'audio',type:'inbound-rtp',bytesReceived:256,totalAudioEnergy:1}]]));
  await session.start({model:'gpt-live-1-codex'},false);
  await tick(1000);
  assert.equal(requests.filter(r=>r.url.endsWith('/verify')).length,1);
  assert.equal(events.filter(e=>e.name==='model-verified').length,0);
  await tick(5000);
  assert.equal(requests.filter(r=>r.url.endsWith('/verify')).length,2);
  assert.equal(events.filter(e=>e.name==='model-verified').length,1);
  assert.equal(session.state().audioVerified,true);
});

test('a verification acknowledgement arriving after end cannot update a new call',async t => {
  let acknowledge!: (value:unknown) => void;
  const {session,events,tick,flush} = browserFixture(t,undefined,() => new Promise(resolve=>{acknowledge=resolve;}));
  // @ts-ignore Minimal browser transport statistics.
  t.mock.method(globalThis.RTCPeerConnection.prototype,'getStats',async () => new Map([['audio',{kind:'audio',type:'inbound-rtp',bytesReceived:256,totalAudioEnergy:1}]]));
  await session.start({model:'gpt-live-1-codex'},false); await tick(1000);
  await session.end(); await session.start({model:'gpt-live-1-codex'},false);
  acknowledge({verified:true}); await flush();
  assert.equal(events.filter(e=>e.name==='model-verified').length,0);
  assert.equal(session.state().audioVerified,false);
});

test('voice preview supplies silent audio frames without ever requesting or claiming microphone capture',async t => {
  const {session,states,counts} = browserFixture(t);
  await session.start({preview:true},true);
  assert.equal(session.state().phase,'connected'); assert.equal(counts().microphoneRequests,0); assert(states.every(s => !s.recording));
  session.mute(); assert.equal(session.state().muted,false);
  await session.end(); assert.equal(counts().deletes,1); assert.equal(counts().stops,1);
});

test('stop cancels the current reply and automatically restores listening after old audio drains, keeping the connection',async t => {
  const {session,message,event,tracks,output,requests,commands,counts,tick} = browserFixture(t);
  await session.start({model:'gpt-realtime-1.5'},false); const id=session.state().id;
  message({type:'input_audio_buffer.speech_stopped'}); assert.equal(session.state().processing,true);
  event('voice-activity',{activity:'thinking'}); assert.equal(session.state().backendThinking,true);
  await session.stopCurrent();
  assert.equal(session.state().id,id); assert.equal(session.state().paused,true); assert.equal(session.state().stopped,true);
  assert.equal(session.state().recording,false); assert.equal(session.state().processing,false); assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true);
  assert.equal(session.state().resuming,true); assert.equal(session.state().controlBusy,true);
  assert.deepEqual(commands.map(c=>c.type),['response.cancel','output_audio_buffer.clear','input_audio_buffer.clear']);
  assert(requests.some(r=>r.url.endsWith('/control') && r.input.action==='stop')); assert.equal(counts().deletes,0);
  event('voice-activity',{activity:'thinking'}); message({type:'response.created'}); assert.equal(session.state().backendThinking,false); assert.equal(session.state().processing,false);
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['stop','resume']);
  await tick(800);
  assert.equal(session.state().paused,false); assert.equal(output.muted,false); assert.equal(tracks[0].enabled,true); assert.equal(session.state().id,id);
  assert.equal(session.state().recording,true); assert.equal(session.state().controlBusy,false);
  message({type:'response.created'}); assert.equal(session.state().processing,true);
  event('voice-activity',{activity:'failed',message:'无法核对'}); assert.equal(session.state().notice,'无法核对'); assert.equal(session.state().processing,false);
  assert.equal(counts().microphoneRequests,1);
});

test('Live pause uses its native control route, never sends Realtime-only commands, and ending while paused cannot reopen the microphone',async t => {
  const {session,tracks,commands,requests,counts,event,message,tick} = browserFixture(t);
  await session.start({model:'gpt-live-1-codex'},false); await session.pause();
  assert.equal(session.state().paused,true); assert.equal(session.state().recording,false); assert.equal(tracks[0].enabled,false);
  assert.equal(commands.length,0); assert(requests.some(r=>r.input.action==='pause'));
  event('voice-activity',{activity:'thinking'}); message({type:'input_audio_buffer.speech_started'}); event('interview-progress',{interviewId:'interview',attemptId:'attempt',stage:'answering',questionIndex:0,questionCount:1,question:{id:'q1',text:'Question',tips:[]},settings:{model:'gpt-live-1-codex',voice:'cove',tone:'natural',showTips:true,language:'zh'},round:null,synthetic:false,responseKind:'question',reply:'',inputRevision:0});
  await tick(1000); assert.equal(session.state().paused,true); assert.equal(tracks[0].enabled,false); assert.equal(session.state().processing,false);
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['pause']);
  await session.end(); await session.resume(); assert.equal(session.state().phase,'ended'); assert.equal(counts().microphoneRequests,1); assert.equal(counts().stops,1);
});

test('a response that never arrives times out once without reconnecting or retrying',async t => {
  const {session,message,event,requests,counts,tick} = browserFixture(t);
  await session.start({},false); const id=session.state().id;
  message({type:'delegation.created'}); const started=Date.now(); await tick(15000);
  event('transcript',{role:'assistant',text:'少々お待ちください。',done:true});
  message({type:'turn.done',turn:{role:'assistant'}});
  assert.equal(session.state().delegating,true); assert.equal(session.state().processingSince,started);
  await tick(31000);
  assert.equal(session.state().id,id); assert.equal(session.state().paused,true); assert.match(session.state().notice,/超时/);
  assert.equal(requests.filter(r=>r.input.action==='stop').length,1); assert.equal(requests.filter(r=>r.url==='/api/voice/sessions').length,1); assert.equal(counts().microphoneRequests,1);
  await tick(800); assert.equal(session.state().paused,false); assert.equal(session.state().recording,true);
  await tick(46000); assert.equal(requests.filter(r=>r.input.action==='stop').length,1);
});

test('pause supersedes an in-flight stop, cancels automatic resume, and preserves server control order',async t => {
  let resolveStop!: () => void;
  const pendingStop = new Promise<void>(resolve => { resolveStop=resolve; });
  const {session,requests,tracks,output,flush,tick} = browserFixture(t,action => action === 'stop' ? pendingStop : Promise.resolve({}));
  await session.start({},false);
  const stopping=session.stopCurrent(); await flush();
  const pausing=session.pause(); assert.equal(session.state().resuming,false); assert.equal(tracks[0].enabled,false);
  resolveStop(); await Promise.all([stopping,pausing]); await tick(1200);
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['stop','pause']);
  assert.equal(session.state().paused,true); assert.equal(session.state().stopped,false); assert.equal(session.state().recording,false); assert.equal(output.muted,true);
});

test('pause supersedes automatic resume even when the resume acknowledgement arrives later',async t => {
  let resolveResume!: () => void;
  const pendingResume = new Promise<void>(resolve => { resolveResume=resolve; });
  const {session,requests,tracks,output,flush,tick} = browserFixture(t,action => action === 'resume' ? pendingResume : Promise.resolve({}));
  await session.start({},false);
  const stopping=session.stopCurrent(); await flush();
  assert(requests.some(r=>r.input.action==='resume'));
  const pausing=session.pause(); resolveResume(); await Promise.all([stopping,pausing]); await tick(1200);
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['stop','resume','pause']);
  assert.equal(session.state().paused,true); assert.equal(session.state().resuming,false); assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true);
});

test('ending during automatic resume cannot reopen microphone or playback after its acknowledgement',async t => {
  let resolveResume!: () => void;
  const pendingResume = new Promise<void>(resolve => { resolveResume=resolve; });
  const {session,tracks,output,flush,tick,counts} = browserFixture(t,action => action === 'resume' ? pendingResume : Promise.resolve({}));
  await session.start({},false);
  const stopping=session.stopCurrent(); await flush(); await session.end(); resolveResume(); await stopping; await tick(1200);
  assert.equal(session.state().phase,'ended'); assert.equal(session.state().resuming,false); assert.equal(session.state().recording,false);
  assert.equal(tracks[0].readyState,'ended'); assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true); assert.equal(counts().microphoneRequests,1);
});

test('unconfirmed cancellation leaves local audio disabled and never automatically resumes',async t => {
  const {session,tracks,output,requests,tick} = browserFixture(t,async () => { throw new Error('取消请求失败'); });
  await session.start({},false); await session.stopCurrent(); await tick(1200);
  assert.equal(session.state().paused,true); assert.equal(session.state().resuming,false); assert.equal(session.state().controlBusy,false);
  assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true); assert.match(session.state().notice,/后台取消未确认/);
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['stop']);
});

test('automatic resume failure keeps the microphone and playback disabled',async t => {
  const failed=browserFixture(t,async action => { if (action === 'resume') throw new Error('恢复请求失败'); return {}; });
  await failed.session.start({},false); await failed.session.stopCurrent(); await failed.tick(1200);
  assert.equal(failed.tracks[0].enabled,false); assert.equal(failed.output.muted,true); assert.equal(failed.session.state().resuming,false); assert.match(failed.session.state().notice,/恢复倾听未确认/);
});

test('old audible output must drain before automatic listening resumes, and a stalled drain has a clear failure state',async t => {
  const {session,tracks,output,tick,setOutputSample} = browserFixture(t);
  await session.start({},false); setOutputSample(170); await session.stopCurrent(); await tick(1000);
  assert.equal(session.state().paused,true); assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true);
  await tick(4100);
  assert.equal(session.state().resuming,false); assert.equal(session.state().controlBusy,false); assert.match(session.state().notice,/旧回复仍未停止/);
  setOutputSample(128); await tick(1000); assert.equal(tracks[0].enabled,false);
  await session.resume(); await tick(800); assert.equal(session.state().recording,true); assert.equal(output.muted,false);
});

test('SSE voice controls use real stop, pause, and resume paths and ignore unsupported actions',async t => {
  const {session,event,requests,tracks,output,flush,tick} = browserFixture(t);
  await session.start({},false);
  event('voice-control',{action:'pause'}); await flush(); await tick(1000);
  assert.equal(session.state().paused,true); assert.equal(tracks[0].enabled,false); assert.equal(output.muted,true);
  event('voice-control',{action:'resume'}); await flush(); await tick(800); assert.equal(session.state().recording,true);
  event('voice-control',{action:'stop'}); await flush(); await tick(800); assert.equal(session.state().recording,true);
  event('voice-control',{action:'unknown'}); await flush();
  assert.deepEqual(requests.filter(r=>r.url.endsWith('/control')).map(r=>r.input.action),['pause','resume','stop','resume']);
});

test('response completion is tied to its original input, not transcript chunks or cancelled responses',async t => {
  const {session,message,events} = browserFixture(t);
  await session.start({},false);
  message({type:'input_audio_buffer.speech_started'});
  message({type:'response.created',response:{id:'old'}});
  message({type:'input_audio_buffer.speech_started'});
  message({type:'response.created',response:{id:'new'}});
  message({type:'transcript',role:'assistant',text:'part',done:true});
  message({type:'itemCompleted',item:{type:'message'}});
  assert.equal(events.filter(e=>e.name==='response-ended').length,0);
  message({type:'response.done',response:{id:'old',status:'completed'}});
  message({type:'response.done',response:{id:'new',status:'completed'}});
  assert.deepEqual(events.filter(e=>e.name==='response-ended').map(e=>e.value),[{inputRevision:1,responseId:'old'},{inputRevision:2,responseId:'new'}]);
  message({type:'response.created',response:{id:'cancelled'}});
  message({type:'response.done',response:{id:'cancelled',status:'cancelled'}});
  assert.equal(events.filter(e=>e.name==='response-ended').length,2);
});

test('native turns without transcript completion still expose one complete response with its input revision',async t => {
  const {session,message,events} = browserFixture(t);
  await session.start({},false);
  message({type:'turn.created',turn:{role:'user',id:'user'}});
  message({type:'turn.created',turn:{role:'assistant',id:'assistant'}});
  message({type:'turn.done',turn:{role:'assistant',id:'assistant'}});
  message({type:'turn.done',turn:{role:'assistant'}});
  assert.deepEqual(events.filter(e=>e.name==='response-ended').map(e=>e.value),[{inputRevision:1,responseId:'assistant'}]);
  assert.deepEqual(events.filter(e=>e.name==='response-started').map(e=>e.value),[{inputRevision:1,responseId:'assistant'}]);
});

test('a completed native transcript segment does not clear processing before the actual response ends',async t => {
  const {session,message,event} = browserFixture(t);
  await session.start({},false);
  message({type:'response.created',response:{id:'segments'}});
  event('transcript',{role:'assistant',text:'第一段。',done:true,source:'segment'});
  assert.equal(session.state().processing,true);
  message({type:'response.done',response:{id:'segments',status:'completed'}});
  assert.equal(session.state().processing,false);
});

test('stopping invalidates late response completion and automatic recovery preserves an explicitly muted microphone',async t => {
  const {session,message,events,tracks,tick} = browserFixture(t);
  await session.start({},false); session.mute();
  message({type:'response.created',response:{id:'stopped'}});
  await session.stopCurrent(); await tick(800);
  message({type:'response.done',response:{id:'stopped',status:'completed'}});
  assert.equal(events.filter(e=>e.name==='response-ended').length,0);
  assert.equal(session.state().paused,false); assert.equal(session.state().muted,true); assert.equal(session.state().recording,false); assert.equal(tracks[0].enabled,false);
});
