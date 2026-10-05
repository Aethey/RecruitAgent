import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../src/server.ts';
import {Store} from '../src/store.ts';
import {FakeAI,fakeInterviewSources,fakeJobReader,sampleCompression} from './fixtures.ts';
import {compressionResult,debriefResult,followupResult,trainingRecord,draftInput} from '../src/training.ts';

async function setup(t:{after(fn:()=>Promise<void>):void}){
 const dataDir=await mkdtemp(join(tmpdir(),'training-test-')),ai=new FakeAI(),app=await createApp({dataDir,ai,interviewSources:fakeInterviewSources,jobReader:fakeJobReader,sourceDir:null});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 async function request(path:string,method='GET',value?:unknown){const r=await fetch(base+path,{method,headers:value===undefined?{}:{'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json()};}
 async function complete(path:string,value:unknown){const r=await request(path,'POST',value);assert.equal(r.status,202,JSON.stringify(r.data));const job=app.tasks.get(r.data.jobId);await job.promise;assert.equal(job.status,'done',job.error??'Task should complete');return job.result as any;}
 async function create(kind:string,extra={}){const r=await request('/api/trainings','POST',{kind,question:'なぜ状態を分けましたか？',original:'変更時の影響範囲を追いづらかったため、共通状態と個別状態を分離しました。',...extra});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
 return {ai,app,request,complete,create,dataDir};
}

test('compression imports actual interview drafts, preserves parent history and short self-written points',async t=>{
 const {ai,request,complete,create,app,dataDir}=await setup(t);
 const generated=await complete('/api/interviews',{type:'technical',topic:'architecture',count:3});const set=(await request(`/api/interviews/${generated.interviewId}`)).data,q=set.questions[0];
 const original='結論は変更しやすくすることです。まず背景を詳しくお伝えすると、Caseが増え、責務が混在していました。本人が共通状態と個別状態を分離し、遷移を確認しました。';
 await request(`/api/interviews/${set.id}`,'PUT',{answers:{[q.id]:original}});const calls=ai.prompts.length;
 const record=await create('compression',{interviewId:set.id,questionId:q.id,original:undefined});assert.equal(ai.prompts.length,calls);assert.equal(record.draft.original,original);assert.equal(record.sources[0].content,undefined);
 await request('/api/model','PUT',{model:'test-small'});await complete(`/api/trainings/${record.id}/analyze`,{draft:record.draft});
 const draft={original,points:'結論：変更しやすい責務分離\n行動：共通状態と個別状態を分離\n確認：遷移ごとの期待値を確認'};
 await request(`/api/trainings/${record.id}`,'PUT',{draft});await complete(`/api/trainings/${record.id}/rewrite`,{draft});
 const saved=(await request(`/api/trainings/${record.id}`)).data;assert.equal(saved.reviews.length,2);assert.deepEqual(saved.reviews[1].input,draft);assert.equal(saved.reviews[1].model,'test-small');assert.equal(ai.requestedModes.at(-1),'training');assert(ai.prompts.at(-1)!.includes(original));
 assert.equal((await request(`/api/interviews/${set.id}`)).data.answers[q.id],original);
 await app.store.flush();const restored=new Store(join(dataDir,'state.json'));await restored.load();assert.equal(restored.training(record.id).reviews.length,2);
});

test('compressed answers require 3–5 short lines and invalid AI references do not persist',async t=>{
 const {ai,request,create,app}=await setup(t),r=await create('compression');
 for(const points of ['一行\n二行',Array(6).fill('要点').join('\n'),'x'.repeat(81)+'\n二行\n三行'])assert.equal((await request(`/api/trainings/${r.id}/rewrite`,'POST',{draft:{original:r.draft.original,points}})).status,400);
 assert.equal(ai.prompts.length,0);ai.mode='malformed';const j=await request(`/api/trainings/${r.id}/analyze`,'POST',{draft:r.draft});await app.tasks.get(j.data.jobId).promise;assert.equal(app.tasks.get(j.data.jobId).status,'error');assert.equal(app.store.training(r.id).reviews.length,0);
 assert.throws(()=>compressionResult({...sampleCompression,cuts:[{quote:'这是不存在的原文',reason:'删除'}]},r.draft.original));
});

test('training review captures submitted input without overwriting a newer draft',async t=>{
 const {ai,request,create,app}=await setup(t),r=await create('compression');ai.delay=80;
 const submitted={...r.draft},response=await request(`/api/trainings/${r.id}/analyze`,'POST',{draft:submitted});
 const newer={original:'这是用户在等待评价时继续编辑的新草稿。',points:'新要点1\n新要点2\n新要点3'};await request(`/api/trainings/${r.id}`,'PUT',{draft:newer});await app.tasks.get(response.data.jobId).promise;
 const saved=(await request(`/api/trainings/${r.id}`)).data;assert.deepEqual(saved.draft,newer);assert.deepEqual(saved.reviews[0].input,submitted);
});

test('followup uses actual answers one question at a time, keeps snapshots and stops at eight',async t=>{
 const {ai,request,create,complete}=await setup(t),r=await create('followup');let saved=r;
 for(let n=1;n<=8;n++){
  const turn=saved.turns.at(-1),answer=`回答${n}：状态边界与验证依据。`;await request(`/api/trainings/${r.id}`,'PUT',{draft:{[`answer:${turn.id}`]:answer}});
  if(n===2)assert.equal((await request(`/api/trainings/${r.id}/next`,'POST',{turnId:r.turns[0].id,answer})).status,409);
  await complete(`/api/trainings/${r.id}/next`,{turnId:turn.id,answer});saved=(await request(`/api/trainings/${r.id}`)).data;
  assert.equal(saved.turns[n-1].submittedAnswer,answer);assert(ai.prompts.at(-1)!.includes(answer));assert.equal(saved.turns.length,Math.min(n+1,8));
 }
 assert.equal(saved.finished,true);assert(saved.stopReason);assert.equal((await request(`/api/trainings/${r.id}/next`,'POST',{turnId:saved.turns.at(-1).id,answer:'new'})).status,400);
 const first=saved.turns[0];await request(`/api/trainings/${r.id}`,'PUT',{draft:{[`answer:${first.id}`]:'later edit'}});saved=(await request(`/api/trainings/${r.id}`)).data;assert.equal(saved.turns[0].submittedAnswer,'回答1：状态边界与验证依据。');
});

test('diagnosis hides reference until review, keeps editable code and reveals without another AI call',async t=>{
 const {ai,request,complete}=await setup(t);await request('/api/model','PUT',{model:'test-small'});
 const job=await complete('/api/trainings/diagnosis',{language:'dart',topic:'state',focus:'状态覆盖'});assert.equal(job.created,true);const path=`/api/trainings/${job.trainingId}`,record=(await request(path)).data;
 assert.equal(record.scenario.reference,undefined);assert.equal((await request('/api/state')).data.trainings[0].scenario.reference,undefined);assert.equal((await request(`${path}/reveal`,'POST',{})).status,400);
 const draft={code:'// user repair',cause:'请求完成顺序改变，旧结果覆盖新状态。',checks:'让第二个请求先完成，再完成第一个请求，确认没有覆盖。'};await request(path,'PUT',{draft});await complete(`${path}/review`,{draft});assert.equal(ai.requestedModels.at(-1),'test-small');
 const calls=ai.prompts.length,reveal=await request(`${path}/reveal`,'POST',{});assert.equal(reveal.status,200);assert(reveal.data.scenario.reference.fixedCode);assert.deepEqual(reveal.data.draft,draft);assert.equal(ai.prompts.length,calls);
 assert.equal((await request(`${path}/reveal`,'POST',{})).data.revealedAt,reveal.data.revealedAt);
});

test('debrief preserves actual feedback and missing evidence, launches training from the chosen review snapshot',async t=>{
 const {request,complete,create,ai}=await setup(t),r=await create('debrief'),draft={company:'开发验证（非真实面试）',role:'Mobile Engineer',date:'2026-10-02',stage:'技术',notes:'自测数据','question:1':'なぜ分離したのですか？','answer:1':'先説明すると背景は長いです。本人が責務を分離しました。','feedback:1':'请先说结论。','question:2':'どう検証しましたか？','answer:2':'','feedback:2':''};
 await request(`/api/trainings/${r.id}`,'PUT',{draft});await complete(`/api/trainings/${r.id}/review`,{draft});const saved=(await request(`/api/trainings/${r.id}`)).data,review=saved.reviews[0];assert.equal(review.result.observations[1].content,'NE：未提供当时回答。');assert(review.result.observations[0].evidence.includes(draft['feedback:1']));assert(ai.prompts.at(-1)!.includes('不推断被拒原因'));
 await request(`/api/trainings/${r.id}`,'PUT',{draft:{'answer:1':'后来编辑的回答'}});
 const derived=await create('compression',{debriefId:r.id,reviewId:review.id,entryId:'1'});assert.equal(derived.draft.original,draft['answer:1']);assert.equal(derived.debriefId,r.id);assert.equal(derived.sources[0].content,undefined);
 assert.equal((await request('/api/trainings','POST',{kind:'followup',debriefId:r.id,reviewId:review.id,entryId:'8'})).status,404);
 const input={...draft,'question:3':'' ,'answer:3':'missing question'};assert.equal((await request(`/api/trainings/${r.id}/review`,'POST',{draft:input})).status,400);
});

test('cancelled training, missing auth and cross-module busy state preserve stored drafts and history',async t=>{
 const {ai,request,create,app}=await setup(t),r=await create('compression');ai.mode='block';const response=await request(`/api/trainings/${r.id}/analyze`,'POST',{draft:r.draft});
 assert.equal((await request('/api/model','PUT',{model:'test-small'})).status,409);assert.equal((await request('/api/trainings/diagnosis','POST',{language:'dart',topic:'state'})).status,409);assert.equal((await request(`/api/trainings/${r.id}`,'PUT',{draft:{original:'continued draft'}})).status,200);
 await request(`/api/jobs/${response.data.jobId}/abort`,'POST',{});assert.equal(app.tasks.get(response.data.jobId).status,'aborted');assert.equal(app.store.training(r.id).reviews.length,0);assert.equal(app.store.training(r.id).draft.original,'continued draft');
 ai.authenticated=false;assert.equal((await request(`/api/trainings/${r.id}/analyze`,'POST',{draft:r.draft})).status,401);assert.equal((await create('debrief')).kind,'debrief');assert.equal((await request('/api/state')).data.problems.length,0);
});

test('training validation rejects foreign drafts, duplicate observations and ungrounded source IDs',()=>{
 const r=trainingRecord('compression','question',{original:'answer',points:''});assert.throws(()=>draftInput({draft:{'answer:foreign':'text'}},r));
 assert.throws(()=>debriefResult({summary:'test',observations:[{entryId:'foreign'}],priorities:[{entryId:'1',kind:'compression'}],nextSteps:['test']},['1']));
 assert.throws(()=>followupResult({feedback:{summary:'s',technical:'t',evidence:'e',expression:'x',gaps:[],keywords:['a','b','c']},next:{question:'q',kind:'technical',focus:'f',keywords:['a','b','c'],answerBasis:'experience',evidenceNote:'n',sourceIds:['fake']},stopReason:''},[{id:'real',title:'t',kind:'study',content:'c'}],false));
});
