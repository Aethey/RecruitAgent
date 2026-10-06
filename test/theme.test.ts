import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import { formatMessage } from '../src/generated/localizations.ts';

test('light and dark role pairs have readable text and visible input outlines',async()=>{
 const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
 const palettes=[...css.matchAll(/color-scheme:(light|dark);([^}]+)\}/g)].map(m=>({theme:m[1],colors:Object.fromEntries([...m[2].matchAll(/--([a-z-]+):(#[a-f0-9]{6});/g)].map(v=>[v[1],v[2]]))}));assert.equal(palettes.length,2);
 function luminance(hex:string){const [r,g,b]=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
 const pairs=[['ink','bg'],['muted','bg'],['muted','surface-alt'],['blue','bg'],['on-primary','primary-top'],['on-primary','primary-bottom'],['on-mint','mint'],['on-mint','mint-bottom'],['on-warning','warning-bg'],['on-pink','pink'],['toast-ink','toast-bg'],['editor-ink','editor-bg'],['code-comment','editor-bg'],['code-keyword','editor-bg'],['code-string','editor-bg'],['code-number','editor-bg'],['outline','bg']];
 for(const {theme,colors}of palettes)for(const [fg,bg]of pairs){const a=luminance(colors[fg]),b=luminance(colors[bg]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert(ratio>=(fg==='outline'?3:4.5),`${theme}: ${fg}/${bg} = ${ratio}`);}
});
test('theme preference restores before paint, follows system only when selected, and survives blocked storage',async()=>{
 const script=await readFile(new URL('../public/theme.js',import.meta.url),'utf8');
 function setup(saved:string|null,blocked=false){
  const root={dataset:{} as Record<string,string>},handlers=new Map<string,Function>(),events:any[]=[],attributes=new Map<string,string>(),toggle={title:'',setAttribute:(name:string,value:string)=>attributes.set(name,value),addEventListener:(_name:string,fn:Function)=>handlers.set('click',fn)},system={matches:true,addEventListener:(_name:string,fn:Function)=>handlers.set('system',fn)};let stored=saved;
  runInNewContext(script.replace(/^import .*;\n/m, ''),{formatMessage,window:{matchMedia:()=>system,addEventListener:(name:string,fn:Function)=>handlers.set(name,fn),dispatchEvent:(e:any)=>events.push(e)},document:{documentElement:root,querySelector:(q:string)=>q==='#theme-toggle'?toggle:{setAttribute(){}},addEventListener:(name:string,fn:Function)=>handlers.set(name,fn)},localStorage:{getItem:()=>{if(blocked)throw Error('unavailable');return stored;},setItem:(_key:string,value:string)=>{if(blocked)throw Error('unavailable');stored=value;}},CustomEvent:class{constructor(public type:string,public detail:any){}}});
  assert.equal(root.dataset.theme,saved==='light'?'light':'dark');
  handlers.get('DOMContentLoaded')!();return {root,handlers,events,toggle,attributes,system,stored:()=>stored};
 }
 const a=setup('light');assert.equal(a.attributes.get('aria-checked'),'false');assert.equal(a.toggle.title,'切换至深色主题');const count=a.events.length;a.system.matches=false;a.handlers.get('system')!();assert.equal(a.events.length,count);
 a.handlers.get('click')!();assert.equal(a.stored(),'dark');assert.equal(a.root.dataset.theme,'dark');assert.equal(a.attributes.get('aria-checked'),'true');assert.equal(a.toggle.title,'切换至浅色主题');assert.equal(setup(a.stored()).root.dataset.theme,'dark');
 a.handlers.get('storage')!({key:'algo-practice:theme',newValue:'system'});assert.equal(a.root.dataset.theme,'light');a.system.matches=true;a.handlers.get('system')!();assert.equal(a.root.dataset.theme,'dark');
 a.handlers.get('storage')!({key:'algo-practice:theme',newValue:'light'});assert.equal(a.root.dataset.theme,'light');
 const b=setup('invalid',true);assert.equal(b.root.dataset.theme,'dark');b.handlers.get('click')!();assert.equal(b.root.dataset.theme,'light');b.system.matches=false;b.handlers.get('system')!();b.system.matches=true;b.handlers.get('system')!();assert.equal(b.root.dataset.theme,'light');b.handlers.get('click')!();assert.equal(b.root.dataset.theme,'dark');
});
