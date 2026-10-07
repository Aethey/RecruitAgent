import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app/http.ts";
import { Store } from "../src/shared/persistence/store.ts";
import { FakeAI, sampleProblem, fakeInterviewSources, fakeJobReader } from "./fixtures.ts";
import { DEFAULT_TEACHER_SETTINGS } from '../src/features/chat/settings.ts';
import { LANGUAGES, type Language } from '../src/shared/programming.ts';
import { LANGUAGE_SYLLABUS, languageFocus, type LanguageDrill } from "../src/features/language/domain.ts";
import { interviewContent, interviewReviewContent } from "../src/features/interview/domain.ts";
import { extractJobHtml, importJob, jobUrl, publicIPv4 } from "../src/features/interview/job-import.ts";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dataDir = await mkdtemp(join(tmpdir(), "algo-test-"));
  const ai = new FakeAI(), app = await createApp({ dataDir, ai, interviewSources: fakeInterviewSources, jobReader: fakeJobReader,sourceDir:null });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, { method, headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }
  async function complete(path: string, data: unknown) {
    const response = await request(path, "POST", data);
    assert.equal(response.status, 202);
    const job = app.tasks.get(response.data.jobId);
    await job.promise;
    assert.equal(job.status, "done", job.error ?? "Task should succeed");
    return job;
  }
  async function generate() { const job = await complete("/api/problems", { topic: "array", difficulty: "easy", language: "javascript" }); return (job.result as { problemId: string }).problemId; }
  return { ai, app, request, complete, generate, base, dataDir };
}

