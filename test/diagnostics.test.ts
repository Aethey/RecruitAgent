import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Diagnostics, diagnosticError, loggedAI } from '../src/diagnostics.ts';
import { FakeAI, fakeInterviewSources } from './fixtures.ts';
import { FakeVoiceRpc } from './voice-fixtures.ts';
import { createApp } from '../src/server.ts';

async function fixture(t: test.TestContext, maxBytes?: number) {
  const dir = await mkdtemp(join(tmpdir(),'codex-diagnostics-test-'));
  const log = new Diagnostics(dir,maxBytes);
  t.after(async () => { await log.flush(); await rm(dir,{recursive:true,force:true}); });
  return {dir,log,read:async () => (await readFile(log.path,'utf8')).trim().split('\n').map(line => JSON.parse(line))};
}

test('text requests record correlated success, failures and cancellation without prompt or output content',async t => {
  const {log,read} = await fixture(t), fake = new FakeAI(), ai = loggedAI(fake,log);
  const controller = new AbortController();
  await log.run('http-text-request',() => ai.ask('PRIVATE_PROMPT_CONTENT',controller.signal,() => {},'algorithm'));
  fake.mode = 'error';
  await assert.rejects(ai.ask('PRIVATE_FAILURE_PROMPT',controller.signal,() => {},'interview'));
  fake.mode = 'block';
  const pending = ai.ask('PRIVATE_CANCEL_PROMPT',controller.signal,() => {},'study');
  while (fake.prompts.length < 3) await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('cancelled by user')); await assert.rejects(pending);
  await log.flush(); const lines = await read(), serialized = JSON.stringify(lines);
  for (const marker of ['PRIVATE_PROMPT_CONTENT','PRIVATE_FAILURE_PROMPT','PRIVATE_CANCEL_PROMPT']) assert(!serialized.includes(marker));
  const starts = lines.filter(line => line.event === 'request'); assert.equal(starts.length,3);
  for (const [index,event] of ['completed','failed','cancelled'].entries()) assert(lines.some(line => line.requestId === starts[index].requestId && line.event === event && typeof line.durationMs === 'number'));
  assert.equal(lines.find(line => line.event === 'completed').httpRequestId,'http-text-request');
  assert.equal((await stat(log.path)).mode & 0o777,0o600);
});

test('diagnostics redact credential fields, bearer/API keys, emails and tokens in errors',async t => {
  const {log,read} = await fixture(t);
  log.record('test','error',{accessToken:'PRIVATE_ACCESS_VALUE',refresh_token:'FAKE_REFRESH',sdp:'PRIVATE_SDP_VALUE',prompt:'PRIVATE_PROMPT_VALUE',text:'PRIVATE_TRANSCRIPT_VALUE',error:new Error('Bearer PRIVATE_BEARER_VALUE sk-private-key ek_private-key access_token=PRIVATE_TOKEN_VALUE user@sample.test')});
  await log.flush(); const serialized = JSON.stringify(await read());
  for (const marker of ['PRIVATE_ACCESS_VALUE','FAKE_REFRESH','PRIVATE_SDP_VALUE','PRIVATE_PROMPT_VALUE','PRIVATE_TRANSCRIPT_VALUE','PRIVATE_BEARER_VALUE','sk-private-key','ek_private-key','PRIVATE_TOKEN_VALUE','user@sample.test']) assert(!serialized.includes(marker),marker);
  assert(diagnosticError('refresh_token="private"').includes('[redacted]'));
});

test('diagnostics rotate automatically, retaining only the current file and three archives',async t => {
  const {dir,log} = await fixture(t,512);
  for (let index=0;index<30;index++) log.record('test','rotation',{index,message:'x'.repeat(120)});
  await log.flush(); const files = await readdir(join(dir,'logs'));
  assert.equal(files.length,4); assert(files.includes('codex.jsonl.3'));
  for (const file of files) {
    const content = await readFile(join(dir,'logs',file),'utf8');
    content.trim().split('\n').forEach(line => JSON.parse(line));
    assert(Buffer.byteLength(content) <= 512);
  }
});

test('voice RPC and browser errors are correlated to sessions and HTTP requests, and diagnostics reject cross-origin/invalid input',async t => {
  const dir = await mkdtemp(join(tmpdir(),'codex-diagnostics-http-')), rpc = new FakeVoiceRpc();
  const app = await createApp({dataDir:dir,ai:new FakeAI(),sourceDir:null,interviewSources:fakeInterviewSources,voiceRpcFactory:async () => rpc});
  await new Promise<void>(resolve => app.server.listen(0,'127.0.0.1',resolve)); t.after(async () => { await app.close(); await rm(dir,{recursive:true,force:true}); });
  const address = app.server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path:string,body:unknown,origin?:string) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(origin ? {Origin:origin} : {})},body:JSON.stringify(body)});
  const start = await request('/api/voice/sessions',{id:'diagnostics-session',model:'gpt-live-1-codex',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'});
  assert.equal(start.status,201);
  const path = '/api/voice/sessions/diagnostics-session/diagnostics';
  const response = await request(path,{event:'error',message:'Bearer PRIVATE_NATIVE_ERROR',recording:true});
  assert.equal(response.status,200);
  assert.equal((await request(path,{event:'unknown'})).status,400);
  assert.equal((await request(path,{event:'state'},'https://other.example')).status,403);
  rpc.emit('turn/started',{threadId:'native-thread',turn:{id:'logged-turn',status:'inProgress'}});
  rpc.emit('turn/completed',{threadId:'native-thread',turn:{id:'logged-turn',status:'failed',error:{message:'Bearer PRIVATE_TURN_ERROR'}}});
  await app.diagnostics.flush();
  const lines = (await readFile(app.diagnostics.path,'utf8')).trim().split('\n').map(line=>JSON.parse(line)), serialized = JSON.stringify(lines);
  assert(lines.some(line=>line.component==='voice-browser' && line.sessionId==='diagnostics-session' && line.threadId==='native-thread' && line.httpRequestId===response.headers.get('x-request-id')));
  const rpcStart = lines.find(line=>line.component==='voice-rpc' && line.event==='request' && line.method==='thread/realtime/start');
  assert.equal(rpcStart.httpRequestId,start.headers.get('x-request-id'));
  assert(lines.some(line=>line.requestId===rpcStart.requestId && line.event==='completed'));
  assert(lines.some(line=>line.event==='voice-activity' && line.activity==='failed' && line.sessionId==='diagnostics-session'));
  for (const marker of ['PRIVATE_CREDENTIAL','private@example','PRIVATE_NATIVE_ERROR','PRIVATE_TURN_ERROR','m=audio']) assert(!serialized.includes(marker),marker);
});
