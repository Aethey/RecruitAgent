import test from 'node:test';
import assert from 'node:assert/strict';
import zh from '../public/locales/zh.json' with {type:'json'};
import ja from '../public/locales/ja.json' with {type:'json'};
import en from '../public/locales/en.json' with {type:'json'};
import { formatMessage, authoredMessageKey, parameterNames, type MessageKey } from '../src/generated/localizations.ts';
// @ts-ignore Browser module has no TypeScript declarations.
import { setLanguages, t, catalogText } from '../public/i18n.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { voiceActivity } from '../public/voice-activity.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { createVoiceControls } from '../public/voice-controls.js';
// @ts-ignore Authored browser catalog has no TypeScript declarations.
import { KNOWLEDGE_CARDS, CARD_CATEGORIES } from '../public/knowledge-cards.js';
// @ts-ignore Browser module has no TypeScript declarations.
import { interviewTitle } from '../public/interview-title.js';
import { interviewFixture } from './interview-fixture.ts';

// Checked by tsc: the generated interface must reject unknown identifiers and bad parameters.
if (false) {
  // @ts-expect-error An absent resource identifier is not accepted.
  formatMessage('ja', 'missing.identifier');
  // @ts-expect-error Parameters of a generated message are mandatory.
  formatMessage('en', 'voice.stats');
  // @ts-expect-error The received parameter is missing.
  formatMessage('en', 'voice.stats', {seconds:1,sent:0});
}

test('all resource identifiers have translations and preserve their parameter contracts', () => {
  for (const key of Object.keys(zh) as MessageKey[]) for (const locale of ['zh','ja','en'] as const) {
    const params = Object.fromEntries((parameterNames[key] ?? []).map(name=>[name,'TEST_VALUE']));
    const text = formatMessage(locale, key, ...((parameterNames[key]?.length ? [params] : []) as [never]));
    assert.ok(text.trim(), `${locale}/${key}`);
    assert.ok(!/\{[a-zA-Z]\w*\}/.test(text), `${locale}/${key}`);
  }
  assert.deepEqual(Object.keys(ja).sort(),Object.keys(zh).sort());
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
});

test('unknown resources and missing parameters fail instead of falling back to Chinese', () => {
  assert.throws(()=>formatMessage('ja','missing' as MessageKey),/Unknown localization resource/);
  assert.throws(()=>formatMessage('en','voice.stats',{} as never),/Invalid localization parameters/);
  assert.throws(()=>catalogText('未注册的界面目录文案'),/Unregistered/);
});

test('interpolation preserves user text and localization reads generated keys directly', () => {
  const caption='中文回答：开始 <script> {error} $&';
  assert.ok(formatMessage('ja','voice.preview.caption',{caption}).endsWith(caption));
  try {setLanguages({uiLanguage:'en',userLanguage:'ja'});assert.equal(t('ui.startVoiceInterview'),en['ui.startVoiceInterview']);}
  finally {setLanguages({uiLanguage:'zh',userLanguage:'zh'});}
});

test('old interview headings follow interface language without modifying original content', () => {
  const record={...structuredClone(interviewFixture),type:'common' as const,topic:'all',title:'综合轮练：经历、协作与成长'};
  const original=structuredClone(record);
  try {
    for(const [locale,expected] of [['ja','総合練習：経験・協働・成長'],['en','Comprehensive practice: experience, collaboration and growth'],['zh','综合轮练：经历、协作与成长']]) {
      setLanguages({uiLanguage:locale,userLanguage:'en'});assert.equal(interviewTitle(record),expected);assert.deepEqual(record,original);
    }
    setLanguages({uiLanguage:'ja',userLanguage:'zh'});
    assert.equal(interviewTitle({...record,topic:'introduction'}),'共通面接 · 自己紹介と強み');
    assert.equal(interviewTitle(interviewFixture),'技術面接 · アーキテクチャ・BLoC・状態のモデリング');
    assert.equal(interviewTitle({...record,language:'ja',title:'综合轮练：经历、协作与成长'}),'総合練習：経験・協働・成長');
  } finally {setLanguages({uiLanguage:'zh',userLanguage:'zh'});}
});