test("Monaco bundles and workers are served locally without exposing other files", async t => {
  const { base } = await setup(t);
  const page = await fetch(base);
  const html = await page.text();
  assert(html.includes('/assets/app.js'));
  assert(html.indexOf('/assets/theme-init.js')<html.indexOf('/style.css'));
  assert(html.includes('/assets/app.css'));
  const policy = page.headers.get("content-security-policy")!;
  assert(policy.includes("worker-src 'self'"));
  assert(policy.includes("script-src 'self' 'wasm-unsafe-eval';"));
  assert(!policy.includes("'unsafe-eval'"));
  const files = await readdir(new URL("../public/assets/", import.meta.url));
  const chunk = files.find(file => /^chunk-.*\.js$/.test(file));
  const font = files.find(file => file.endsWith(".ttf"));
  assert(chunk && font);
  for (const [file, mime] of [
    ["app.js", "text/javascript"], ["theme-init.js", "text/javascript"], ["app.css", "text/css"],
    ["editor.worker.js", "text/javascript"], ["ts.worker.js", "text/javascript"],
    [chunk, "text/javascript"], [font, "font/ttf"], ["monaco-LICENSE.txt", "text/plain"],
    ["pdfjs-LICENSE.txt", "text/plain"], ["marked-LICENSE.txt", "text/plain"], ["dompurify-LICENSE.txt", "text/plain"],
  ]) {
    const response = await fetch(`${base}/assets/${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get("content-type"), mime);
    assert((await response.arrayBuffer()).byteLength > 0);
  }
  for (const path of ["/assets/missing.js", "/assets/data/auth.json", "/assets/..%2fauth.json", "/data/auth.json", "/node_modules/monaco-editor/package.json"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test("language batches, reference reveal, draft history and model selection are independent of algorithm records", async t => {
  const { ai, app, request, complete, dataDir } = await setup(t);
  await request("/api/model", "PUT", { model: "test-small" });
  const config = (await request("/api/config")).data;
  assert.equal(config.languages.go, "Go");
  for (const language of Object.keys(LANGUAGES)) {
    assert(Object.keys(config.languageSyllabus[language]).length >= 10);
    const job = await complete("/api/language-drills", { language, topic: "foundation" });
    const id = (job.result as { drillId: string }).drillId;
    const drill = (await request(`/api/language-drills/${id}`)).data;
    assert.equal(drill.language, language);
    assert.equal(drill.selectionTopic, "foundation");
    assert(drill.exercises.length > 1, "basics should support more than one exercise per batch");
    assert(drill.templateCode && drill.exercises.every((e: { explanation: string; benefits: string[] }) => e.explanation && e.benefits.length));
    assert.equal(drill.revealedAt, undefined);
    assert.equal(ai.requestedModes.at(-1), "language");
    assert.equal(ai.requestedModels.at(-1), "test-small");
    const code = `${drill.starterCode}\n// my newer draft`;
    assert.equal((await request(`/api/language-drills/${id}`, "PUT", { code })).status, 200);
    const calls = ai.prompts.length;
    const reveal = await request(`/api/language-drills/${id}/reveal`, "POST", {});
    assert.equal(reveal.status, 200);
    assert.equal((await request(`/api/language-drills/${id}/reveal`, "POST", {})).data.revealedAt, reveal.data.revealedAt);
    assert.equal(ai.prompts.length, calls, "revealing a prepared template must not use another AI request");
    assert.equal((await request(`/api/language-drills/${id}`)).data.code, code);
  }
  const state = (await request("/api/state")).data;
  assert.equal(state.problems.length, 0);
  assert.equal(state.stats.total, 0);
  assert.equal(state.languageDrills.length, Object.keys(LANGUAGES).length);
  assert.equal((await request("/api/analysis", "POST", {})).status, 400);
  await app.store.flush();
  const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(restored.snapshot().languageDrills!.length, state.languageDrills.length);
  assert.equal(restored.languageDrill(state.languageDrills[0].id).templateCode, state.languageDrills[0].templateCode);
  assert(restored.languageDrill(state.languageDrills[0].id).revealedAt);
});

test("automatic language rotation eventually covers every catalog concept for each language", () => {
  for (const language of Object.keys(LANGUAGES) as Language[]) {
    const drills: LanguageDrill[] = [];
    const catalog = Object.entries(LANGUAGE_SYLLABUS[language]);
    const total = catalog.reduce((n, [, spec]) => n + spec.concepts.length, 0);
    for (let i = 0; i < total; i++) {
      const focus = languageFocus({ language, topic: "auto" }, drills);
      drills.push({ language, topic: focus.topic, concepts: focus.concepts, id: String(i), createdAt: "", updatedAt: "", code: "", title: "", introduction: "", starterCode: "", templateCode: "", requirements: [], exercises: [] });
    }
    for (const [id, spec] of catalog) {
      const covered = new Set(drills.filter(d => d.topic === id).flatMap(d => d.concepts));
      assert.deepEqual([...covered].sort(), [...spec.concepts].sort(), `${language}/${id}`);
    }
  }
});

test("saved automatic practice keeps rotation when continuing from its record", async t => {
  const { app, complete, dataDir } = await setup(t);
  const first = await complete("/api/language-drills", { language: "dart", topic: "auto" });
  const drill = app.store.languageDrill((first.result as { drillId: string }).drillId);
  await app.store.flush();
  const restored = new Store(join(dataDir, "state.json")); await restored.load();
  const saved = restored.languageDrill(drill.id);
  assert.equal(saved.selectionTopic, "auto");
  const next = await complete("/api/language-drills", { language: saved.language, topic: saved.selectionTopic });
  const nextDrill = app.store.languageDrill((next.result as { drillId: string }).drillId);
  assert.notEqual(nextDrill.topic, saved.topic, "completed foundation should advance to another module");
});

test("language validation rejects missing concepts and incomplete templates without writing partial records", async t => {
  const { ai, app, request } = await setup(t);
  for (const input of [{ language: "unknown", topic: "auto" }, { language: "dart", topic: "no-topic" }]) {
    assert.equal((await request("/api/language-drills", "POST", input)).status, 400);
  }
  assert.equal((await request("/api/language-drills/missing/reveal", "POST", {})).status, 404);
  const original = ai.ask.bind(ai);
  for (const fault of ["concept", "template"]) {
    ai.ask = async (...args: Parameters<typeof original>) => {
      const content = JSON.parse(await original(...args));
      if (fault === "concept") content.exercises.pop(); else content.templateCode = "";
      return JSON.stringify(content);
    };
    const response = await request("/api/language-drills", "POST", { language: "dart", topic: "foundation" });
    const job = app.tasks.get(response.data.jobId); await job.promise;
    assert.equal(job.status, "error");
    assert.equal(app.store.snapshot().languageDrills?.length ?? 0, 0);
  }
});

test("language generation shares task cancellation and concurrency protection with algorithm work", async t => {
  const { ai, app, request } = await setup(t); ai.mode = "block";
  const response = await request("/api/language-drills", "POST", { language: "go", topic: "async" });
  assert.equal(response.status, 202);
  assert.equal((await request("/api/problems", "POST", { language: "go", topic: "array", difficulty: "easy" })).status, 409);
  assert.equal((await request("/api/model", "PUT", { model: "test-small" })).status, 409);
  await request(`/api/jobs/${response.data.jobId}/abort`, "POST", {});
  assert.equal(app.tasks.get(response.data.jobId).status, "aborted");
  assert.equal(app.store.snapshot().languageDrills?.length ?? 0, 0);
});

test("generation, saved drafts, code-specific hints, reviews, history and analysis persist", async t => {
  const { ai, app, request, complete, generate, dataDir } = await setup(t);
  const id = await generate();
  const code = "function longestIncreasingRun(nums) { let current = 1; return current; }";
  assert.equal((await request(`/api/problems/${id}`, "PUT", { code })).status, 200);
  await complete(`/api/problems/${id}/hint`, { code });
  assert(ai.prompts.at(-1)!.includes(JSON.stringify(code)), "tips must use the submitted code snapshot");
  assert(ai.prompts.at(-1)!.includes("禁止完整答案"));
  await complete(`/api/problems/${id}/review`, { code });
  await complete(`/api/problems/${id}/review`, { code: code + "\n// second submission" });
  const before = (await request("/api/state")).data;
  assert.equal(before.stats.reviewed, 1, "repeated submissions must not inflate sample count");
  assert.equal(before.problems[0].reviews.length, 2);
  assert.equal(before.problems[0].reviews[0].code, code);
  assert.equal(before.problems[0].hints.length, 1);
  await complete("/api/analysis", {});
  const analyzed = (await request("/api/state")).data;
  assert.equal(analyzed.analysisStale, false);
  assert.equal(analyzed.stats.topics.find((x: { id: string }) => x.id === "tree").score, null);
  await complete(`/api/problems/${id}/review`, { code: code + "\n// third submission" });
  assert.equal((await request("/api/state")).data.analysisStale, true);
  await app.store.flush();
  const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(restored.problem(id).code, code);
  assert.equal(restored.problem(id).reviews.length, 3);
  assert.equal(restored.problem(id).title, sampleProblem.title);
});

test("Dart and Swift flow through generation, code-based hints, review and saved history", async t => {
  const { ai, app, request, complete, dataDir } = await setup(t);
  const config = (await request("/api/config")).data;
  for (const language of ["dart", "swift"]) {
    const label = language === "dart" ? "Dart" : "Swift";
    assert.equal(config.languages[language], label);
    const job = await complete("/api/problems", { topic: "array", difficulty: "easy", language });
    assert(ai.prompts.at(-1)!.includes(`语言=${label}`));
    const id = (job.result as { problemId: string }).problemId;
    const problem = (await request(`/api/problems/${id}`)).data;
    assert.equal(problem.language, language);
    assert(problem.starterCode.includes(language === "dart" ? "List<int>" : "[Int]"));
    const code = language === "dart" ? "int longestIncreasingRun(List<int> nums) { return 0; }"
      : "func longestIncreasingRun(_ nums: [Int]) -> Int { return 0 }";
    await request(`/api/problems/${id}`, "PUT", { code });
    for (const action of ["hint", "review"]) {
      await complete(`/api/problems/${id}/${action}`, { code });
      assert(ai.prompts.at(-1)!.includes(`\"language\":\"${label}\"`));
      assert(ai.prompts.at(-1)!.includes(JSON.stringify(code)));
    }
  }
  await app.store.flush();
  const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.deepEqual(restored.snapshot().problems.map(p => p.language), ["dart", "swift"]);
});

test("model visibility persists across model changes and restart without changing practice records", async t => {
  const { ai, app, request, generate, dataDir } = await setup(t);
  assert.deepEqual((await request('/api/settings')).data, { model: 'test-model', visibleModels: ['test-model', 'test-small'], teacher: DEFAULT_TEACHER_SETTINGS, uiLanguage: 'zh', userLanguage: 'zh' });
  await generate();
  const problems = app.store.snapshot().problems, calls = ai.prompts.length;
  assert.equal((await request('/api/settings', 'PUT', { visibleModels: ['test-model'] })).status, 200);
  assert.equal((await request('/api/model', 'PUT', { model: 'test-small' })).status, 400);
  assert.equal(ai.model, 'test-model');
  assert.equal((await request('/api/config')).data.models.length, 2, 'settings must retain the full available catalog');
  await request('/api/settings', 'PUT', { visibleModels: ['test-model', 'test-small'] });
  await request('/api/model', 'PUT', { model: 'test-small' });
  assert.deepEqual(app.store.snapshot().settings, { model: 'test-small', visibleModels: ['test-model', 'test-small'] });
  await request('/api/settings', 'PUT', { visibleModels: ['test-small'] });
  assert.deepEqual(app.store.snapshot().problems, problems);
  assert.equal(ai.prompts.length, calls, 'visibility settings should never call the model');
  const restartedAI = new FakeAI(), restored = await createApp({ dataDir, ai: restartedAI, sourceDir: null });
  await new Promise<void>(resolve => restored.server.listen(0, '127.0.0.1', resolve));
  t.after(() => restored.close());
  const address = restored.server.address(); assert(address && typeof address !== 'string');
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${address.port}/api/settings`)).json(), { model: 'test-small', visibleModels: ['test-small'], teacher: DEFAULT_TEACHER_SETTINGS, uiLanguage: 'zh', userLanguage: 'zh' });
  assert.equal(restartedAI.model, 'test-small');
});

test("invalid visibility cannot hide the active model or change saved settings", async t => {
  const { app, request } = await setup(t);
  await request('/api/settings', 'PUT', { visibleModels: ['test-model'] });
  const before = app.store.snapshot();
  for (const visibleModels of [[], ['test-small'], ['unknown'], ['test-model', 'test-model'], [1], null, 'test-model']) {
    assert.equal((await request('/api/settings', 'PUT', { visibleModels })).status, 400);
    assert.deepEqual(app.store.snapshot(), before);
  }
  // A saved model removed from the provider catalog must not leave an empty picker.
  await app.store.update(state => { state.settings = { model: 'retired', visibleModels: ['retired'] }; });
  assert.deepEqual((await request('/api/settings')).data, { model: 'test-model', visibleModels: ['test-model'], teacher: DEFAULT_TEACHER_SETTINGS, uiLanguage: 'zh', userLanguage: 'zh' });
  assert.deepEqual(app.store.snapshot().settings, { model: 'retired', visibleModels: ['retired'] }, 'reading normalizes without overwriting saved settings');
});

test("teacher analysis preferences persist independently of model settings and learning records across restart", async t => {
  const { ai, app, request, dataDir, generate } = await setup(t);
  const defaults = { trigger: 'idle', idleSeconds: 20 };
  assert.deepEqual((await request('/api/settings')).data.teacher, defaults);
  assert.equal(app.store.snapshot().settings, undefined, 'reading defaults does not rewrite existing data');
  await generate(); const problems = app.store.snapshot().problems, calls = ai.prompts.length;
  const teacher = { trigger: 'manual', idleSeconds: 45 };
  assert.equal((await request('/api/settings', 'PUT', { teacher })).status, 200);
  await request('/api/settings', 'PUT', { visibleModels: ['test-model', 'test-small'] });
  await request('/api/model', 'PUT', { model: 'test-small' });
  assert.deepEqual((await request('/api/settings')).data, { model: 'test-small', visibleModels: ['test-model', 'test-small'], teacher, uiLanguage: 'zh', userLanguage: 'zh' });
  assert.deepEqual(app.store.snapshot().problems, problems); assert.equal(ai.prompts.length, calls);
  const restored = await createApp({ dataDir, ai: new FakeAI(), sourceDir: null }); t.after(() => restored.close());
  await new Promise<void>(resolve => restored.server.listen(0, '127.0.0.1', resolve));
  const address = restored.server.address(); assert(address && typeof address !== 'string');
  assert.deepEqual((await fetch(`http://127.0.0.1:${address.port}/api/settings`).then(r => r.json())).teacher, teacher);
  const before = app.store.snapshot();
  for (const invalid of [null, {}, { trigger: 'unknown', idleSeconds: 20 }, ...[0, -1, 3601, 1.5, '20', null].map(idleSeconds => ({ trigger: 'idle', idleSeconds }))]) {
    assert.equal((await request('/api/settings', 'PUT', { visibleModels: ['test-small'], teacher: invalid })).status, 400);
    assert.deepEqual(app.store.snapshot(), before, 'invalid teacher settings must not partially save model changes');
  }
});

test("model selection applies to every AI operation and survives a backend restart", async t => {
  const { ai, app, request, complete, generate, dataDir } = await setup(t);
  assert.deepEqual((await request("/api/config")).data.models.map((m: { id: string }) => m.id), ["test-model", "test-small"]);
  assert.equal((await request("/api/model", "PUT", { model: "unknown-model" })).status, 400);
  assert.equal(ai.model, "test-model");
  assert.equal((await request("/api/model", "PUT", { model: "test-small" })).data.model, "test-small");
  const id = await generate();
  const code = "function longestIncreasingRun(nums) { return 0; }";
  await complete(`/api/problems/${id}/hint`, { code });
  await complete(`/api/problems/${id}/review`, { code });
  await complete("/api/analysis", {});
  assert.deepEqual(ai.requestedModels, Array(4).fill("test-small"));
  await app.store.flush();
  const restartedAI = new FakeAI(), restoredApp = await createApp({ dataDir, ai: restartedAI });
  assert.equal(restartedAI.model, "test-small");
  assert.equal(restoredApp.store.problem(id).reviews.length, 1);
  await new Promise<void>(resolve => restoredApp.server.listen(0, "127.0.0.1", resolve));
  await restoredApp.close();
  ai.mode = "block";
  const blocked = await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "dart" });
  assert.equal((await request("/api/model", "PUT", { model: "test-model" })).status, 409);
  assert.equal(ai.model, "test-small");
  await request(`/api/jobs/${blocked.data.jobId}/abort`, "POST", {});
  assert.equal((await request("/api/model", "PUT", { model: "test-model" })).status, 200);
});

