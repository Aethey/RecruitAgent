import { programFromConfig, generateSchema } from 'typescript-json-schema';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import openapiTS, { astToString } from 'openapi-typescript';
import { format } from 'prettier';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'src/generated');
const checking = process.argv.includes('--check');
const program = programFromConfig(resolve(root, 'tsconfig.json'), [resolve(root, 'src/contracts/api.ts')]);
// Computed initializers have no serializable default. TJS warns for each one;
// retain other diagnostics and keep generation output usable.
const warn = console.warn;
console.warn = (...args) => { if (!/^(unknown initializer|initializer is expression)/.test(String(args[0]))) warn(...args); };
let schema;
try { schema = generateSchema(program, 'ContractBundle', { required: true, aliasRefs: true, topRef: true, ignoreErrors: false, strictNullChecks: true }); }
finally { console.warn = warn; }
if (!schema) throw new Error('Could not generate ContractBundle.');
// TypeScript's imported type names contain absolute paths. Normalize them before
// emitting references so every checkout/OS produces identical, valid OpenAPI keys.
const names = new Map(Object.keys(schema.definitions).map(name => {
  const stable = name.replace(/import\("([^"\n]+)"(?:,\s*\{.*?\})?\)\./g, (_, path) => {
    const portable = path.replaceAll('\\', '/').replace(/\/+/g, '/');
    const prefix = root.replaceAll('\\', '/').replace(/\/+/g, '/') + '/';
    const relative = portable.toLowerCase().startsWith(prefix.toLowerCase()) ? portable.slice(prefix.length) : portable;
    return relative.replaceAll('/', '.') + '.';
  });
  const safe = stable.replace(/[^A-Za-z0-9._-]/g, '_');
  return [name, safe === stable ? safe : safe.slice(0, 140) + '_' + createHash('sha256').update(stable).digest('hex').slice(0, 10)];
}));
if (new Set(names.values()).size !== names.size) throw new Error('Duplicate normalized schema names.');
schema.definitions = Object.fromEntries(Object.entries(schema.definitions).map(([name, value]) => [names.get(name), value]));
function normalizeReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref?.startsWith('#/definitions/')) {
    const name = names.get(decodeURIComponent(value.$ref.slice('#/definitions/'.length)));
    if (!name) throw new Error('Unresolved contract schema reference.');
    value.$ref = '#/definitions/' + name;
  }
  for (const nested of Object.values(value)) if (typeof nested === 'object') normalizeReferences(nested);
}
normalizeReferences(schema);

