import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createApp } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { restoreBackup } from '../src/backup.ts';
import { modelValue, nativeParams, nativeResult, nativeNotification } from '../src/contract-validation.ts';
import { modelInstruction } from '../src/model-contracts.ts';
import { createApiClient, eventData, readApiResponse } from '../public/api.ts';
import { Events } from '../src/events.ts';
import { FakeAI, fakeInterviewSources } from './fixtures.ts';
import { interviewFixture } from './interview-fixture.ts';
import { DEFAULT_VOICE_SETTINGS } from '../src/voice-options.ts';

async function directory(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'contracts-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('invalid nested persisted state is rejected without replacing disk or in-memory state', async t => {
  const dir = await directory(t), path = join(dir, 'state.json');
  const store = new Store(path); await store.load();
  await store.update(s => { s.settings = { model:'test-model', userLanguage:'zh' }; });
  const original = await readFile(path, 'utf8');
  await assert.rejects(store.update(s => { Reflect.set(s.settings!, 'userLanguage', 'fr'); }), /Invalid persisted state/);
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(store.snapshot().settings?.userLanguage, 'zh');
  const invalid = original.replace('"userLanguage": "zh"', '"userLanguage": "fr"');
  await writeFile(path, invalid);
  await assert.rejects(new Store(path).load(), /原文件未覆盖/);
  assert.equal(await readFile(path, 'utf8'), invalid);
});

test('legacy voice settings and attempts remain readable without rewriting the original file', async t => {
  const dir = await directory(t), path = join(dir, 'state.json');
  const {language:_, ...settings} = DEFAULT_VOICE_SETTINGS;
  const set = structuredClone(interviewFixture);
  set.voiceSettings = settings;
  set.voiceAttempts = [{id:'legacy',at:'2026-10-01T00:00:00Z',settings,status:'completed',rounds:[]}];
  const original = JSON.stringify({version:1,problems:[],interviews:[set]});
  await writeFile(path, original);
  const store = new Store(path); await store.load();
  assert.equal(store.interview(set.id).voiceAttempts?.[0].settings.language, undefined);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('valid checksum cannot bypass nested backup schema validation', async t => {
  const dir = await directory(t), target = join(dir, 'restored');
  const state = { version:1, problems:[], settings:{ model:'test-model', visibleModels:[42] } };
  const archive = { format:'recruitagent-backup', version:1, createdAt:new Date().toISOString(), state,
    stateHash:createHash('sha256').update(JSON.stringify(state)).digest('hex'), files:[] };
  await assert.rejects(restoreBackup(gzipSync(JSON.stringify(archive)), target), /数据结构/);
  await assert.rejects(access(target));
});

test('server rejects malformed JSON contracts before invoking AI or writing data', async t => {
  const dir = await mkdtemp(join(tmpdir(),'contracts-http-test-')), ai = new FakeAI();
  const app = await createApp({ dataDir:dir, ai, sourceDir:null, interviewSources:fakeInterviewSources });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(dir,{recursive:true,force:true}); });
  const address = app.server.address(); assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/problems`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ topic:'array', difficulty:'easy', language:123 }) });
  assert.equal(response.status, 400); assert.equal(ai.prompts.length, 0);
  assert.equal(app.store.snapshot().problems.length, 0);
});

test('frontend rejects malformed request before fetch and malformed successful response after fetch', async t => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ model:'test-model', visibleModels:[], teacher:{ enabled:false, trigger:'manual', interval:10 }, uiLanguage:'zh', userLanguage:'fr' }), { status:200 }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const api = createApiClient();
  // Exercise untyped input received from an authored form/external integration.
  const send = api as (path: string, method?: string, body?: unknown) => Promise<unknown>;
  await assert.rejects(send('/api/settings', 'PUT', { userLanguage:'fr' }), /请求的数据结构/);
  assert.equal(calls, 0);
  await assert.rejects(api('/api/settings'), /返回的数据格式/); assert.equal(calls, 1);
  await assert.rejects(send('/api/missing'), /接口不存在/); assert.equal(calls, 1);
  await assert.rejects(readApiResponse('POST /api/library/files',new Response(JSON.stringify({item:{id:42},duplicate:false}),{status:200})), /返回的数据格式/);
});

test('generated model, SSE and native protocol validators preserve nested field types', () => {
  assert.throws(() => modelValue('review', { verdict:'solid', score:80, dimensions:{ correctness:'80', complexity:80, edgeCases:80, clarity:80 }, summary:'review', strengths:[], gaps:[], nextSteps:[] }), /Invalid model output/);
  assert(modelInstruction('review').includes('"correctness"'));
  assert.throws(() => eventData('transcript', { data:JSON.stringify({ role:'user', text:'hello', done:'true' }) }), /Invalid event payload/);
  assert.throws(() => new Events().emit('voice-control', {action:'invalid'} as never), /Invalid event payload/);
  assert(nativeParams('turn/interrupt', {threadId:'thread', turnId:'turn'}));
  assert(!nativeParams('turn/interrupt', {threadId:42, turnId:'turn'}));
  assert(nativeResult('account/read', {account:null, requiresOpenaiAuth:true}));
  assert(!nativeResult('account/read', {account:null, requiresOpenaiAuth:'yes'}));
  assert.equal(nativeNotification({method:'thread/realtime/transcript/done',params:{threadId:'thread',role:'user',text:42}}), undefined);
});