test("a newer auto-saved draft is not overwritten when an older review completes", async t => {
  const { ai, app, request, generate } = await setup(t);
  const id = await generate(); ai.delay = 70;
  const submitted = "function solution() { return 1; }", newer = "function solution() { return 2; }";
  const response = await request(`/api/problems/${id}/review`, "POST", { code: submitted });
  await request(`/api/problems/${id}`, "PUT", { code: newer });
  await app.tasks.get(response.data.jobId).promise;
  const problem = (await request(`/api/problems/${id}`)).data;
  assert.equal(problem.code, newer); assert.equal(problem.reviews[0].code, submitted);
});

test("one active task, abort cleans up, and a new task can start afterwards", async t => {
  const { ai, app, request, generate } = await setup(t);
  ai.mode = "block";
  const first = await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "javascript" });
  assert.equal(first.status, 202);
  assert.equal((await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "javascript" })).status, 409);
  assert.equal((await request(`/api/jobs/${first.data.jobId}/abort`, "POST", {})).status, 200);
  assert.equal(app.tasks.get(first.data.jobId).status, "aborted");
  assert.equal(app.store.snapshot().problems.length, 0);
  ai.mode = "normal"; await generate(); assert.equal(app.store.snapshot().problems.length, 1);
});

test("invalid model output never creates a partial problem", async t => {
  const { ai, app, request } = await setup(t); ai.mode = "malformed";
  const response = await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "javascript" });
  const job = app.tasks.get(response.data.jobId); await job.promise;
  assert.equal(job.status, "error"); assert.equal(app.store.snapshot().problems.length, 0);
});