const deref = node => node.$ref ? schema.definitions[decodeURIComponent(node.$ref.slice('#/definitions/'.length))] : node;
const bundle = deref(schema);
const apis = deref(bundle.properties.api).properties;
const models = deref(bundle.properties.models).properties;
const events = deref(bundle.properties.events).properties;
const validators = {};
const declarations = [];
const registry = {};
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true, esm: true }, inlineRefs: false });
ajv.addSchema(schema, 'contracts');
function validator(name, pointer, type) {
  let node = bundle.properties;
  for (const key of pointer.split('/')) node = deref(node)[key.replaceAll('~1', '/').replaceAll('~0', '~')];
  const compiledSchema = JSON.parse(JSON.stringify(node).replaceAll('#/definitions/', 'contracts#/definitions/'));
  ajv.addSchema(compiledSchema, name);
  ajv.getSchema(name);
  validators[name] = name;
  declarations.push(`export const ${name}: import('ajv').ValidateFunction<${type}>;`);
}
validator('validateState', 'state', "import('../shared/persistence/state.ts').State");
validator('validateArchive', 'archive', "import('../contracts/api.ts').BackupArchive");
for (const name of Object.keys(models)) {
  validator(`model_${name}`, `models/properties/${name}`, `import('../contracts/api.ts').ModelOutputs[${JSON.stringify(name)}]`);
}
for (const name of Object.keys(events)) {
  validator(`event_${name.replaceAll('-', '_')}`, `events/properties/${name}`, `import('../contracts/api.ts').EventPayloads[${JSON.stringify(name)}]`);
}
const native = deref(bundle.properties.native).properties;
for (const direction of ['requests', 'responses']) for (const method of Object.keys(deref(native[direction]).properties)) {
  const escaped = method.replaceAll('/', '~1');
  validator(`native_${direction}_${method.replaceAll('/', '_')}`, `native/properties/${direction}/properties/${escaped}`, `import('../integrations/codex/protocol.ts').NativeContracts[${JSON.stringify(direction)}][${JSON.stringify(method)}]`);
}
validator('native_notification', 'native/properties/notification', "import('../integrations/codex/protocol.ts').NativeNotification");
const openapi = { openapi: '3.1.0', info: { title: 'RecruitAgent', version: '1' }, paths: {}, components: { schemas: {} } };
function toOpenapi(node) {
  if (Array.isArray(node)) return node.map(toOpenapi);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === '$ref' ? value.replace('#/definitions/', '#/components/schemas/') : toOpenapi(value)]));
}
for (const [name, definition] of Object.entries(schema.definitions)) {
  if (!['ContractBundle', 'ApiEndpoints', 'ModelOutputs', 'EventPayloads'].includes(name)) openapi.components.schemas[name] = toOpenapi(definition);
}
const overloads = [];
const taskPaths = [];
for (const [index, [key, node]] of Object.entries(apis).entries()) {
  const [method, path] = key.split(' '), endpoint = deref(node);
  const pointer = `api/properties/${key.replaceAll('~', '~0').replaceAll('/', '~1')}/properties/`;
  const response = `response_${index}`, request = endpoint.properties.body ? `request_${index}` : undefined;
  validator(response, pointer + 'response', `import('../contracts/api.ts').ApiEndpoints[${JSON.stringify(key)}]['response']`);
  if (request) validator(request, pointer + 'body', `import('../contracts/api.ts').ApiEndpoints[${JSON.stringify(key)}]['body']`);
  registry[key] = { method, path, response, ...(request ? { request } : {}) };
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  const operation = { operationId: `operation_${index}`, ...(parameters.length ? { parameters } : {}), responses: {
    '2XX': { description: 'Success', content: { 'application/json': { schema: toOpenapi(endpoint.properties.response) } } },
    default: { description: 'Error', content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } } } } },
  } };
  if (request) operation.requestBody = { required: true, content: { 'application/json': { schema: toOpenapi(endpoint.properties.body) } } };
  (openapi.paths[path] ??= {})[method.toLowerCase()] = operation;
  const literal = path.includes('{') ? '`' + path.replace(/\{[^}]+\}/g, '${string}') + '`' : JSON.stringify(path);
  const query = '`' + path.replace(/\{[^}]+\}/g, '${string}') + '?${string}`';
  const op = `operations['operation_${index}']`;
  overloads.push(`(path: ${literal} | ${query}, method${method === 'GET' ? '?' : ''}: ${JSON.stringify(method)}${request ? `, body: ${op}['requestBody']['content']['application/json']` : ''}): Promise<${op}['responses']['2XX']['content']['application/json']>;`);
  if (method === 'POST' && deref(endpoint.properties.response).properties?.jobId) taskPaths.push(literal);
}
const header = '// Generated by npm run generate. Do not edit.\n';
const modelSchemas = {};
for (const [kind, node] of Object.entries(models)) {
  const definitions = {};
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = decodeURIComponent(value.$ref.slice('#/definitions/'.length));
      if (!Object.hasOwn(definitions, name)) { definitions[name] = schema.definitions[name]; collect(definitions[name]); }
    }
    for (const nested of Object.values(value)) if (typeof nested === 'object') collect(nested);
  }
  collect(node);
  modelSchemas[kind] = { ...node, ...(Object.keys(definitions).length ? { definitions } : {}) };
}
const files = {
  'contracts.schema.json': JSON.stringify(schema, null, 2) + '\n',
  'api.openapi.json': JSON.stringify(openapi, null, 2) + '\n',
  'api.d.ts': header + astToString(await openapiTS(openapi)),
  'api-client.d.ts': header + "import type { operations } from './api.js';\nexport interface ApiClient {\n" + overloads.join('\n') + '\n}\nexport type TaskPath = ' + taskPaths.join(' | ') + ';\n',
  'validators.mjs': header + await format(standaloneCode(ajv, validators), { parser: 'babel', singleQuote: true }),
  'validators.d.mts': header + declarations.join('\n') + '\n',
  'registry.mjs': header + `export const routes = ${JSON.stringify(registry, null, 2)};\nexport const modelNames = ${JSON.stringify(Object.keys(models))};\nexport const eventNames = ${JSON.stringify(Object.keys(events))};\n`,
  'registry.d.mts': header + "export const routes: Record<string, {method: string; path: string; response: string; request?: string}>;\nexport const modelNames: (keyof import('../contracts/api.ts').ModelOutputs)[];\nexport const eventNames: (keyof import('../contracts/api.ts').EventPayloads)[];\n",
  'model-schemas.mjs': header + `export const schemas = ${JSON.stringify(modelSchemas, null, 2)};\n`,
  'model-schemas.d.mts': header + "export const schemas: Record<keyof import('../contracts/api.ts').ModelOutputs, object>;\n",
  'wire-validators.mjs': header + `export { ${Object.keys(validators).filter(name => /^(request_|response_|event_)/.test(name)).join(', ')} } from './validators.mjs';\n`,
  'wire-validators.d.mts': header + `export { ${Object.keys(validators).filter(name => /^(request_|response_|event_)/.test(name)).join(', ')} } from './validators.mjs';\n`,
};
if (!checking) await mkdir(output, { recursive: true });
const stale = [];
for (const [name, content] of Object.entries(files)) {
  const path = resolve(output, name);
  if (checking) { if (await readFile(path, 'utf8').catch(() => '') !== content) stale.push(name); }
  else await writeFile(path, content);
}
if (stale.length) throw new Error(`Generated contracts are stale: ${stale.join(', ')}. Run npm run generate.`);
console.log(`Contracts ${checking ? 'verified' : 'generated'}: ${Object.keys(apis).length} JSON endpoints, ${Object.keys(models).length} model outputs, ${Object.keys(events).length} events, state and backup.`);
