import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexVoice } from '../src/codex-voice.ts';
import { VoiceInterviews, answerTips } from '../src/voice-interview.ts';
import { Store } from '../src/store.ts';
import { interviewContent } from '../src/interview.ts';
import { interviewFixture } from './interview-fixture.ts';
import { createApp } from '../src/server.ts';
import { FakeAI, fakeInterviewSources } from './fixtures.ts';
import { FakeVoiceRpc } from './voice-fixtures.ts';
import { DEFAULT_VOICE_SETTINGS } from '../src/voice-options.ts';
import type { AI } from '../src/pi.ts';
import { classifyVoiceIntent, hasAnswerContent } from '../src/voice-intent.ts';

class TranslationAI extends FakeAI {
  invalid = false;
  override async ask(...args: Parameters<AI['ask']>) {
    const [prompt,signal,,mode,,language] = args;
    this.prompts.push(prompt); this.requestedModes.push(mode ?? 'algorithm'); signal.throwIfAborted();
    return JSON.stringify({questions:interviewFixture.questions.map((q,index) => ({
      id:this.invalid ? 'wrong-id' : q.id,
      question:language === 'ja' ? ['支払い状態のリファクタリングで行ったことを、具体例を一つ挙げて説明してください。','共通の状態と個別の状態を、どのように分けましたか。','古いリクエストが新しい状態を上書きしないことを、どのように確認しますか。'][index] : ['What did you do in the payment state refactoring? Give one example.','How did you separate shared and individual state?','How would you verify that an old request cannot overwrite new state?'][index],
      tips:q.tips!.map((_,i) => language === 'ja' ? ['最初に結論を伝える。','自分の行動と確認方法を説明する。'][i] : ['Start with your conclusion.','Describe your action and verification.'][i]),
    }))});
  }
}

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

async function fixture(t: test.TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(),'voice-interview-test-')), store = new Store(join(dataDir,'state.json')), rpc = new FakeVoiceRpc();
  await store.load(); await store.update(s => { s.interviews = [structuredClone(interviewFixture)]; });
  const voice = new CodexVoice(dataDir,async () => rpc,50), ai = new TranslationAI(), interviews = new VoiceInterviews(store,voice,ai);
  const progress = new Map<string,any>(), events: {id:string;event:string;value:any}[] = [], emit = voice.emit.bind(voice);
  voice.emit = (id,event,value) => { events.push({id,event,value}); if (event === 'interview-progress') progress.set(id,value); emit(id,event,value); };
  const complete = (id: string) => { const current = progress.get(id); return interviews.action(id,{action:'response-complete',roundAt:current.round.at,inputRevision:current.inputRevision}); };
  const input = (id: string,revision: number) => interviews.action(id,{action:'answer-started',roundAt:progress.get(id).round.at,inputRevision:revision});
  t.after(async () => { await voice.close(); await store.flush(); await rm(dataDir,{recursive:true,force:true}); });
  return {dataDir,store,rpc,voice,interviews,ai,progress,events,complete,input};
}
const speak = (rpc: FakeVoiceRpc,role: string,value: string) => rpc.emit('thread/realtime/transcript/done',{threadId:'native-thread',role,text:value});