test("OAuth uses browser interactions and never sends credentials through SSE", async t => {
  const { ai, app, request, base } = await setup(t); ai.authenticated = false;
  assert.equal((await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "javascript" })).status, 401);
  const login = await request("/api/auth/login", "POST", {});
  assert.equal(login.status, 202);
  const channel = app.auth.get(login.data.id);
  const controller = new AbortController();
  const response = await fetch(`${base}/api/auth/${login.data.id}/events`, { signal: controller.signal });
  const reader = response.body!.getReader(); const decoder = new TextDecoder();
  let events = "";
  while (!events.includes("event: prompt\n")) { const part = await reader.read(); assert(!part.done); events += decoder.decode(part.value); }
  assert(events.includes("event: auth_url")); assert(!events.includes("access")); assert(!events.includes("refresh"));
  assert(channel.answer);
  await request(`/api/auth/${login.data.id}/answer`, "POST", { promptId: channel.answer.id, value: "test-callback" });
  await channel.promise;
  while (!events.includes("event: done\n")) { const part = await reader.read(); assert(!part.done); events += decoder.decode(part.value); }
  controller.abort(); await reader.cancel().catch(() => {});
  assert.equal((await request("/api/auth/status")).data.authenticated, true);
  assert(!events.includes("PRIVATE_CREDENTIAL"));
});

