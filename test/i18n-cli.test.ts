import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// @ts-ignore Build-time CLI has no TypeScript declarations.
import { validateResources, generateAccessors } from '../scripts/i18n.mjs';

const resources={zh:{'voice.wait':'等待 {seconds} 秒','voice.start':'开始'},ja:{'voice.wait':'{seconds} 秒待機','voice.start':'開始'},en:{'voice.wait':'Wait {seconds} seconds','voice.start':'Start'}};
test('resource generation rejects missing, extra, empty and mismatched-parameter translations',()=>{
  assert.doesNotThrow(()=>validateResources(resources));
  for(const entries of [{'voice.wait':'Wait {seconds} seconds'},{...resources.en,extra:'Unexpected'},{...resources.en,'voice.start':''},{...resources.en,'voice.wait':'Wait seconds'},{...resources.en,'voice.start':'开始'}])assert.throws(()=>validateResources({...resources,en:entries}));
  assert.throws(()=>validateResources({...resources,zh:{'中文 key':'开始'}}),/stable identifier/);
});
test('the generator is deterministic and never invokes translation services or processes',async()=>{
  assert.equal(generateAccessors(resources),generateAccessors(structuredClone(resources)));
  const output=generateAccessors(resources);assert.match(output,/seconds: string \| number/);
  const source=await readFile(new URL('../scripts/i18n.mjs',import.meta.url),'utf8');
  assert.ok(!/child_process|\bspawn\b|codex exec|I18N_CODEX_BIN|\bfetch\(/.test(source));
});

test('Japanese shared kanji and placeholders are allowed while copied Chinese sentences fail',()=>{
  assert.doesNotThrow(()=>validateResources({zh:{tone:'自然',updated:'{time} 更新'},ja:{tone:'自然',updated:'{time} 更新'},en:{tone:'Natural',updated:'Updated {time}'}}));
  const source='请连接账号后再开始练习。';assert.throws(()=>validateResources({zh:{notice:source},ja:{notice:source},en:{notice:'Connect your account before starting.'}}),/copied Chinese/);
});