test('voice interview asks first, keeps tips on the current question, persists evidence-based feedback and preserves written answers',async t => {
  const {store,rpc,voice,interviews,dataDir,complete} = await fixture(t);
  const started = await interviews.start({id:'interview-session',sdp,interviewId:interviewFixture.id,voice:'breeze',tone:'gentle'},'zh');
  assert.equal(started.interview.stage,'waiting'); assert.equal(started.interview.question.tips.length,2);
  assert(!JSON.stringify(started).includes('PRIVATE_RESUME_BODY')); assert(!JSON.stringify(started).includes('关键字参考'));
  const native = rpc.calls.find(c => c.method === 'thread/realtime/start')!;
  assert.equal(native.params.model,'gpt-live-1-codex'); assert.equal(native.params.voice,'breeze'); assert.match(native.params.prompt,/温和/); assert.match(native.params.prompt,/不(?:要)?自动进入下一题/);
  const thread = rpc.calls.find(c => c.method === 'thread/start')!;
  assert.match(thread.params.baseInstructions,/表达清晰度与技术能力分开/); assert.match(thread.params.baseInstructions,/不臆造/);
  const first = await interviews.action(started.id,{action:'begin'}); assert.equal(first.stage,'answering');
  assert.equal(rpc.calls.find(c => c.method === 'thread/realtime/appendSpeech')!.params.text,interviewFixture.questions[0].question);
  await assert.rejects(interviews.action(started.id,{action:'next'}),/先回答/);
  speak(rpc,'user','嗯，我先说一大段背景，开了很多次会，没有明确结论。');
  speak(rpc,'assistant','你用“我先说一大段背景”开头，没有直接说明本人行动。先用一句话给结论，再用一个例子支撑。');
  await complete(started.id);
  const settings = await interviews.saveSettings(interviewFixture.id,{showTips:false}); assert.equal(settings.showTips,false);
  const second = await interviews.action(started.id,{action:'next'}); assert.equal(second.questionIndex,1); assert.deepEqual(second.question.tips,[]);
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{tone:'strict'}),/先结束/);
  speak(rpc,'user','我按照共享状态的时间尺度和个别页面的生命周期划分。'); speak(rpc,'assistant','结论明确，可以补充一个具体边界来说明依据。');
  await complete(started.id);
  await voice.end(started.id);
  const saved = store.interview(interviewFixture.id), attempt = saved.voiceAttempts![0];
  assert.equal(attempt.status,'stopped'); assert.equal(attempt.rounds.length,2);
  assert.equal(attempt.rounds[0].tipsShown,true); assert.equal(attempt.rounds[1].tipsShown,false);
  assert.match(attempt.rounds[0].feedback,/没有直接/); assert.match(attempt.rounds[1].answer,/生命周期/);
  assert.equal(saved.answers.q1,'已有文字草稿');
  const restored = new Store(join(dataDir,'state.json')); await restored.load(); assert.deepEqual(restored.interview(saved.id).voiceAttempts,saved.voiceAttempts);
});

test('retry preserves the previous attempt; finish requires all questions and is saved as completed',async t => {
  const {store,rpc,voice,interviews,complete} = await fixture(t), id='retry-interview';
  await interviews.start({id,sdp,interviewId:interviewFixture.id,showTips:false,synthetic:true},'ja'); await interviews.action(id,{action:'begin'});
  speak(rpc,'user','第一版回答'); speak(rpc,'assistant','先说结论。');
  await complete(id);
  await interviews.action(id,{action:'retry'}); speak(rpc,'user','第二版先给结论'); speak(rpc,'assistant','结论比之前清楚。');
  await complete(id);
  await assert.rejects(interviews.action(id,{action:'finish'}),/最后一道/);
  for (let i=0;i<2;i++) { await interviews.action(id,{action:'next'}); speak(rpc,'user','当前问题的回答'); speak(rpc,'assistant','有结论，再补充验证依据。'); await complete(id); }
  await interviews.action(id,{action:'finish'}); assert.equal((await voice.status()).active,false);
  const attempt = store.interview(interviewFixture.id).voiceAttempts![0]; assert.equal(attempt.status,'completed'); assert.equal(attempt.synthetic,true); assert.equal(attempt.rounds.length,4); assert.equal(attempt.rounds[0].answer,'第一版回答'); assert.equal(attempt.rounds[1].answer,'第二版先给结论');
});

