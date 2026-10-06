import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { Library } from '../src/library.ts';
import { FileInterviewSources, LibraryInterviewSources } from '../src/interview-sources.ts';
import { exportBackup, restoreBackup } from '../src/backup.ts';
import { assertNodeVersion, serverPort } from '../scripts/runtime.mjs';
import { FakeAI } from './fixtures.ts';

const resume = '# Example career\nI built a learning demo using typed events. My role was UI integration and local persistence. No production measurements are available.';
async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'recruitagent-packaging-'));
  const apps: {close(): Promise<void>}[] = [];
  t.after(async () => { for (const app of apps) await app.close(); await rm(directory, {recursive:true,force:true}); });
  const store = new Store(join(directory, 'data', 'state.json')); await store.load();
  const library = new Library(store, join(directory, 'data', 'library'));
  return { directory, store, library, apps };
}
test('empty installation and missing voice dependency preserve text features; selected materials persist and feed generation', async t => {
  const { directory, apps } = await workspace(t), dataDir = join(directory, 'app');
  const ai = new FakeAI(), app = await createApp({ dataDir, ai, sourceDir: null, voiceRpcFactory: async () => { throw new Error('CLI missing'); } });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  apps.push(app);
  const address = app.server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const get = (path: string) => fetch(base + path);
  assert.equal((await get('/api/health')).status, 200);
  assert.equal((await (await get('/api/interview-sources')).json()).available, false);
  assert.equal((await get('/api/voice/status')).status, 500);
  assert.equal((await get('/api/config')).status, 200);
  const item = (await app.library.importFile('my-career.markdown', Buffer.from(resume))).item;
  const sources = { resume: [item.id], personal: [], study: [] };
  const saved = await fetch(base + '/api/interview-sources', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sources) });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).available, true);
  const generated = await fetch(base + '/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'common', topic: 'all', count: 3 }) });
  assert.equal(generated.status, 202); const job = app.tasks.get((await generated.json()).jobId); await job.promise;
  assert.equal(job.status, "done", job.error ?? "Interview generation should complete");
  assert(ai.prompts.at(-1)?.includes('typed events'), 'only the selected user document supplies evidence');
  const reloaded = new Store(join(dataDir, 'state.json')); await reloaded.load();
  assert.deepEqual(reloaded.snapshot().interviewMaterials, sources);
  const backup = await get('/api/backup'); assert.equal(backup.status, 200); assert.equal(backup.headers.get('content-type'), 'application/gzip');
  await restoreBackup(Buffer.from(await backup.arrayBuffer()), join(directory, 'restored-from-web'));
});
test('materials distinguish personal evidence and study; invalid selection never partially saves; explicit clear disables legacy fallback', async t => {
  const { store, library } = await workspace(t);
  const own = (await library.importFile('career.md', Buffer.from(resume))).item;
  const study = (await library.importFile('notes.md', Buffer.from('# Study\nThis is general architecture knowledge, not personal experience.'))).item;
  const legacy = { async status() { return { available: true, files: ['existing.pdf'] }; }, async load() { return []; } };
  const sources = new LibraryInterviewSources(store, library, legacy);
  assert.equal((await sources.status()).available, true);
  await sources.save({ resume: [own.id], personal: [], study: [study.id] });
  const loaded = await sources.load({ type: 'technical', topic: 'all', count: 3 });
  assert.deepEqual(loaded.map(s => s.kind), ['resume', 'study']);
  const before = store.snapshot();
  await assert.rejects(() => sources.save({ resume: [own.id], personal: [own.id], study: [] }), /一种用途/);
  await assert.rejects(() => sources.save({ resume: ['missing'], personal: [], study: [] }), /不存在/);
  assert.deepEqual(store.snapshot(), before);
  await sources.save({ resume: [], personal: [], study: [] });
  assert.equal((await sources.status()).available, false);
  await assert.rejects(() => sources.load({ type: 'common', topic: 'all', count: 3 }), /上传/);
});
test('arbitrary named Markdown career files work in the legacy directory without personal filenames or page counts', async t => {
  const { directory } = await workspace(t); const sourcesDir = join(directory, 'sources'); await mkdir(sourcesDir);
  await writeFile(join(sourcesDir, 'resume.md'), resume);
  const sources = new FileInterviewSources(sourcesDir);
  assert.equal((await sources.status()).available, true);
  const loaded = await sources.load({ type: 'common', topic: 'all', count: 3 });
  assert.equal(loaded[0].kind, 'resume'); assert(loaded[0].content.includes('typed events'));
});
test('material validation localizes parameterized notices while preserving document titles', async t => {
  const { store, library } = await workspace(t);
  const own = (await library.importFile('career.md', Buffer.from(resume))).item;
  const extra = (await library.importFile('notes.md', Buffer.from('# Notes\nSupporting material.'))).item;
  const sources = new LibraryInterviewSources(store, library);
  await sources.save({ resume:[own.id], personal:[extra.id], study:[] });
  const title = '开始 · 中文资料 <code> {title}';
  await store.update(state => {
    state.settings = {model:'test',uiLanguage:'ja',userLanguage:'en'};
    Object.assign(state.library!.find(item => item.id === extra.id)!, {title,extractedText:''});
  });
  await assert.rejects(() => sources.load({type:'common',topic:'all',count:3}), error => {
    assert(error instanceof Error);
    assert(error.message.includes(title));
    assert.match(error.message, /読み取り可能/);
    assert(!error.message.includes('尚无可读取的文字'));
    return true;
  });
  await store.update(state => {
    state.settings!.uiLanguage = 'en';
    state.library!.find(item => item.id === extra.id)!.extractedText = 'a'.repeat(60001);
  });
  await assert.rejects(() => sources.load({type:'common',topic:'all',count:3}), error => {
    assert(error instanceof Error);
    assert(error.message.includes(title));
    assert.match(error.message, /exceeds 60,000 characters/);
    assert(!error.message.includes('请拆分后选择'));
    return true;
  });
});
test('backup restores history and original bytes, excludes credentials and logs, refuses overwrite and detects corruption', async t => {
  const { directory, store, library } = await workspace(t), dataDir = join(directory, 'data');
  const item = (await library.importFile('career.md', Buffer.from(resume))).item;
  await new LibraryInterviewSources(store, library).save({ resume: [item.id], personal: [], study: [] });
  await writeFile(join(dataDir, 'auth.json'), 'SECRET_CREDENTIAL_SENTINEL');
  await mkdir(join(dataDir, 'voice-demo')); await writeFile(join(dataDir, 'voice-demo', 'log.txt'), 'PRIVATE_LOG_SENTINEL');
  const data = await exportBackup(store, dataDir), archive = JSON.parse(gunzipSync(data).toString());
  assert(!gunzipSync(data).includes(Buffer.from('SECRET_CREDENTIAL_SENTINEL'))); assert(!gunzipSync(data).includes(Buffer.from('PRIVATE_LOG_SENTINEL')));
  const target = join(directory, 'restored'); await restoreBackup(data, target);
  const restored = new Store(join(target, 'state.json')); await restored.load(); assert.deepEqual(restored.snapshot(), store.snapshot());
  assert.deepEqual(await readFile(join(target, 'library', item.blob)), Buffer.from(resume));
  await assert.rejects(() => access(join(target, 'auth.json')));
  await assert.rejects(() => restoreBackup(data, target), /已存在/);
  archive.files[0].data = Buffer.from('changed').toString('base64');
  await assert.rejects(() => restoreBackup(gzipSync(JSON.stringify(archive)), join(directory, 'bad')), /校验/);
  await assert.rejects(() => access(join(directory, 'bad')));
  archive.state.library[0].blob = '../auth.json'; archive.files[0].name = '../auth.json'; archive.stateHash = createHash('sha256').update(JSON.stringify(archive.state)).digest('hex');
  await assert.rejects(() => restoreBackup(gzipSync(JSON.stringify(archive)), join(directory, 'unsafe')), /路径/);
  await assert.rejects(() => access(join(directory, 'unsafe')));
});
test('launcher validates runtime and port before opening the server', () => {
  assert.throws(() => assertNodeVersion('22.18.0'), /22.19/); assertNodeVersion('22.19.0'); assertNodeVersion('24.0.0');
  for (const value of ['0', '65536', '3.5', 'bad', '-1']) assert.throws(() => serverPort(value), /PORT/);
  assert.equal(serverPort('3000'), 3000);
});
