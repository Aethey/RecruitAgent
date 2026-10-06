import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Build-time CLI has no TypeScript declarations.
import { validateTranslations } from '../scripts/i18n.mjs';

test('translation imports reject incomplete, unexpected and altered-placeholder output', () => {
  const source = {'voice.status':'等待 {seconds} 秒', 'voice.action':'开始'};
  assert.doesNotThrow(() => validateTranslations(source, {'voice.status':'Wait {seconds} seconds', 'voice.action':'Start'}, 'en'));
  for (const invalid of [
    {'voice.status':'Wait {seconds} seconds'},
    {'voice.status':'Wait seconds', 'voice.action':'Start'},
    {'voice.status':'Wait {seconds} seconds', 'voice.action':'开始'},
    {'voice.status':'Wait {seconds} seconds', 'voice.action':'Start', extra:'unexpected'},
  ]) assert.throws(() => validateTranslations(source, invalid, 'en'));
  assert.doesNotThrow(() => validateTranslations({'tone':'自然'}, {'tone':'自然'}, 'ja'), 'Japanese kanji alone does not imply untranslated Chinese');
});