test('every bundled card and category references an existing generated resource', () => {
  for(const category of Object.values(CARD_CATEGORIES) as {label:string}[]) assert.ok(Object.hasOwn(zh,category.label),category.label);
  for(const card of KNOWLEDGE_CARDS) {
    for(const field of ['topic','question','answer','takeaway']) {
      const key=card[field] as MessageKey;assert.ok(Object.hasOwn(zh,key),`${card.id}/${field}`);
      for(const locale of ['ja','en'] as const)assert.ok(formatMessage(locale,key).trim());
    }
    if(card.source) assert.ok(authoredMessageKey(card.source[0]) ?? Object.hasOwn(zh,card.source[0]),card.id);
  }
});

test('voice controls and dynamic activity follow interface language independently of content language', () => {
  try {for(const locale of ['ja','en'] as const){
    setLanguages({uiLanguage:locale,userLanguage:'zh'});
    const controls=createVoiceControls({api:async()=>({}),escape:(v:string)=>v,prefix:'test',language:true,tips:true,preview:true});
    const markup=controls.render();assert.ok(!markup.includes('开始通话前'));assert.ok(!markup.includes('显示回答重点'));
    const idle=voiceActivity({phase:'idle'});assert.notEqual(idle.label,'等待开始');assert.notEqual(idle.detail,'麦克风未开启。');
    const thinking=voiceActivity({phase:'connected',processing:true,processingElapsed:16});assert.match(thinking.detail,locale==='ja'?/音声を受信.*16 秒/:/Voice received.*16 seconds/);
    controls.dispose();
  }}finally{setLanguages({uiLanguage:'zh',userLanguage:'zh'});}
});

test('all API-authored labels and derived syllabus concepts are covered by resources',async()=>{
  const {TOPICS,DIFFICULTIES,REVIEW_LABEL}=await import('../src/features/algorithm/domain.ts');
  const {LANGUAGE_SYLLABUS}=await import('../src/features/language/domain.ts');
  const {INTERVIEW_TYPES,INTERVIEW_TOPICS}=await import('../src/features/interview/domain.ts');
  const {TRAINING_KINDS,DIAGNOSIS_TOPICS}=await import('../src/features/training/domain.ts');
  const {BUILTIN_POINTS,STUDY_CATEGORIES,STUDY_FACETS,Study}=await import('../src/features/study/service.ts');
  const {BREADTH_DOMAINS,BREADTH_GROUPS,BREADTH_POINTS}=await import('../src/features/study/breadth.ts');
  const {VOICE_TONES,VOICE_MODELS}=await import('../src/integrations/codex/options.ts');
  const {Store}=await import('../src/shared/persistence/store.ts');
  const labels=[REVIEW_LABEL,...Object.values(TOPICS),...Object.values(DIFFICULTIES),...Object.values(INTERVIEW_TYPES),...Object.values(INTERVIEW_TOPICS).flatMap(Object.values),...Object.values(TRAINING_KINDS),...Object.values(DIAGNOSIS_TOPICS),...Object.values(STUDY_CATEGORIES),...Object.values(STUDY_FACETS),...Object.values(BREADTH_DOMAINS),...Object.values(BREADTH_GROUPS),...Object.values(VOICE_TONES).map(t=>t.label),...VOICE_MODELS.map(m=>m.label),...Object.values(LANGUAGE_SYLLABUS).flatMap(topics=>Object.values(topics).flatMap(spec=>[spec.label,...spec.concepts])),...[...BUILTIN_POINTS,...BREADTH_POINTS].flatMap(p=>[p.title,p.topic]),new Study(new Store('/unused-i18n-fixture.json')).overview().rule];
  for(const label of labels){
    // Names composed entirely of English/code identifiers can remain identical in every locale.
    if(!/[\u3400-\u9fff]/.test(label))continue;
    const key=authoredMessageKey(label);assert.ok(key,`Missing catalog resource: ${label}`);
    for(const locale of ['ja','en'] as const)assert.ok(formatMessage(locale,key).trim());
  }
});

test('saved quiz headings follow the interface locale without changing saved titles or drafts',async()=>{
  // @ts-ignore Browser module has no TypeScript declarations.
  const {studyTitle}=await import('../public/study-title.js');
  const batch={title:'综合短测 · 3题',selection:{category:'all'},items:[{},{},{}],drafts:{one:'我的原文'}};
  const original=structuredClone(batch);
  try{setLanguages({uiLanguage:'ja',userLanguage:'zh'});assert.equal(studyTitle(batch),'総合小テスト · 3問');assert.deepEqual(batch,original);
    setLanguages({uiLanguage:'en',userLanguage:'zh'});assert.equal(studyTitle(batch),'Mixed quiz · 3 questions');
  }finally{setLanguages({uiLanguage:'zh',userLanguage:'zh'});}
});
