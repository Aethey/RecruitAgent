import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexVoice, voiceError } from "../src/codex-voice.ts";
import { createApp } from "../src/server.ts";
import { FakeAI, fakeInterviewSources } from "./fixtures.ts";
import { FakeVoiceRpc } from "./voice-fixtures.ts";
import { VOICE_PREVIEW_TEXT } from "../src/voice-options.ts";
import type { VoiceTranscript } from "../src/codex-voice.ts";

const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
async function fixture(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(),"voice-demo-test-")), rpc = new FakeVoiceRpc();
  const voice = new CodexVoice(dataDir,async () => rpc,25);
  const apps: {close(): Promise<void>}[] = [];
  t.after(async () => { for (const app of apps) await app.close(); await voice.close(); await rm(dataDir,{recursive:true,force:true}); });
  return { dataDir, rpc, voice, apps };
}
test("voice uses native WebRTC and catches SDP sent before start acknowledgement; status never exposes credentials",async t => {
  const { rpc, voice } = await fixture(t);
  const status = await voice.status();
  assert.equal(status.authType,"chatgpt"); assert(!JSON.stringify(status).includes("PRIVATE_CREDENTIAL")); assert(!JSON.stringify(status).includes("private@example"));
  const result = await voice.start({ id:"first-session",sdp:offer },"ja");
  assert.deepEqual(result,{id:"first-session",sdp:"REMOTE_ANSWER"});
  const thread = rpc.calls.find(c => c.method === "thread/start")!;
  assert.equal(thread.params.ephemeral,true); assert.equal(thread.params.sandbox,"read-only"); assert.match(thread.params.baseInstructions,/Japanese/);
  const start = rpc.calls.find(c => c.method === "thread/realtime/start")!;
  assert.deepEqual(start.params.transport,{type:"webrtc",sdp:offer}); assert.equal(start.params.outputModality,"audio");
  await assert.rejects(voice.start({id:"second-session",sdp:offer}),/已有语音通话/);
  await voice.end(result.id); assert.equal((await voice.status()).active,false);
  assert(rpc.calls.some(c => c.method === "thread/realtime/stop"));
  assert(rpc.calls.some(c => c.method === "thread/unsubscribe"));
});
test("asynchronous native error is returned, redacted, and permits retry",async t => {
  const { rpc, voice } = await fixture(t); rpc.mode = "error";
  await assert.rejects(voice.start({id:"error-session",sdp:offer}),error => {
    assert(error instanceof Error); assert.match(error.message,/Denied/); assert(!error.message.includes("SECRET_VALUE")); assert(!error.message.includes("sk-secret")); return true;
  });
  rpc.mode = "normal"; assert.equal((await voice.start({id:"retry-session",sdp:offer})).sdp,"REMOTE_ANSWER");
});
test("missing login and invalid input fail before a voice call; negotiation timeout closes the native session",async t => {
  const { rpc, voice } = await fixture(t);
  await assert.rejects(voice.start({id:"invalid-session",sdp:"not-an-offer"}),/参数无效/); assert.equal(rpc.calls.length,0);
  rpc.authenticated = false; await assert.rejects(voice.start({id:"no-login-session",sdp:offer}),/codex login/);
  assert(!rpc.calls.some(c => c.method === "thread/start"));
  rpc.authenticated = true; rpc.mode = "wait";
  await assert.rejects(voice.start({id:"timeout-session",sdp:offer}),/协商超时/);
  assert.equal((await voice.status()).active,false); assert(rpc.calls.some(c => c.method === "thread/realtime/stop"));
});
test("canceling during thread creation prevents realtime start and closes the late-created thread",async t => {
  const { rpc, voice } = await fixture(t); let release!: () => void;
  rpc.threadGate = new Promise<void>(resolveGate => { release = resolveGate; });
  const pending = voice.start({id:"cancel-session",sdp:offer});
  while (!rpc.calls.some(c => c.method === "thread/start")) await new Promise(r => setTimeout(r,1));
  await voice.end("cancel-session"); release(); await assert.rejects(pending,/已取消/);
  assert(!rpc.calls.some(c => c.method === "thread/realtime/start")); assert(rpc.calls.some(c => c.method === "thread/realtime/stop"));
  assert(rpc.calls.some(c => c.method === "thread/unsubscribe"));
});
test("voice HTTP endpoints keep learning records and Pi calls unchanged; cross-origin requests are rejected",async t => {
  const { dataDir, rpc, apps } = await fixture(t), ai = new FakeAI();
  const app = await createApp({dataDir,ai,sourceDir:null,interviewSources:fakeInterviewSources,voiceRpcFactory:async () => rpc});
  await new Promise<void>(resolveListen => app.server.listen(0,"127.0.0.1",resolveListen));
  apps.push(app);
  const address = app.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`, before = JSON.stringify(app.store.snapshot());
  const status = await (await fetch(base+"/api/voice/status")).json(); assert.equal(status.authenticated,true); assert(!JSON.stringify(status).includes("PRIVATE_CREDENTIAL"));
  const started = await fetch(base+"/api/voice/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:"http-session",sdp:offer})});
  assert.equal(started.status,201); assert.equal((await started.json()).sdp,"REMOTE_ANSWER");
  const blocked = await fetch(base+"/api/voice/sessions/http-session",{method:"DELETE",headers:{Origin:"https://other.example"}}); assert.equal(blocked.status,403);
  const control = (action:string,origin?:string) => fetch(base+'/api/voice/sessions/http-session/control',{method:'POST',headers:{'Content-Type':'application/json',...(origin ? {Origin:origin} : {})},body:JSON.stringify({action})});
  assert.equal((await control('stop','https://other.example')).status,403);
  assert.equal((await control('unknown')).status,400);
  assert.equal((await control('pause')).status,200); assert.equal((await app.voice.status()).active,true);
  assert.equal((await control('resume')).status,200);
  assert.equal((await fetch(base+"/api/voice/sessions/http-session",{method:"DELETE"})).status,200);
  assert.equal((await fetch(base+"/api/voice/sessions/http-session/events")).status,404);
  assert.equal(JSON.stringify(app.store.snapshot()),before); assert.equal(ai.prompts.length,0);
  for (const fixture of ["/voice-test-1.wav","/voice-test-2.wav"]) { const response = await fetch(base+fixture); assert.equal(response.status,200); assert.match(response.headers.get("content-type")!,/audio\/wav/); assert((await response.arrayBuffer()).byteLength > 8000,"fixture must contain actual speech audio"); }
});
test("native error redaction removes bearer and API keys",()=>assert.equal(voiceError(new Error("Bearer abc sk-proj-secret ek_secret ek-secret")),"Bearer [redacted] [redacted] [redacted] [redacted]"));

test('native transcript parts retain identity, prefer canonical events, and never claim a whole response is complete',async t => {
  const {voice,rpc} = await fixture(t), lines:VoiceTranscript[] = [];
  await voice.start({id:'canonical-transcripts',sdp:offer},'zh',{prompt:'语音测试',onTranscript:line => lines.push(line)});
  const item = {id:'part-1',type:'transcriptSegment',realtimeSessionId:'rt-1',role:'assistant',text:''};
  rpc.emit('thread/realtime/item/started',{threadId:'native-thread',item});
  rpc.emit('thread/realtime/item/transcript/delta',{threadId:'native-thread',itemId:'part-1',delta:'第一句。'});
  rpc.emit('thread/realtime/transcript/delta',{threadId:'native-thread',role:'assistant',delta:'第一句。'});
  rpc.emit('thread/realtime/item/completed',{threadId:'native-thread',item:{...item,text:'第一句。'}});
  rpc.emit('thread/realtime/transcript/done',{threadId:'native-thread',role:'assistant',text:'第一句。'});
  rpc.emit('thread/realtime/item/completed',{threadId:'native-thread',item:{...item,text:'第一句。'}});
  assert.deepEqual(lines,[{role:'assistant',text:'第一句。',done:false,itemId:'part-1',source:'segment'},{role:'assistant',text:'第一句。',done:true,itemId:'part-1',source:'segment'}]);
  rpc.emit('thread/realtime/item/completed',{threadId:'native-thread',item:{...item,id:'part-2',text:'第一句。'}});
  assert.equal(lines.length,3,'a distinct part may legitimately repeat the same words');
  await voice.control('canonical-transcripts',{action:'pause'});
  rpc.emit('thread/realtime/item/completed',{threadId:'native-thread',item:{...item,id:'late-part',text:'已经停止的旧回复'}});
  assert.equal(lines.length,3,'suspended output must not become a new feedback transcript');
});

test('demo voice commands invoke real controls conservatively and do not act on quoted instructions',async t => {
  const {voice,rpc} = await fixture(t), controls:unknown[] = [];
  await voice.start({id:'spoken-control-demo',sdp:offer});
  const emit = voice.emit.bind(voice);
  voice.emit = (id,name,data) => { if (name === 'voice-control') controls.push(data); emit(id,name,data); };
  for (const phrase of ['停止回复。','请暂停对话。','我没有说停止回复','用户说“停止回复”时应该怎么办？']) rpc.emit('thread/realtime/transcript/done',{threadId:'native-thread',role:'user',text:phrase});
  assert.deepEqual(controls,[{action:'stop'},{action:'pause'}]);
});

test('a flat transcript committed before canonical events is displayed exactly once without a dangling partial',async t => {
  const {voice,rpc} = await fixture(t), lines:VoiceTranscript[] = [];
  await voice.start({id:'flat-first-transcripts',sdp:offer},'zh',{prompt:'语音测试',onTranscript:line => lines.push(line)});
  rpc.emit('thread/realtime/transcript/done',{threadId:'native-thread',role:'assistant',text:'一条回复。'});
  const item = {id:'part-1',type:'transcriptSegment',realtimeSessionId:'rt-1',role:'assistant',text:''};
  rpc.emit('thread/realtime/item/started',{threadId:'native-thread',item});
  rpc.emit('thread/realtime/item/transcript/delta',{threadId:'native-thread',itemId:'part-1',delta:'一条回复。'});
  rpc.emit('thread/realtime/item/completed',{threadId:'native-thread',item:{...item,text:'一条回复。'}});
  assert.deepEqual(lines,[{role:'assistant',text:'一条回复。',done:true,source:'segment'}]);
});

test('voice audition uses the selected native voice, tone and language, starts speech once, and never writes an interview answer',async t => {
  const {dataDir,rpc,apps} = await fixture(t), ai = new FakeAI();
  const app = await createApp({dataDir,ai,sourceDir:null,interviewSources:fakeInterviewSources,voiceRpcFactory:async () => rpc});
  await new Promise<void>(resolveListen => app.server.listen(0,'127.0.0.1',resolveListen)); apps.push(app);
  const address = app.server.address(); assert(address && typeof address !== 'string'); const base='http://127.0.0.1:'+address.port;
  const request = (path: string,method='GET',body?: unknown,origin?: string) => fetch(base+path,{method,headers:{'Content-Type':'application/json',...(origin ? {Origin:origin} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const before = JSON.stringify(app.store.snapshot());
  const result = await request('/api/voice/sessions','POST',{id:'voice-audition',sdp:offer,preview:true,voice:'breeze',tone:'gentle',language:'en'}); assert.equal(result.status,201);
  const start = rpc.calls.find(c => c.method === 'thread/realtime/start')!;
  assert.equal(start.params.voice,'breeze'); assert.match(start.params.prompt,/OUTPUT LANGUAGE: English/); assert.match(start.params.prompt,/温和/);
  assert.equal((await request('/api/voice/sessions/voice-audition/preview','POST',{},'https://other.example')).status,403);
  for (let i=0;i<2;i++) assert.equal((await request('/api/voice/sessions/voice-audition/preview','POST',{})).status,200);
  const speech = rpc.calls.filter(c => c.method === 'thread/realtime/appendSpeech'); assert.equal(speech.length,1); assert.equal(speech[0].params.text,VOICE_PREVIEW_TEXT.en);
  assert.equal((await request('/api/voice/sessions/voice-audition/action','POST',{action:'begin'})).status,404);
  await request('/api/voice/sessions/voice-audition','DELETE'); assert.equal((await app.voice.status()).active,false);
  assert.equal(JSON.stringify(app.store.snapshot()),before); assert.equal(ai.prompts.length,0);
  assert.equal((await request('/api/voice/sessions','POST',{id:'mixed-audition',sdp:offer,preview:true,interviewId:'any'})).status,400);
});

test('backend reasoning is exposed, failed turns cannot leave the caller waiting, and stop interrupts without ending the call',async t => {
  const {voice,rpc} = await fixture(t), events:{name:string;data:any}[]=[];
  const emit=voice.emit.bind(voice); voice.emit=(id,name,data)=>{events.push({name,data});emit(id,name,data)};
  await voice.start({id:'thinking-session',sdp:offer});
  rpc.emit('turn/started',{threadId:'native-thread',turn:{id:'reasoning-1',status:'inProgress'}});
  assert(events.some(e=>e.name==='voice-activity' && e.data.activity==='thinking'));
  await voice.control('thinking-session',{action:'stop'});
  assert(rpc.calls.some(c=>c.method==='turn/interrupt' && c.params.turnId==='reasoning-1'));
  assert.equal((await voice.status()).active,true);
  assert(!rpc.calls.some(c=>c.method==='thread/realtime/stop'));
  rpc.emit('turn/started',{threadId:'native-thread',turn:{id:'late-reasoning',status:'inProgress'}});
  await new Promise(r=>setImmediate(r));
  assert(rpc.calls.some(c=>c.method==='turn/interrupt' && c.params.turnId==='late-reasoning'));
  await voice.control('thinking-session',{action:'resume'});
  rpc.emit('turn/started',{threadId:'native-thread',turn:{id:'reasoning-2',status:'inProgress'}});
  rpc.emit('turn/completed',{threadId:'native-thread',turn:{id:'reasoning-2',status:'failed',error:{message:'backend denied'}}});
  assert(events.some(e=>e.name==='voice-activity' && e.data.activity==='failed' && e.data.message.includes('backend denied')));
  rpc.emit('turn/started',{threadId:'native-thread',turn:{id:'cancel-failed',status:'inProgress'}});
  const request = rpc.request.bind(rpc); let failInterrupt = true;
  rpc.request = async <T = Record<string,unknown>>(method:string,params:any):Promise<T> => {
    if (method === 'turn/interrupt' && failInterrupt) { rpc.calls.push({method,params}); throw new Error('cancel unavailable'); }
    return request<T>(method,params);
  };
  await assert.rejects(voice.control('thinking-session',{action:'pause'}),/cancel unavailable/);
  failInterrupt = false; await voice.end('thinking-session');
  assert.equal(rpc.calls.filter(c=>c.method === 'turn/interrupt' && c.params.turnId === 'cancel-failed').length,2);
});
