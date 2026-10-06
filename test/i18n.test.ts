import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSource, translateMessage } from '../src/ui-messages.ts';
import { mapSource } from '../src/ui-source.ts';
// @ts-ignore Browser module has no TypeScript declarations.
import { setLanguages, ui } from '../public/i18n.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { voiceActivity } from '../public/voice-activity.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { createVoiceControls } from '../public/voice-controls.js';
// @ts-ignore Authored browser catalog has no TypeScript declarations.
import { KNOWLEDGE_CARDS } from '../public/knowledge-cards.js';

test('missing whole messages stay intact instead of becoming mixed language', () => {
  assert.equal(translateSource('开始一段尚未收录的文案', 'ja'), '开始一段尚未收录的文案');
  assert.equal(translateSource('<button title="开始">开始</button>', 'en', true), '<button title="Start">Start</button>');
});

test('authored template fragments translate while user content stays verbatim', () => {
  setLanguages({ uiLanguage: 'en', userLanguage: 'ja' });
  assert.equal(ui`<p>我的回答</p><p>${'开始 · 中文回答 <code>'}</p>`, '<p>My answer</p><p>开始 · 中文回答 <code></p>');
  assert.equal(ui`<input aria-label="开始${'中文名称'}">`, '<input aria-label="Start中文名称">');
  setLanguages({ uiLanguage: 'zh', userLanguage: 'zh' });
});

test('translated fragments retain HTML structure and escape translated attributes', () => {
  assert.equal(mapSource('> 开始</label>', true, source => source === '开始' ? 'Start & go' : source), '> Start &amp; go</label>');
  assert.equal(mapSource('<button aria-label="开始">开始</button>', true, () => '"Go" <now>'), '<button aria-label="&quot;Go&quot; &lt;now&gt;">&quot;Go&quot; &lt;now&gt;</button>');
  assert.equal(mapSource(' 开始 ', false, () => 'Use $& literally'), ' Use $& literally ');
});

test('message parameters preserve captions and enforce the authored placeholder contract', () => {
  const caption = '中文回答：开始 <script> {error}';
  assert.ok(translateMessage('voice.preview.caption', 'ja', {caption}).endsWith(caption));
  assert.throws(() => translateMessage('voice.stats', 'en', {seconds:1}), /Missing parameter/);
});

test('all bundled knowledge card fields have English translations without altering their originals', () => {
  for (const card of KNOWLEDGE_CARDS) {
    for (const field of ['topic','question','answer','takeaway']) {
      const original = card[field];
      assert.ok(!/[\u3400-\u9fff]/u.test(translateSource(original, 'en')), `${card.id}: ${field}`);
      assert.equal(card[field], original);
    }
    if (card.source) assert.ok(!/[\u3400-\u9fff]/u.test(translateSource(card.source[0], 'en')), card.id);
  }
});

test('voice controls and dynamic activity follow interface language, independently of interview language', () => {
  try {
    for (const locale of ['ja', 'en'] as const) {
      setLanguages({ uiLanguage: locale, userLanguage: 'zh' });
      const controls = createVoiceControls({ api: async () => ({}), escape: (value: string) => value, prefix: 'test', language: true, tips: true, preview: true });
      const markup = controls.render();
      assert.ok(!markup.includes('开始通话前'), markup);
      assert.ok(!markup.includes('显示回答重点'), markup);
      const idle = voiceActivity({ phase: 'idle' });
      assert.notEqual(idle.label, '等待开始');
      assert.notEqual(idle.detail, '麦克风未开启。');
      const thinking = voiceActivity({ phase: 'connected', processing: true, processingElapsed: 16 });
      assert.ok(thinking.detail.includes('16'));
      assert.match(thinking.detail, locale === 'ja' ? /音声を受信.*16 秒/ : /Voice received.*16 seconds/);
      controls.dispose();
    }
  } finally { setLanguages({ uiLanguage: 'zh', userLanguage: 'zh' }); }
});