test("OAuth cancellation rejects pending prompts and permits retry", async t => {
  const { app, request } = await setup(t);
  const first = await request("/api/auth/login", "POST", {});
  await request("/api/auth/cancel", "POST", {});
  assert.equal(app.auth.get(first.data.id).status, "cancelled");
  const next = await request("/api/auth/login", "POST", {});
  assert.notEqual(next.data.id, first.data.id);
});

test("SSE replays completion when subscribed after the task ended", async t => {
  const { complete, base } = await setup(t);
  const job = await complete("/api/problems", { topic: "array", difficulty: "easy", language: "javascript" });
  const controller = new AbortController();
  const response = await fetch(`${base}/api/jobs/${job.id}/events`, { signal: controller.signal });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader(); let result = "";
  while (!result.includes("event: done\n")) { const part = await reader.read(); assert(!part.done); result += new TextDecoder().decode(part.value); }
  controller.abort(); await reader.cancel().catch(() => {}); assert(result.includes("problemId"));
});

test("rejects invalid input, unimplemented answers, and analysis without evidence", async t => {
  const { request, generate } = await setup(t);
  assert.equal((await request("/api/problems", "POST", { topic: "__proto__", difficulty: "easy", language: "javascript" })).status, 400);
  assert.equal((await request("/api/analysis", "POST", {})).status, 400);
  assert.equal((await request("/api/problems/missing", "PUT", { code: "abc" })).status, 404);
  const id = await generate();
  assert.equal((await request(`/api/problems/${id}/review`, "POST", { code: sampleProblem.starterCode })).status, 400);
});

