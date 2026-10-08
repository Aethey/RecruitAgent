import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module has no TypeScript declarations.
import { createVoiceControls } from '../public/voice-controls.js';

test('the current connection supersedes a historical model failure, while the directory keeps its last result',async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'document'), nodes = new Map<string,any>();
  for (const name of ['settings','model','voice','tone','test-model','selection-note','models']) nodes.set('test-'+name,{innerHTML:'',textContent:'',value:'',disabled:false});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>nodes.get(id)}});
  t.after(()=>{ if(previous) Object.defineProperty(globalThis,'document',previous); else Reflect.deleteProperty(globalThis,'document'); });
  const catalog = {models:[{id:'gpt-live-1-codex',group:'v1',source:'codex',label:'GPT-Live',check:{status:'failed',at:'2026-10-04T10:00:00Z',message:'model unavailable'}}],voices:{v1:['cove'],defaultV1:'cove'},tones:{natural:'Natural'}};
  const controls = createVoiceControls({prefix:'test',escape:(value:unknown)=>String(value),api:async()=>catalog});
  t.after(()=>controls.dispose());
  await controls.load(); assert.match(nodes.get('test-selection-note').textContent,/上次检查失败/);
  controls.setSession({phase:'connected',audioVerified:false});
  assert.match(nodes.get('test-selection-note').textContent,/本次通话已连接/);
  assert.match(nodes.get('test-model').innerHTML,/通话中/);
  assert(!nodes.get('test-selection-note').textContent.includes('unavailable'));
  controls.setSession({phase:'connected',audioVerified:true});
  assert.match(nodes.get('test-selection-note').textContent,/已收到语音/);
  assert.match(nodes.get('test-models').innerHTML,/上次检查失败/);
});

test('a delayed catalog response cannot overwrite the result of a newer reload',async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'document'), nodes = new Map<string,any>();
  for (const name of ['settings','model','voice','tone','test-model','selection-note','models']) nodes.set('test-'+name,{innerHTML:'',textContent:'',value:'',disabled:false});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>nodes.get(id)}});
  t.after(()=>{ if(previous) Object.defineProperty(globalThis,'document',previous); else Reflect.deleteProperty(globalThis,'document'); });
  const catalog = (status:string) => ({models:[{id:'gpt-live-1-codex',group:'v1',source:'codex',label:'GPT-Live',check:{status}}],voices:{v1:['cove'],defaultV1:'cove'},tones:{natural:'Natural'}});
  let complete!: (value:unknown)=>void, calls=0;
  const controls=createVoiceControls({prefix:'test',escape:(value:unknown)=>String(value),api:async()=> ++calls===1 ? new Promise(resolve=>{complete=resolve;}) : catalog('available')});
  t.after(()=>controls.dispose());
  const old=controls.load(); await controls.load(); complete(catalog('failed')); await old;
  assert.match(nodes.get('test-selection-note').textContent,/已收到语音/);
});

test('compact interview controls omit model diagnostics and report load failures through the log callback',async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'document'), nodes = new Map<string,any>();
  for (const name of ['settings','model','voice','tone','preview']) nodes.set('test-'+name,{innerHTML:'',textContent:'',value:'',disabled:false,setAttribute() {}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>nodes.get(id)}});
  t.after(()=>{ if(previous) Object.defineProperty(globalThis,'document',previous); else Reflect.deleteProperty(globalThis,'document'); });
  const errors: Error[] = [], catalog = {models:[{id:'gpt-live-1-codex',group:'v1',label:'GPT-Live',check:{status:'failed',message:'PRIVATE_DIAGNOSTIC'}}],voices:{v1:['cove'],defaultV1:'cove'},tones:{natural:'Natural'}};
  let fail = false;
  const controls = createVoiceControls({prefix:'test',compact:true,preview:true,escape:String,api:async()=> { if (fail) throw new Error('PRIVATE_DIAGNOSTIC'); return catalog; },onError:(error:Error)=>errors.push(error)});
  t.after(()=>controls.dispose());
  assert(!controls.render().includes('selection-note')); assert(!controls.render().includes('models'));
  await controls.bind(); assert(!nodes.get('test-model').innerHTML.includes('失败')); assert(!nodes.get('test-model').innerHTML.includes('PRIVATE_DIAGNOSTIC'));
  controls.setPreview(true); controls.setPreview(false);
  fail = true; await controls.load(); assert.equal(errors.length,1); assert.equal(errors[0].message,'PRIVATE_DIAGNOSTIC');
});
