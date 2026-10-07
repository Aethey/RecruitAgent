import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app/http.ts';
import {Store} from '../src/shared/persistence/store.ts';
import {advanceSchedule,initialSchedule,BUILTIN_POINTS,quizContent,quizFeedback,studySelection} from '../src/features/study/service.ts';
import { LANGUAGES } from '../src/shared/programming.ts';
import {FakeAI,fakeInterviewSources,fakeJobReader} from './fixtures.ts';
import {BREADTH_DOMAINS,BREADTH_GROUPS,BREADTH_POINTS} from '../src/features/study/breadth.ts';
const selection={category:'all',language:'dart',count:5,facet:'auto',weakOnly:false};
async function setup(t:{after(fn:()=>Promise<void>):void}) {
 const dataDir=await mkdtemp(join(tmpdir(),'study-test-')),ai=new FakeAI();let now=new Date('2026-10-02T00:00:00Z');
 const app=await createApp({dataDir,ai,interviewSources:fakeInterviewSources,jobReader:fakeJobReader,sourceDir:null,studyClock:()=>now});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const a=app.server.address();assert(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
 t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 async function request(path:string,method='GET',value?:unknown){const r=await fetch(base+path,{method,headers:value===undefined?{}:{'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});return {status:r.status,data:await r.json()};}
 async function complete(path:string,value:unknown){const r=await request(path,'POST',value);assert.equal(r.status,202,JSON.stringify(r.data));const job=app.tasks.get(r.data.jobId);await job.promise;assert.equal(job.status,'done',job.error??'Task should complete');return job.result as any;}
 async function generate(extra={}){const r=await complete('/api/study/batches',{...selection,...extra});return (await request('/api/study/batches/'+r.batchId)).data;}
 return {ai,app,request,complete,generate,dataDir,setTime:(v:string)=>now=new Date(v)};
}
test('independent interval ladder, partial answer and revealed reference deterministically change dates',()=>{
 let s=initialSchedule(new Date('2026-10-02T00:00:00Z'));
 for(const days of [1,3,7,14,30]){const at=new Date(s.dueAt),r=advanceSchedule(s,'correct',false,at);assert.equal(r.rating,'good');assert.equal(r.schedule.intervalDays,days);assert.equal(Date.parse(r.schedule.dueAt)-at.getTime(),days*86400000);s=r.schedule;}
 assert(advanceSchedule(s,'correct',false,new Date(s.dueAt)).schedule.intervalDays>30);
 const partial=advanceSchedule(s,'partial',false,new Date('2026-10-02T00:00:00Z'));assert.equal(partial.rating,'hard');assert.equal(partial.schedule.intervalDays,3);
 for(const [verdict,assisted] of [['incorrect',false],['correct',true]] as const){const r=advanceSchedule(s,verdict,assisted,new Date('2026-10-02T00:00:00Z'));assert.equal(r.schedule.dueAt,'2026-10-02T00:10:00.000Z');assert.equal(r.schedule.stage,0);assert.equal(r.schedule.independentStreak,0);assert.equal(r.schedule.lapses,1);}
});
test('catalog covers existing languages and concrete methods, CLI and mobile crash topics without assuming mastery',async t=>{
 const {request}=await setup(t);for(const language of Object.keys(LANGUAGES))assert(BUILTIN_POINTS.some(p=>p.category==='language'&&p.language===language));
 for(const term of ['DDD','TDD','DI','Kanban','Datadog','dSYM','ADB','Git'])assert(BUILTIN_POINTS.some(p=>p.title.includes(term)));
 const s=(await request('/api/state')).data;assert.equal(s.study.practicedPoints,0);assert.equal(s.study.due,0);assert.equal(s.study.cards.length,0);
 assert((await request('/api/study/catalog?category=language&language=swift')).data.points.every((p:any)=>p.language==='swift'));
});
test('breadth map covers non-mobile ecosystems, filters scope and does not invent tested coverage',async t=>{
 const {request,app,ai}=await setup(t),r=await request('/api/breadth');assert.equal(r.status,200);
 assert.equal(r.data.coverage.length,Object.keys(BREADTH_DOMAINS).length);
 assert(r.data.coverage.every((c:any)=>c.total>=8&&c.tested===0&&c.needsWork===0));
 assert.equal(new Set(BREADTH_POINTS.map(p=>p.id)).size,BREADTH_POINTS.length);
 for(const term of ['Melos','Pigeon','KSP','Terraform','Strategy','Kanban','pytest','Playwright','SwiftGen','OpenTelemetry'])assert(BREADTH_POINTS.some(p=>p.title.includes(term)));
 for(const domain of Object.keys(BREADTH_DOMAINS)){const slots=app.study.plan(studySelection({...selection,breadth:{domain,group:'all'}}));assert(slots.every(s=>s.point.breadth?.domain===domain));assert.equal(new Set(slots.map(s=>s.point.id)).size,slots.length);}
 const mixed=app.study.plan(studySelection({...selection,count:8,breadth:{domain:'all',group:'all'}}));assert.equal(new Set(mixed.map(s=>s.point.breadth?.domain)).size,8);
 assert.deepEqual([...new Set(mixed.map(s=>s.facet))].sort(),['apply','explain','recall']);
 const tools=app.study.plan(studySelection({...selection,breadth:{domain:'flutter',group:'generation'}}));assert(tools.every(s=>s.point.breadth?.domain==='flutter'&&s.point.breadth.group==='generation'));
 for(const scope of [{domain:'unknown'},{group:'unknown'},null,[]])assert.throws(()=>studySelection({...selection,breadth:scope}));
 const unrelated=BUILTIN_POINTS.find(p=>p.category==='algorithm')!;assert.throws(()=>app.study.plan(studySelection({...selection,pointId:unrelated.id,breadth:{domain:'cloud',group:'all'}})));
 assert.equal(ai.prompts.length,0);
});

test('breadth generation and grading reuse private references, independent review schedules and saved scope',async t=>{
 const {request,app,ai,generate,complete,dataDir}=await setup(t);
 const point=BREADTH_POINTS.find(p=>p.title.startsWith('Terraform'))!;
 await request('/api/model','PUT',{model:'test-small'});
 const b=await generate({count:3,pointId:point.id,breadth:{domain:'cloud',group:'all'}});
 assert(b.title.startsWith('技术广度'));assert.equal(b.items.length,3);assert(b.items.every((i:any)=>i.pointId===point.id&&!i.reference));
 assert.equal(ai.requestedModels.at(-1),'test-small');assert(ai.prompts.at(-1)!.includes('不统一改写成 Dart'));
 assert.deepEqual(b.items[0].references,point.references);
 assert.equal((await request('/api/breadth')).data.coverage.find((c:any)=>c.id==='cloud').tested,0);
 await complete(`/api/study/batches/${b.id}/review`,{answers:{[b.items[0].id]:'错误：把 Terraform 当成 AWS 专用服务'}});
 const updated=(await request(`/api/study/batches/${b.id}`)).data;
 assert.equal(updated.items[0].feedback.rating,'again');assert.equal(updated.items[0].feedback.schedule.dueAt,'2026-10-02T00:10:00.000Z');assert(updated.items[0].reference);assert(updated.items.slice(1).every((i:any)=>!i.reference&&!i.feedback));
 const map=(await request('/api/breadth')).data,cloud=map.coverage.find((c:any)=>c.id==='cloud');assert.equal(cloud.tested,1);assert.equal(cloud.needsWork,1);assert(map.coverage.filter((c:any)=>c.id!=='cloud').every((c:any)=>c.tested===0));
 assert.equal(map.points.find((p:any)=>p.id===point.id).progress.reviewed,1);
 await app.store.flush();const restored=new Store(join(dataDir,'state.json'));await restored.load();assert.equal(restored.snapshot().studyBatches![0].selection.breadth!.domain,'cloud');assert.equal(restored.snapshot().studyCards!.filter(c=>c.schedule.reviews).length,1);
 assert.equal((await request('/api/state')).data.study.batches[0].breadth.domain,'cloud');
 assert(Object.keys(BREADTH_GROUPS).length>=8);
});

test('mixed batch keeps reference private, respects model and saves known drafts without calling AI',async t=>{
 const {ai,request,generate,app,dataDir}=await setup(t);await request('/api/model','PUT',{model:'test-small'});const b=await generate();
 assert.equal(new Set(b.items.map((i:any)=>i.category)).size,5);assert(b.items.every((i:any)=>!i.reference));assert.equal(ai.requestedModes.at(-1),'study');assert.equal(ai.requestedModels.at(-1),'test-small');
 assert((await request('/api/state')).data.studyBatches[0].items.every((i:any)=>!i.reference));const count=ai.prompts.length;
 const answers={[b.items[0].id]:'saved answer'};assert.equal((await request(`/api/study/batches/${b.id}`,'PUT',{answers})).status,200);assert.equal(ai.prompts.length,count);
 assert.equal((await request(`/api/study/batches/${b.id}`,'PUT',{answers:{foreign:'bad'}})).status,400);
 await app.store.flush();const restored=new Store(join(dataDir,'state.json'));await restored.load();assert.deepEqual(restored.snapshot().studyBatches![0].drafts,answers);
});
test('partial submission updates only its facet, preserves later edits and rejects duplicate grading',async t=>{
 const {request,generate,app,ai,setTime}=await setup(t),b=await generate(),item=b.items[0],path=`/api/study/batches/${b.id}`;ai.delay=100;
 const response=await request(path+'/review','POST',{answers:{[item.id]:'independent answer'}});await request(path,'PUT',{answers:{[item.id]:'newer draft'}});await app.tasks.get(response.data.jobId).promise;
 const saved=(await request(path)).data;assert.equal(saved.drafts[item.id],'newer draft');assert.equal(saved.items[0].feedback.answer,'independent answer');assert.equal(saved.items[0].feedback.schedule.dueAt,'2026-10-03T00:00:00.000Z');
 assert(saved.items.slice(1).every((i:any)=>!i.feedback&&!i.reference));assert.equal((await request(path+'/review','POST',{answers:{[item.id]:'repeat'}})).status,409);
 const s=(await request('/api/state')).data;assert.equal(s.study.todayReviews,1);assert.equal(s.study.practicedPoints,1);assert.equal(s.study.cards.filter((c:any)=>c.schedule.reviews).length,1);
 setTime('2026-10-03T00:00:00Z');const slots=app.study.plan(studySelection({...selection,weakOnly:true}));assert.equal(slots[0].cardId,item.cardId);assert.equal(slots[0].reason,'due');assert.equal((await request('/api/state')).data.study.todayReviews,0);
});
test('showing reference during review caps interval and repeated reveals have no AI cost',async t=>{
 const {request,generate,app,ai,setTime}=await setup(t),b=await generate(),i=b.items[0],path=`/api/study/batches/${b.id}`;ai.delay=100;
 const r=await request(path+'/review','POST',{answers:{[i.id]:'correct answer'}}),revealed=await request(`${path}/items/${i.id}/reveal`,'POST',{});assert(revealed.data.items[0].reference);
 await app.tasks.get(r.data.jobId).promise;const f=(await request(path)).data.items[0].feedback;assert.equal(f.rating,'again');assert.equal(f.assisted,true);assert.equal(f.schedule.dueAt,'2026-10-02T00:10:00.000Z');
 assert.throws(()=>app.study.plan(studySelection({...selection,weakOnly:true})));setTime('2026-10-02T00:10:00Z');assert.equal(app.study.plan(studySelection({...selection,weakOnly:true}))[0].cardId,i.cardId);
 const count=ai.prompts.length;await request(`${path}/items/${i.id}/reveal`,'POST',{});assert.equal(ai.prompts.length,count);assert.equal((await request(path)).data.items[0].feedback.schedule.dueAt,f.schedule.dueAt);
});
test('closing unfinished quiz releases unreviewed cards and preserves answered records and independent schedules',async t=>{
 const {request,generate,complete,app}=await setup(t);const p=(await request('/api/study/points','POST',{title:'开发验证 DI',category:'concept',facets:['recall','apply','explain']})).data;
 const b=await generate({pointId:p.id,count:3});assert.equal(b.items.length,3);assert.throws(()=>app.study.plan(studySelection({...selection,pointId:p.id,count:3})));
 await complete(`/api/study/batches/${b.id}/review`,{answers:{[b.items[0].id]:'independent answer'}});
 await request(`/api/study/batches/${b.id}/close`,'POST',{});const saved=(await request(`/api/study/batches/${b.id}`)).data;assert(saved.items[0].feedback);assert(saved.items.slice(1).every((i:any)=>i.skippedAt));assert.equal((await request('/api/state')).data.study.pending,0);assert.equal((await request(`/api/study/batches/${b.id}`,'PUT',{answers:{[b.items[1].id]:'later ungraded note'}})).status,200);
 assert.equal((await request(`/api/study/batches/${b.id}/review`,'POST',{answers:{[b.items[1].id]:'late answer'}})).status,409);
 const next=await generate({pointId:p.id,count:3});assert(next.items.some((i:any)=>i.facet==='apply'));assert.equal((await request('/api/state')).data.study.todayReviews,1);
});
test('source import keeps local source links, deduplicates, and avoids changing original records',async t=>{
 const {request,complete,app}=await setup(t);const r=(await request('/api/trainings','POST',{kind:'compression',question:'开发验证：为什么分离状态？',original:'共通状態と個別状態を分離しました。'})).data,old=app.store.training(r.id);
 for(let n=0;n<2;n++)await complete('/api/study/import',{kind:'training',id:r.id});const s=(await request('/api/state')).data;
 assert.equal(s.studyPoints.length,2);assert(s.studyPoints.every((p:any)=>p.source.id===r.id&&p.source.title===r.title&&!p.source.content));assert.deepEqual(app.store.training(r.id),old);
 assert.equal((await request('/api/study/import','POST',{kind:'training',id:'foreign'})).status,404);
});
test('cancelled or invalid AI result persists no study data, busy state and unauthenticated local editing work',async t=>{
 const {request,app,ai}=await setup(t);ai.mode='malformed';let r=await request('/api/study/batches','POST',selection);await app.tasks.get(r.data.jobId).promise;assert.equal(app.tasks.get(r.data.jobId).status,'error');assert.equal(app.store.snapshot().studyBatches,undefined);
 ai.mode='block';r=await request('/api/study/batches','POST',selection);assert.equal((await request('/api/model','PUT',{model:'test-small'})).status,409);assert.equal((await request('/api/study/batches','POST',selection)).status,409);
 await request(`/api/jobs/${r.data.jobId}/abort`,'POST',{});assert.equal(app.tasks.get(r.data.jobId).status,'aborted');assert.equal(app.store.snapshot().studyCards,undefined);
 ai.authenticated=false;assert.equal((await request('/api/study/batches','POST',selection)).status,401);assert.equal((await request('/api/study/points','POST',{title:'local only',category:'tools',facets:['write']})).status,201);
 assert.throws(()=>quizFeedback({items:[{itemId:'foreign',verdict:'correct',summary:'s',gaps:[]}]},['real']));assert.throws(()=>quizContent({items:[]},[{point:BUILTIN_POINTS[0],facet:'recall',cardId:'x',reason:'new'}]));
});
