import { readFile, writeFile, readdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { mapSource, mapTemplate, placeholders } from '../src/ui-source.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const localePath = locale => join(root, 'public/locales', `${locale}.json`);
const han = /[\u3400-\u9fff]/u;
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const [command, ...args] = process.argv.slice(2);
function option(name) { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; }

async function sources() {
  const messages = await json(join(root, 'src/ui-message-defaults.json'));
  const raw = [];
  const add = (source, markup = source.includes('<') || source.includes('>')) => mapSource(source, markup, text => {
    if (han.test(text)) messages[text] = text;
    return text;
  });
  for (const file of (await readdir(join(root, 'public'))).filter(file => /\.(js|ts)$/.test(file) && !['theme.js', 'i18n.js'].includes(file))) {
    const source = await readFile(join(root, 'public', file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node, localized = file === 'voice-activity.js' || file === 'knowledge-cards.js' || file === 'api.ts') {
      const call = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t','translateError'].includes(node.expression.text);
      const template = ts.isTaggedTemplateExpression(node) && node.tag.getText(ast) === 'ui';
      if (template) {
        const parts = ts.isTemplateExpression(node.template) ? [node.template.head.text, ...node.template.templateSpans.map(span => span.literal.text)] : [node.template.text];
        mapTemplate(parts, Array(parts.length - 1).fill(''), text => { add(text, false); return text; });
        if (ts.isTemplateExpression(node.template)) for (const span of node.template.templateSpans) visit(span.expression, localized);
        return;
      }
      const scoped = localized || call || template;
      if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && han.test(node.text)) {
        // Object keys are protocol identifiers, never interface copy.
        if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
        add(node.text);
        if (!scoped) raw.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`);
      }
      ts.forEachChild(node, child => visit(child, scoped));
    }
    visit(ast);
  }
  add(await readFile(join(root, 'public/index.html'), 'utf8'), true);
  // Authored labels/catalogs returned by the API, plus application errors and SSE notices.
  for (const file of (await readdir(join(root, 'src'))).filter(file => file.endsWith('.ts'))) {
    const source = await readFile(join(root, 'src', file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node, scoped = false) {
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'instruction') return; // Model instructions are not UI.
      const explicit = ts.isCallExpression(node) && ['message','translateSource'].includes(node.expression.getText(ast));
      const catalog = ts.isVariableDeclaration(node) && /^(TOPICS|DIFFICULTIES|REVIEW_LABEL|LANGUAGE_SYLLABUS|INTERVIEW_TYPES|INTERVIEW_TOPICS|DIAGNOSIS_TOPICS|LIBRARY_\w+|TRAINING_\w+|STUDY_\w+|BUILTIN_POINTS|BREADTH_\w+|catalog|algorithmConcepts|VOICE_TONES|VOICE_MODELS)$/.test(node.name.getText(ast));
      const error = ts.isNewExpression(node) && ['AppError', 'Error'].includes(node.expression.getText(ast));
      const notice = ts.isPropertyAssignment(node) && node.name.getText(ast) === 'message';
      const localize = scoped || catalog || error || notice || explicit;
      if (localize && (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && han.test(node.text)) add(node.text, false);
      ts.forEachChild(node, child => visit(child, localize));
    }
    visit(ast);
  }
  return { messages: Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a.localeCompare(b, 'en'))), raw: [...new Set(raw)] };
}

export function validateTranslations(source, translated, locale) {
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) throw new Error('Translation output must be an object.');
  for (const [key, value] of Object.entries(source)) {
    const target = translated[key];
    if (typeof target !== 'string' || !target.trim()) throw new Error(`${locale}: missing translation for ${key}`);
    if (!equal(placeholders(value), placeholders(target))) throw new Error(`${locale}: placeholder mismatch for ${key}`);
    if (locale === 'en' && han.test(target)) throw new Error(`en: untranslated text for ${key}`);
    if (locale === 'ja' && value.replace(/\{[a-zA-Z][\w]*\}/g, '').length > 8 && han.test(value) && target === value) throw new Error(`ja: source copied for ${key}`);
  }
  const extra = Object.keys(translated).filter(key => !Object.hasOwn(source, key));
  if (extra.length) throw new Error(`Unexpected translation keys: ${extra.join(', ')}`);
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await writeFile(temporary, serialize(value)); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

async function generate(batch, locale, directory) {
  const input = Object.entries(batch).map(([key, source], id) => ({ id, key, source }));
  const schemaPath = join(directory, 'schema.json'), output = join(directory, 'output.json');
  await writeFile(schemaPath, serialize({type:'object',additionalProperties:false,properties:{translations:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'integer'},text:{type:'string'}},required:['id','text']}}},required:['translations']}));
  await rm(output,{force:true});
  const prompt = `Translate every authored RecruitAgent interface message into ${locale === 'ja' ? 'natural Japanese' : 'natural English'}. Return translations for ALL IDs exactly once. Keep {namedPlaceholders}, product names, code examples, URLs, units, symbols and newlines. Use concise, consistent UI language. These are interface fragments or static educational cards, never user documents. A fragment may continue before/after a variable: translate that fragment only. Do not copy Chinese text or add Chinese explanations. Japanese technical terms may use kanji. Do not use tools or access files; the complete input follows.\n${serialize(input)}`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.I18N_CODEX_BIN || join(root,'node_modules/.bin/codex'), ['exec',...(option('--model') ? ['--model',option('--model')] : []),'--ephemeral','--sandbox','read-only','--skip-git-repo-check','--output-schema',schemaPath,'--output-last-message',output,'-'], {cwd:directory,stdio:['pipe','ignore','pipe']});
    let error = ''; const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Translation timed out after 10 minutes.')); }, 600000);
    child.stderr.on('data', data => { error = (error + data.toString()).slice(-2500); });
    child.on('error', failure => { clearTimeout(timer); reject(failure); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Codex translation failed (${code}): ${error}`)); });
    child.stdin.end(prompt);
  });
  const result = await json(output), values = {};
  if (!Array.isArray(result.translations)) throw new Error('Invalid Codex translation output.');
  for (const {id,text} of result.translations) {
    const entry = input[id];
    if (!Number.isSafeInteger(id) || !entry || Object.hasOwn(values, entry.key)) throw new Error('Unexpected or repeated translation ID.');
    values[entry.key] = text;
  }
  validateTranslations(batch, values, locale);
  return values;
}

