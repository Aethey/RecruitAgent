import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app/http.ts';
import { Store } from '../src/shared/persistence/store.ts';
import { FakeAI, fakeInterviewSources } from './fixtures.ts';
import { interviewFixture } from './interview-fixture.ts';

// Isolated question data; speech, transcription and feedback use the real Codex login.
const dataDir = await mkdtemp(join(tmpdir(),'recruitagent-browser-voice-'));
const store = new Store(join(dataDir,'state.json'));
await store.load();
await store.update(state => { state.interviews = [structuredClone(interviewFixture)]; });
const app = await createApp({dataDir,ai:new FakeAI(),sourceDir:null,interviewSources:fakeInterviewSources});
app.server.listen(3001,'127.0.0.1',() => console.log(JSON.stringify({url:'http://localhost:3001/#interview/'+interviewFixture.id,dataDir})));
let closing = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => {
  if (closing) return; closing = true;
  void app.close().then(() => rm(dataDir,{recursive:true,force:true})).finally(() => process.exit(0));
});