test("credentials and filesystem paths are not served and cross-site requests are rejected", async t => {
  const { request, base } = await setup(t);
  assert.equal((await request("/data/auth.json")).status, 404);
  assert.equal((await request("/api/state", "GET", undefined, { Origin: "https://evil.example" })).status, 403);
  const response = await fetch(base + "/api/problems", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } });
  assert.equal(response.status, 415);
});

test("provider error details never reach browser-visible jobs", async t => {
  const { ai, app, request } = await setup(t); ai.mode = "error";
  const response = await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "javascript" });
  await app.tasks.get(response.data.jobId).promise;
  const result = await request(`/api/jobs/${response.data.jobId}`);
  assert(!JSON.stringify(result).includes("PRIVATE_CREDENTIAL"));
});

test("corrupt history is reported without overwriting the user's file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "algo-corrupt-"));
  try {
    const { writeFile } = await import("node:fs/promises"); const path = join(dir, "state.json");
    await writeFile(path, "{broken");
    await assert.rejects(() => new Store(path).load(), /原文件未覆盖/);
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("three interview modes use selected model, evidence sources and independent history", async t => {
  const { request, complete, ai, app, dataDir } = await setup(t);
  await request("/api/model", "PUT", { model: "test-small" });
  const imported = await request("/api/interview-jobs", "POST", { title: "测试公司 Mobile Engineer", urls: ["https://example.com/jd", "https://example.com/team"], description: "必须 Kotlin，移动端架构与质量改善。" });
  assert.equal(imported.status, 201); assert.equal(imported.data.sources.length, 3);
  assert.equal(ai.prompts.length, 0, "importing JD must not use AI");
  for (const type of ["common", "technical", "position"]) {
    const job = await complete("/api/interviews", { type, topic: "all", count: 3, ...(type === "position" ? { jobId: imported.data.id } : {}) });
    const id = (job.result as { interviewId: string }).interviewId;
    const set = (await request(`/api/interviews/${id}`)).data;
    assert.equal(set.questions.length, 3);
    assert.equal(ai.requestedModes.at(-1), "interview"); assert.equal(ai.requestedModels.at(-1), "test-small");
    assert(set.questions.every((q: { keywords: string[] }) => q.keywords.length >= 3 && q.keywords.every(k => k.length <= 80)));
    assert(set.sources.every((s: object) => !Object.hasOwn(s, "content")), "full résumé snapshots stay on backend");
    assert(app.store.interview(id).sources.some(s => s.content));
    if (type === "position") { assert.equal(set.jobTitle, imported.data.title); assert(ai.prompts.at(-1)!.includes("必须 Kotlin")); }
  }
  const state = (await request("/api/state")).data;
  assert.equal(state.stats.total, 0); assert.equal(state.languageDrills.length, 0); assert.equal(state.interviews.length, 3);
  assert(!JSON.stringify(state.interviews).includes("【隔离测试资料】"));
  await app.store.flush(); const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(restored.snapshot().interviews!.length, 3); assert.equal(restored.interviewJob(imported.data.id).sources.length, 3);
  assert.equal((await request("/sources/private-resume.pdf")).status, 404);
});

test("interview submission evaluates only answered questions and preserves newer drafts and prior reviews", async t => {
  const { request, complete, ai, app, dataDir } = await setup(t);
  const generated = await complete("/api/interviews", { type: "technical", topic: "architecture", count: 3 });
  const id = (generated.result as { interviewId: string }).interviewId;
  const original = "背景很多。私が状態と責務を整理しました。";
  assert.equal((await request(`/api/interviews/${id}`, "PUT", { answers: { q1: original, q2: "" } })).status, 200);
  ai.delay = 40;
  const submitted = await request(`/api/interviews/${id}/review`, "POST", { answers: { q1: original, q2: "  " } });
  assert.equal(submitted.status, 202);
  const newer = "結論：変更に強い責務分離です。";
  await request(`/api/interviews/${id}`, "PUT", { answers: { q1: newer } });
  await app.tasks.get(submitted.data.jobId).promise;
  const set = (await request(`/api/interviews/${id}`)).data;
  assert.equal(set.answers.q1, newer); assert.equal(set.reviews[0].answers.q1, original);
  assert.deepEqual(Object.keys(set.reviews[0].answers), ["q1"]); assert.equal(set.reviews[0].items.length, 1);
  assert(set.reviews[0].items[0].cuts.length); assert.equal(ai.requestedModes.at(-1), "interview");
  await complete(`/api/interviews/${id}/review`, { answers: { q1: newer, q3: "Test answer" } });
  await app.store.flush(); const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(restored.interview(id).reviews.length, 2); assert.equal(restored.interview(id).reviews[0].answers.q1, original);
});

test("interview validation rejects bad selections, unknown questions, empty submissions and malformed output", async t => {
  const { request, complete, ai, app } = await setup(t);
  for (const selection of [{ type: "__proto__", topic: "all", count: 3 }, { type: "common", topic: "architecture", count: 3 }, { type: "common", topic: "all", count: 4 }, { type: "position", topic: "all", count: 3 }]) {
    assert.equal((await request("/api/interviews", "POST", selection)).status, 400);
  }
  assert.equal((await request("/api/interviews", "POST", { type: "position", topic: "all", count: 3, jobId: "missing" })).status, 404);
  const generated = await complete("/api/interviews", { type: "common", topic: "all", count: 3 });
  const id = (generated.result as { interviewId: string }).interviewId;
  assert.equal((await request(`/api/interviews/${id}/review`, "POST", { answers: { q1: " " } })).status, 400);
  assert.equal((await request(`/api/interviews/${id}`, "PUT", { answers: { q9: "wrong" } })).status, 400);
  ai.mode = "malformed";
  const res = await request(`/api/interviews/${id}/review`, "POST", { answers: { q1: "回答" } }); await app.tasks.get(res.data.jobId).promise;
  assert.equal(app.tasks.get(res.data.jobId).status, "error"); assert.equal(app.store.interview(id).reviews.length, 0);
  const bad = await request("/api/interviews", "POST", { type: "common", topic: "all", count: 3 }); await app.tasks.get(bad.data.jobId).promise;
  assert.equal(app.store.snapshot().interviews!.length, 1);
});

test("interview cancellation and cross-module concurrency preserve history and model", async t => {
  const { request, app, ai } = await setup(t); ai.mode = "block";
  const started = await request("/api/interviews", "POST", { type: "common", topic: "all", count: 3 }); assert.equal(started.status, 202);
  assert.equal((await request("/api/language-drills", "POST", { language: "dart", topic: "foundation" })).status, 409);
  assert.equal((await request("/api/model", "PUT", { model: "test-small" })).status, 409);
  assert.equal((await request(`/api/jobs/${started.data.jobId}/abort`, "POST", {})).status, 200);
  assert.equal(app.tasks.get(started.data.jobId).status, "aborted"); assert.equal(app.store.snapshot().interviews?.length ?? 0, 0);
  assert.equal(app.tasks.activeJob(), null);
});

test("job import supports multiple URLs and pasted fallback while keeping failed-source warnings", async () => {
  const job = await importJob({ title: "Mobile", urls: ["https://example.com/one", "https://example.com/two", "https://example.com/unavailable"], description: "用户提供的完整 JD" }, fakeJobReader);
  assert.equal(job.sources.length, 3); assert.equal(job.sources.at(-1)!.content, "用户提供的完整 JD"); assert.equal(job.warnings.length, 1);
  assert(!JSON.stringify(job).includes("PRIVATE_NETWORK_ERROR"));
  await assert.rejects(() => importJob({ title: "Empty", urls: ["https://example.com/unavailable"] }, fakeJobReader), /粘贴 JD/);
  await assert.rejects(() => importJob({ title: "Private", urls: ["http://127.0.0.1"], description: "valid fallback" }, fakeJobReader), /公开地址/);
  await assert.rejects(() => importJob({ title: "Long", urls: [], description: "x".repeat(60001) }, fakeJobReader), /60,000/);
});

test("job URL import rejects private targets and extracts readable JD without scripts or navigation", () => {
  for (const address of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "0.0.0.0", "224.0.0.1", "::1"]) assert.equal(publicIPv4(address), false, address);
  assert(publicIPv4("8.8.8.8"));
  for (const url of ["file:///tmp/job", "http://localhost/jd", "http://127.1", "http://[::1]", "https://user:pass@example.com", "https://example.com:3000", "http://169.254.169.254/latest"]) assert.throws(() => jobUrl(url));
  assert.equal(jobUrl("https://example.com/jobs#section").href, "https://example.com/jobs");
  const jd = "Mobile Engineer。Kotlin・Flutter・SDK・テストとレビュー。".repeat(8);
  const page = extractJobHtml(`<title>Mobile role</title><nav>IGNORE NAV</nav><script>SECRET SCRIPT</script><main><h1>Mobile</h1><p>${jd}</p><div hidden>HIDDEN</div></main>`);
  assert(page.content.includes(jd)); assert(!/IGNORE NAV|SECRET SCRIPT|HIDDEN/.test(page.content)); assert.equal(page.title, "Mobile role");
  const structured = extractJobHtml(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Kotlin Engineer", description: `<p>${jd}</p>` })}</script><main>职位</main>`);
  assert(structured.content.includes("Kotlin Engineer")); assert.throws(() => extractJobHtml("<main>Sign in</main>"), /粘贴/);
});

test("interview results require short keywords and authentic source references, reviews require exact submitted IDs", async () => {
  const sources = await fakeInterviewSources.load({ type: "common", topic: "all", count: 3 });
  const q = { question: "質問", kind: "technical", focus: "責務", keywords: ["結論", "行動", "結果"], answerBasis: "experience", evidenceNote: "履歴", sourceIds: ["resume-test"] };
  assert.equal(interviewContent({ title: "題", introduction: "説明", questions: [q] }, 1, sources).questions[0].id, "q1");
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [{ ...q, keywords: ["x".repeat(81), "a", "b"] }] }, 1, sources));
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [{ ...q, sourceIds: ["invented"] }] }, 1, sources));
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [{ ...q, sourceIds: ["study-test"] }] }, 1, sources), /经历/);
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [q] }, 1, sources, "common"), /技术题/);
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [{ ...q, kind: "behavioral" }] }, 1, sources, "technical"), /非技术题/);
  assert.throws(() => interviewContent({ title: "題", introduction: "説明", questions: [q] }, 1, sources, "position"), /JD/);
  const r = { questionId: "q1", assessment: "clear", summary: "清楚", dimensions: { relevance: "切题", conciseness: "简洁", structure: "清楚", evidence: "有依据" }, strengths: [], gaps: [], cuts: [], improvedKeywords: ["a", "b", "c"], followUp: "为什么" };
  assert.throws(() => interviewReviewContent({ summary: "评价", items: [r, r] }, ["q1", "q2"]), /题号/);
  assert.throws(() => interviewReviewContent({ summary: "评价", items: [r] }, ["q2"]), /题号/);
});