export async function run() {
  const {messages, raw} = await sources();
  if (raw.length) throw new Error(`UI copy bypasses t/ui: ${raw.join(', ')}`);
  if (command === 'extract') {
    await atomicWrite(localePath('zh'), messages);
    console.log(`Extracted ${Object.keys(messages).length} authored messages into public/locales/zh.json.`);
  } else if (command === 'check') {
    const saved = await json(localePath('zh'));
    if (!equal(saved, messages)) throw new Error('Source catalog is stale. Run npm run i18n:extract.');
    for (const locale of ['ja', 'en']) {
      const dictionary = await json(localePath(locale));
      // Unused legacy translations stay available during the gradual migration to stable keys.
      validateTranslations(messages, Object.fromEntries(Object.keys(messages).map(key => [key, dictionary[key]])), locale);
    }
    console.log(`i18n OK: ${Object.keys(messages).length} messages, zh/ja/en, placeholders and UI call sites.`);
  } else if (command === 'translate') {
    const locale = option('--locale');
    if (!['ja','en'].includes(locale)) throw new Error('Usage: npm run i18n:translate -- --locale ja|en [--dry-run] [--input validated-output.json]');
    const current = await json(localePath(locale));
    const pending = Object.fromEntries(Object.entries(messages).filter(([key]) => !Object.hasOwn(current, key)));
    console.log(`${locale}: ${Object.keys(pending).length} missing messages; existing translations are preserved.`);
    if (args.includes('--dry-run') || !Object.keys(pending).length) return;
    const directory = await mkdtemp(join(tmpdir(),'recruitagent-i18n-'));
    try {
      if (option('--input')) {
        const input = await json(option('--input')); validateTranslations(pending, input, locale);
        Object.assign(current, input);
      } else {
        const entries = Object.entries(pending), batchSize = Number(option('--batch-size') ?? 120);
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new Error('Batch size must be 1–200.');
        for (let index = 0; index < entries.length; index += batchSize) {
          const batch = Object.fromEntries(entries.slice(index, index + batchSize));
          const result = await generate(batch, locale, directory);
          // Re-read before each merge to preserve translations written during a long generation run.
          const fresh = await sources();
          if (!equal(messages,fresh.messages)) throw new Error('Source changed during translation. Rerun extraction.');
          const latest = await json(localePath(locale));
          for (const [key,value] of Object.entries(result)) if (!Object.hasOwn(latest,key)) latest[key] = value;
          await atomicWrite(localePath(locale),latest); Object.assign(current,latest);
          console.log(`${locale}: ${Math.min(index+batchSize,entries.length)}/${entries.length} generated and validated.`);
        }
      }
      const fresh = await sources();
      if (!equal(messages,fresh.messages)) throw new Error('Source changed during translation. Rerun extraction and translation.');
      if (option('--input')) {
        const latest = await json(localePath(locale));
        for (const key of Object.keys(pending)) if (!Object.hasOwn(latest,key)) latest[key] = current[key];
        await atomicWrite(localePath(locale),latest);
      }
    } finally { await rm(directory,{recursive:true,force:true}); }
  } else throw new Error('Expected extract, translate or check.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(error => { console.error(error.message); process.exitCode = 1; });
