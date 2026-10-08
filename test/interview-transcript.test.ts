import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module has no TypeScript declarations.
import { createTranscriptScroller } from '../public/interview-transcript.js';

function fixture() {
  const listeners = new Map<string, () => void>();
  const text = {textContent:''}, latest = {hidden:true,addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),removeEventListener:(name:string)=>listeners.delete(name)};
  let position = 0, focused = false;
  const viewport = {
    clientHeight:100,
    get scrollHeight() { return Math.max(100,text.textContent.length); },
    get scrollTop() { return position; },
    set scrollTop(value:number) { position = Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight)); },
    focus(options:{preventScroll:boolean}) { focused = options.preventScroll; },
    addEventListener:(name:string,callback:()=>void)=>listeners.set(name,callback),removeEventListener:(name:string)=>listeners.delete(name),
  };
  return {text,latest,viewport,listeners,focused:()=>focused,view:createTranscriptScroller({viewport,text,latest})};
}

test('growing transcripts follow the tail, preserve a reader position, and resume following on demand', () => {
  const {view,viewport,latest,listeners,focused} = fixture();
  view.update('a'.repeat(500)); assert.equal(viewport.scrollTop,400); assert.equal(latest.hidden,true);
  viewport.scrollTop = 120; listeners.get('scroll')!();
  view.update('a'.repeat(800)); assert.equal(viewport.scrollTop,120); assert.equal(latest.hidden,false);
  listeners.get('click')!(); assert.equal(viewport.scrollTop,700); assert.equal(latest.hidden,true); assert.equal(focused(),true);
  view.update('a'.repeat(900)); assert.equal(viewport.scrollTop,800);
  viewport.scrollTop = 780; listeners.get('scroll')!(); view.update('a'.repeat(1000)); assert.equal(viewport.scrollTop,900);
});

test('unchanged draws do not move the reader, and a new round resets following and cleans up listeners', () => {
  const {view,viewport,latest,listeners} = fixture();
  view.update('a'.repeat(500)); viewport.scrollTop=100; listeners.get('scroll')!();
  view.update('a'.repeat(500)); assert.equal(viewport.scrollTop,100);
  view.reset(); assert.equal(viewport.scrollTop,0); assert.equal(latest.hidden,true);
  view.update('b'.repeat(600)); assert.equal(viewport.scrollTop,500); assert.equal(latest.hidden,true);
  view.dispose(); assert.equal(listeners.size,0);
});