test('voice settings validate voice groups and model IDs; model verification records audio evidence, not just an SDP',async t => {
  const {voice,rpc,interviews} = await fixture(t);
  const options = await voice.options(); assert.equal(options.voices.v1.length,9); assert.equal(options.voices.v2.length,10); assert.equal(options.directoryComplete,false); assert(options.models.every(m => !m.check));
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{model:'gpt-realtime-1.5',voice:'marin'}),/不支持/);
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{model:'gpt-6-luna'}),/列表/);
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{showTips:'yes'}),/tips/);
  await voice.start({id:'model-test-session',sdp,model:'gpt-realtime-1.5',voice:'cove',tone:'strict'});
  assert.equal(rpc.calls.find(c => c.method === 'thread/realtime/start')!.params.version,'v1');
  await assert.rejects(voice.verifyAudio('model-test-session',{energy:0,received:1000}),/有声/);
  assert.equal((await voice.options()).models.find(m => m.id === 'gpt-realtime-1.5')!.check,null);
  await voice.verifyAudio('model-test-session',{energy:.2,received:2000});
  assert.equal((await voice.options()).models.find(m => m.id === 'gpt-realtime-1.5')!.check!.status,'available');
});

test('interrupted sessions recover without altering completed rounds or inventing evaluations; legacy questions provide one focused tip',async t => {
  const {store,interviews} = await fixture(t);
  const legacy = {...interviewFixture.questions[0],tips:undefined}; assert.deepEqual(answerTips(legacy),[legacy.focus]);
  await store.update(state => { state.interviews![0].voiceAttempts = [{id:'interrupted',at:'2026-10-04',settings:{...DEFAULT_VOICE_SETTINGS,showTips:false},status:'active',rounds:[]}]; });
  await interviews.recover(); assert.equal(store.interview(interviewFixture.id).voiceAttempts![0].status,'interrupted'); assert.equal(store.interview(interviewFixture.id).voiceAttempts![0].rounds.length,0);
  const raw = {...interviewFixture,questions:interviewFixture.questions.map(({id,...q}) => q)};
  assert.equal(interviewContent(raw,3,interviewFixture.sources,'technical').questions[0].tips!.length,2);
  raw.questions[0].tips=['x'.repeat(101)]; assert.throws(() => interviewContent(raw,3,interviewFixture.sources,'technical'));
});

test('model negotiation failures remain visible and redacted after an asynchronous native close',async t => {
  const {voice,rpc} = await fixture(t); rpc.mode = 'error';
  await assert.rejects(voice.start({id:'failed-model-check',sdp,model:'gpt-live-1',voice:'cove'}));
  const check = (await voice.options()).models.find(model => model.id === 'gpt-live-1')!.check;
  assert.equal(check?.status,'failed'); assert.match(check!.message!,/Denied/);
  assert(!JSON.stringify(check).includes('SECRET_VALUE')); assert(!JSON.stringify(check).includes('sk-secret_123'));
  assert.equal((await voice.status()).active,false);
});

test('interview language translates questions and tips, caches by source, and controls speech and feedback independently of the global language',async t => {
  const {store,rpc,voice,interviews,ai,complete} = await fixture(t), original = structuredClone(store.interview(interviewFixture.id).questions);
  const settings = await interviews.saveSettings(interviewFixture.id,{language:'en'}); assert.equal(settings.language,'en');
  const translated = await interviews.prepare(interviewFixture.id,{}); assert.match(translated.questions[0].question,/payment/); assert.equal(translated.questions[0].tips[0],'Start with your conclusion.');
  assert(!ai.prompts[0].includes('PRIVATE_RESUME_BODY')); assert(!ai.prompts[0].includes('"keywords":')); assert.deepEqual(ai.requestedModes,['interview']);
  await interviews.prepare(interviewFixture.id,{}); assert.equal(ai.prompts.length,1);
  const started = await interviews.start({id:'english-interview',sdp,interviewId:interviewFixture.id},'ja');
  assert.equal(started.interview.settings.language,'en'); assert.equal(started.interview.question.text,translated.questions[0].question);
  assert.match(rpc.calls.find(c => c.method === 'thread/realtime/start')!.params.prompt,/OUTPUT LANGUAGE: English/);
  await interviews.action(started.id,{action:'begin'});
  assert.equal(rpc.calls.find(c => c.method === 'thread/realtime/appendSpeech')!.params.text,translated.questions[0].question);
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{language:'ja'}),/先结束/);
  speak(rpc,'user','I changed the state boundary and verified the old request.'); speak(rpc,'assistant','Start with your conclusion.');
  await complete(started.id);
  await voice.end(started.id);
  const saved = store.interview(interviewFixture.id); assert.deepEqual(saved.questions,original); assert.equal(saved.answers.q1,'已有文字草稿');
  assert.equal(saved.voiceAttempts![0].settings.language,'en'); assert.equal(saved.voiceAttempts![0].rounds[0].question,translated.questions[0].question);
  await store.update(state => { state.interviews![0].questions[0].question += '另一个边界。'; });
  await interviews.prepare(interviewFixture.id,{language:'en'}); assert.equal(ai.prompts.length,2);
});

test('legacy voice settings follow the global language; invalid languages and malformed translations fail without starting a call or rewriting questions',async t => {
  const {store,rpc,interviews,ai} = await fixture(t);
  await store.update(state => {
    state.settings = {model:'test-model',...state.settings,userLanguage:'ja'};
    state.interviews![0].voiceSettings = {...DEFAULT_VOICE_SETTINGS}; Reflect.deleteProperty(state.interviews![0].voiceSettings!,'language');
  });
  assert.equal((await interviews.saveSettings(interviewFixture.id,{tone:'gentle'})).language,'ja');
  await assert.rejects(interviews.saveSettings(interviewFixture.id,{language:'fr'}),/语言/);
  const original = structuredClone(store.interview(interviewFixture.id).questions); ai.invalid = true;
  await assert.rejects(interviews.start({id:'bad-language-interview',sdp,interviewId:interviewFixture.id},'zh'));
  assert(!rpc.calls.some(c => c.method === 'thread/realtime/start'));
  assert.deepEqual(store.interview(interviewFixture.id).questions,original); assert.equal(store.interview(interviewFixture.id).voiceAttempts?.length ?? 0,0);
});

test('interview HTTP settings and actions are local-only, return bounded context, and preserve voice results across navigation',async t => {
  const {dataDir,rpc} = await fixture(t), ai = new FakeAI();
  const app = await createApp({dataDir,ai,sourceDir:null,interviewSources:fakeInterviewSources,voiceRpcFactory:async () => rpc});
  await new Promise<void>(resolveListen => app.server.listen(0,'127.0.0.1',resolveListen)); t.after(() => app.close());
  const address = app.server.address(); assert(address && typeof address !== 'string'); const base='http://127.0.0.1:'+address.port;
  const request = (path: string,method='GET',body?: unknown,origin?: string) => fetch(base+path,{method,headers:{'Content-Type':'application/json',...(origin ? {Origin:origin} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  assert.equal((await request('/api/voice/options')).status,200);
  assert.equal((await request('/api/interviews/'+interviewFixture.id+'/voice-settings','PUT',{tone:'gentle'},'https://other.example')).status,403);
  const started = await (await request('/api/voice/sessions','POST',{id:'http-interview',sdp,interviewId:interviewFixture.id})).json(); assert(started.interview); assert(!JSON.stringify(started).includes('PRIVATE_RESUME_BODY'));
  assert.equal((await request('/api/voice/sessions/http-interview/action','POST',{action:'begin'})).status,200);
  speak(rpc,'user','回答太多背景，没有先说明结论。'); speak(rpc,'assistant','开头背景可以缩短，先说本人行动。');
  assert.equal((await request('/api/voice/sessions/http-interview','DELETE')).status,200);
  const saved = await (await request('/api/interviews/'+interviewFixture.id)).json(); assert.equal(saved.voiceAttempts[0].rounds[0].answer,'回答太多背景，没有先说明结论。'); assert(!JSON.stringify(saved).includes('PRIVATE_RESUME_BODY')); assert.equal(ai.prompts.length,0);
});

test('waiting acknowledgements never become interview feedback or complete a pending request',async t => {
  const {store,rpc,voice,interviews,complete} = await fixture(t), id='waiting-feedback';
  await interviews.start({id,sdp,interviewId:interviewFixture.id},'ja'); await interviews.action(id,{action:'begin'});
  speak(rpc,'user','AIで英語と日本語の翻訳と要約を行いました。');
  speak(rpc,'assistant','最初に結論を言うと伝わりやすくなります。');
  await complete(id);
  speak(rpc,'user','この事実だけを使って、例文を教えてください。');
  for (const value of ['少々お待ちください。','今、要点をまとめていますね。','確認してます、もう少しだけ待ってくださいね。','はい、今まとめています。','技術的なポイントの確認を急いでいます。','はい、急いでまとめます。']) speak(rpc,'assistant',value);
  await assert.rejects(interviews.action(id,{action:'next'}),/先回答/);
  await voice.end(id);
  assert.equal(store.interview(interviewFixture.id).voiceAttempts![0].rounds[0].feedback,'最初に結論を言うと伝わりやすくなります。');
});

test('spoken intents are bounded commands and do not consume quoted, negated or substantive answers',() => {
  for (const [phrase,intent] of [['下一题吧','next'],['我再补充一点','continue'],['能给我一个例文吗','sample'],['Can you give me an example?','sample'],['少し考えたいです','continue'],['我说完了','answer-complete']]) assert.equal(classifyVoiceIntent(phrase),intent);
  for (const phrase of ['我没有说下一题','请解释“下一题”的含义','我再补充一点，实际做法是检查请求序号。']) assert.equal(classifyVoiceIntent(phrase),'answer');
});

test('assistant text committed before user text is classified after the input and can complete the response',async t => {
  const {rpc,interviews,progress,input,complete} = await fixture(t), id='out-of-order-interview';
  await interviews.start({id,sdp,interviewId:interviewFixture.id},'zh'); await interviews.action(id,{action:'begin'});
  await input(id,1);
  speak(rpc,'assistant','本人行动清楚，再补一个验证场景。');
  await complete(id);
  assert.notEqual(progress.get(id).stage,'ready');
  speak(rpc,'user','我拆分状态边界，并验证旧请求不能覆盖新结果。');
  assert.equal(progress.get(id).stage,'ready');
  assert.equal(progress.get(id).round.feedback,'本人行动清楚，再补一个验证场景。');
  await input(id,2);
  speak(rpc,'assistant','例文：我拆分了状态边界，并验证了旧请求不会覆盖新结果。');
  await complete(id);
  speak(rpc,'user','给我一个例文。');
  assert.equal(progress.get(id).responseKind,'sample');
  assert.match(progress.get(id).reply,/例文/);
  assert.doesNotMatch(progress.get(id).round.answer,/给我/);
  assert.doesNotMatch(progress.get(id).round.feedback,/例文/);
});

test('segments do not enable advancement, while completed feedback allows spoken next and continuation stays on the current answer',async t => {
  const {rpc,interviews,progress,input,complete,events} = await fixture(t), id='spoken-advancement';
  await interviews.start({id,sdp,interviewId:interviewFixture.id},'zh'); await interviews.action(id,{action:'begin'});
  await input(id,1); speak(rpc,'user','我整理了共通与个别状态。'); speak(rpc,'assistant','结论明确，再补验证依据。');
  await assert.rejects(interviews.action(id,{action:'next'}),/先回答/);
  await complete(id); assert.equal(progress.get(id).stage,'ready');
  await input(id,2); speak(rpc,'user','下一题。');
  for (let i=0;i<100 && progress.get(id).questionIndex === 0;i++) await new Promise(resolve => setTimeout(resolve,2));
  assert.equal(progress.get(id).questionIndex,1);
  await input(id,3); speak(rpc,'user','我根据共享状态的时间尺度划分。'); speak(rpc,'assistant','还可以补一个具体边界。');
  await input(id,4); speak(rpc,'user','我还没说完。');
  assert.equal(progress.get(id).stage,'answering');
  assert(events.some(event => event.event === 'voice-control' && event.value.action === 'stop'));
  assert.doesNotMatch(progress.get(id).round.answer,/没说完/);
  assert.equal(progress.get(id).round.feedback,'');
  speak(rpc,'user','页面局部状态由页面生命周期决定。');
  speak(rpc,'assistant','这次区分依据更具体。'); await complete(id);
  assert.equal(progress.get(id).stage,'ready');
  assert.match(progress.get(id).round.answer,/生命周期/);
});
