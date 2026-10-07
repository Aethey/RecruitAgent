import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Chat } from "../src/features/chat/service.ts";
import { Store } from "../src/shared/persistence/store.ts";
import { createApp } from "../src/app/http.ts";
import { FakeAI, fakeInterviewSources, sampleProblem } from "./fixtures.ts";

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dataDir = await mkdtemp(join(tmpdir(), "recruit-teacher-test-")), ai = new FakeAI();
  const app = await createApp({ dataDir, ai, sourceDir: null, interviewSources: fakeInterviewSources });
  await app.store.update(state => {
    state.problems.push(...["one", "two"].map(id => ({ ...sampleProblem, title: `${sampleProblem.title} ${id}`, id, topic: "array" as const, difficulty: "easy" as const, language: "javascript" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), code: sampleProblem.starterCode, hints: [], reviews: [] })));
  });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(path: string, method = "GET", value?: unknown) {
    const res = await fetch(base + path, { method, headers: value === undefined ? {} : { "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: res.status, data: await res.json() };
  }
  const open = async (id = "one") => (await request(`/api/problems/${id}/teacher`, "POST", {})).data;
  const body = (id: string, code = "function longestIncreasingRun(nums) { return nums.length; }", trigger = "observe") => ({ id, code, revision: 1, trigger });
  async function start(id: string, value: unknown) {
    const res = await request(`/api/teachers/${id}/messages`, "POST", value); assert.equal(res.status, 202, JSON.stringify(res.data));
    return app.tasks.get(res.data.jobId);
  }
  return { ai, app, dataDir, base, request, open, body, start };
}

test("teacher sessions isolate problems and normal chat; turns use unsaved code and the selected model", async t => {
  const { ai, app, dataDir, request, open, body, start } = await setup(t);
  const [one, duplicate] = await Promise.all([open(), open()]); assert.equal(one.id, duplicate.id);
  const two = await open("two"); assert.notEqual(one.id, two.id); assert.equal(ai.prompts.length, 0);
  assert.equal((await request("/api/chats")).data.threads.length, 0);
  const job = await start(one.id, body("first")); await job.promise; assert.equal(job.status, "done");
  const first = (await request(`/api/teachers/${one.id}`)).data.turns[0];
  assert.equal(ai.requestedModes.at(-1), "teacher"); assert.equal(first.teacher.revision, 1);
  const latest = JSON.parse(ai.prompts.at(-1)!.match(/最新一轮：([^\n]+)\n/)![1]);
  assert.equal(latest.page.editor, body("first").code); assert.equal(latest.page.route, "#practice/one");
  assert.equal(JSON.parse(latest.page.record).examples[0].output, "3");
  assert.equal(app.store.problem("one").code, sampleProblem.starterCode, "teacher must not overwrite the working draft");
  assert.equal(first.status, "done"); assert(first.assistant.includes("代码观察"));
  assert.equal((await request(`/api/teachers/${two.id}`)).data.turns.length, 0);
  assert.equal((await request(`/api/teachers/${one.id}/messages`, "POST", body("again"))).status, 409);
  await request("/api/model", "PUT", { model: "test-small" });
  const code = "function longestIncreasingRun(nums) { let current = 1; }";
  const question = await start(one.id, { ...body("follow", code, "question"), revision: 2, message: "为什么要区分当前和最长？" }); await question.promise;
  assert.equal(ai.requestedModels.at(-1), "test-small");
  assert(ai.prompts.at(-1)!.includes(JSON.stringify(first.assistant).slice(1, -1)));
  assert.equal(JSON.parse(ai.prompts.at(-1)!.match(/最新一轮：([^\n]+)\n/)![1]).page.editor, code);
  assert.equal(app.store.problem("one").teacherHints, 2);
  const review = await request("/api/problems/one/review", "POST", { code }); await app.tasks.get(review.data.jobId).promise;
  assert.equal(app.store.problem("one").reviews[0].hintsUsed, 2);
  assert.equal((await request("/api/state")).data.stats.hints, 2);
  await app.store.flush(); const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(new Chat(restored).getTeacher(one.id).turns[1].context.editor, code);
  assert.equal(new Chat(restored).list().length, 0);
});

test("teacher streams Markdown, cancels with partial history, and can guide a newer snapshot", async t => {
  const { ai, app, base, request, open, body, start } = await setup(t);
  ai.chatChunkDelay = 65; const thread = await open(), job = await start(thread.id, body("stream"));
  assert.equal(app.tasks.activeJob()?.kind, "teacher"); assert.equal(app.tasks.activeJob()?.chatId, thread.id);
  const controller = new AbortController(); t.after(async () => { controller.abort(); });
  const response = await fetch(`${base}/api/jobs/${job.id}/events`, { signal: controller.signal }); const reader = response.body!.getReader();
  let events = "";
  while (!events.includes('"text":"')) { const item = await reader.read(); assert(!item.done); events += new TextDecoder().decode(item.value); }
  assert(events.includes("event: chat-start")); assert(events.includes("event: message"));
  assert.equal((await request("/api/model", "PUT", { model: "test-small" })).status, 409);
  await request(`/api/jobs/${job.id}/abort`, "POST", {}); await job.promise; controller.abort();
  const aborted = (await request(`/api/teachers/${thread.id}`)).data.turns[0];
  assert.equal(aborted.status, "aborted"); assert(aborted.assistant.length > 0); assert.equal(app.store.problem("one").teacherHints, undefined);
  ai.chatChunkDelay = 0;
  const next = await start(thread.id, { ...body("new", "// latest current = 1"), revision: 3 }); await next.promise;
  assert.equal(next.status, "done"); assert.equal(app.store.problem("one").teacherHints, 1);
  assert.equal((await request(`/api/teachers/${thread.id}`)).data.turns.length, 2);
});

test("teacher validates requests, sanitizes failures and recovers interrupted generations", async t => {
  const { ai, app, request, open, body, start } = await setup(t);
  assert.equal((await request("/api/problems/missing/teacher", "POST", {})).status, 404);
  const thread = await open();
  for (const invalid of [{ code: null }, { code: "x".repeat(100001) }, { revision: -1 }, { revision: 1.5 }, { trigger: "chat" }, { id: "bad id" }, { trigger: "question", message: " " }]) {
    assert.equal((await request(`/api/teachers/${thread.id}/messages`, "POST", { ...body("invalid"), ...invalid })).status, 400);
  }
  assert.equal((await request(`/api/chats/${thread.id}/messages`, "POST", {})).status, 400);
  const normal = (await request("/api/chats", "POST", {})).data;
  assert.equal((await request(`/api/teachers/${normal.id}`)).status, 404);
  ai.authenticated = false; assert.equal((await request(`/api/teachers/${thread.id}/messages`, "POST", body("no-auth"))).status, 401);
  assert.equal((await request(`/api/teachers/${thread.id}`)).data.turns.length, 0);
  ai.authenticated = true; ai.chatFailAfter = 2;
  const failed = await start(thread.id, body("error")); await failed.promise;
  const turn = (await request(`/api/teachers/${thread.id}`)).data.turns[0];
  assert.equal(turn.status, "error"); assert(turn.assistant.length); assert(!JSON.stringify(turn).includes("PRIVATE_CREDENTIAL"));
  await app.store.update(state => { state.chats!.find(item => item.id === thread.id)!.turns[0].status = "streaming"; });
  const chats = new Chat(app.store); await chats.recover();
  assert.equal(chats.getTeacher(thread.id).turns[0].status, "aborted"); assert.equal(chats.getTeacher(thread.id).turns[0].assistant, turn.assistant);
});

const { createTeacherMonitor } = await import(new URL("../public/teacher-monitor.js", import.meta.url).href);
async function clockHarness(options: { idleMs?: number; automatic?: boolean } = {}) {
  let time = 0, counter = 0, busy = false; const timers = new Map<number, { at: number; run: () => void }>(), sent: { problemId: string; code: string }[] = [];
  const drain = () => new Promise<void>(resolve => setImmediate(resolve));
  const monitor = createTeacherMonitor({ ...options, send: async (value: { problemId: string; code: string }) => { sent.push(value); }, isBusy: () => busy, now: () => time,
    schedule: (run: () => void, ms: number) => { const id = ++counter; timers.set(id, { at: time + ms, run }); return id; }, cancel: (id: number) => { timers.delete(id); } });
  async function advance(ms: number) {
    const target = time + ms;
    for (;;) { const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!due || due[1].at > target) break; time = due[1].at; timers.delete(due[0]); due[1].run(); await drain(); }
    time = target; await drain();
  }
  monitor.enable(true);
  return { monitor, sent, advance, busy(value: boolean) { busy = value; monitor.sync(); } };
}
const snapshot = (code: string, problemId = "one") => ({ problemId, code });

test("teacher monitor waits 20 seconds after the last edit, resets on continued typing and never repeats unchanged code", async () => {
  const { monitor, sent, advance } = await clockHarness();
  monitor.observe(snapshot("a")); await advance(15000); monitor.observe(snapshot("ab")); await advance(19000); monitor.observe(snapshot("abc")); await advance(19999); assert.equal(sent.length, 0);
  await advance(1); assert.deepEqual(sent, [snapshot("abc")]);
  monitor.observe(snapshot("abcd")); await advance(19000); assert.equal(sent.length, 1);
  monitor.observe(snapshot("latest")); await advance(19999); assert.equal(sent.length, 1);
  await advance(1); assert.deepEqual(sent.at(-1), snapshot("latest"));
  await advance(60000); monitor.sync(); await advance(60000); assert.equal(sent.length, 2);
});

test("teacher monitor queues only the latest edit while busy and respects pause, leaving the page and exit", async () => {
  const { monitor, sent, advance, busy } = await clockHarness();
  busy(true); monitor.observe(snapshot("old")); await advance(30000); monitor.observe(snapshot("new")); await advance(20000); assert.equal(sent.length, 0);
  busy(false); await advance(0); assert.deepEqual(sent, [snapshot("new")]);
  monitor.pause(true); monitor.observe(snapshot("paused")); await advance(30000); assert.equal(sent.length, 1);
  monitor.pause(false); await advance(0); assert.equal(sent.at(-1)?.code, "paused");
  monitor.observe(null); await advance(10000); assert.equal(sent.length, 2);
  monitor.observe(snapshot("second", "two")); monitor.enable(false); await advance(10000); assert.equal(sent.length, 2);
});

test("teacher monitor restores completed snapshots without a call, and explicit checking can retry the same code", async () => {
  const { monitor, sent, advance } = await clockHarness();
  monitor.seed(snapshot("saved")); monitor.observe(snapshot("saved")); await advance(10000); assert.equal(sent.length, 0);
  monitor.check(); await advance(0); assert.equal(sent.length, 1);
  monitor.observe(snapshot("changed")); monitor.seed(snapshot("changed")); await advance(10000); assert.equal(sent.length, 1);
});

test("manual teacher mode never requests after edits or waiting, but explicit analysis bypasses the idle delay", async () => {
  const { monitor, sent, advance } = await clockHarness({ automatic: false });
  monitor.observe(snapshot("start")); await advance(60000); monitor.observe(snapshot("latest")); await advance(60000); assert.equal(sent.length, 0);
  monitor.check(); await advance(0); assert.deepEqual(sent, [snapshot("latest")]);
  monitor.observe(snapshot("next")); await advance(60000); assert.equal(sent.length, 1);
  monitor.configure({ automatic: true, idleMs: 20000 }); await advance(19999); assert.equal(sent.length, 1);
  await advance(1); assert.equal(sent.at(-1)?.code, "next");
});

test("changing teacher preferences cancels pending automatic checks and uses the configured idle duration", async () => {
  const { monitor, sent, advance } = await clockHarness();
  monitor.observe(snapshot("first")); await advance(19000);
  monitor.configure({ automatic: false, idleMs: 20000 }); await advance(60000); assert.equal(sent.length, 0);
  monitor.configure({ automatic: true, idleMs: 30000 }); await advance(29999); assert.equal(sent.length, 0);
  await advance(1); assert.deepEqual(sent, [snapshot("first")]);
  monitor.observe(snapshot("new edit")); await advance(1000); monitor.check(); await advance(0); assert.equal(sent.length, 1);
  await advance(5000); assert.equal(sent.at(-1)?.code, "new edit", "explicit analysis bypasses 30-second idle but respects the shared rate limit");
});

test("manual analysis still works when busy slot clears; switching to manual does not restart unchanged requests", async () => {
  const { monitor, sent, advance, busy } = await clockHarness({ automatic: false });
  busy(true); monitor.observe(snapshot("code")); monitor.check(); await advance(30000); assert.equal(sent.length, 0);
  busy(false); await advance(0); assert.equal(sent.length, 1);
  monitor.sync(); await advance(60000); assert.equal(sent.length, 1);
});

test("saved manual teacher settings reject automatic observations but keep explicit analysis and questions available", async t => {
  const { app, ai, request, open, body, start } = await setup(t);
  const thread = await open();
  assert.deepEqual((await request('/api/settings')).data.teacher, { trigger: 'idle', idleSeconds: 20 });
  const saved = await request('/api/settings', 'PUT', { teacher: { trigger: 'manual', idleSeconds: 30 } }); assert.equal(saved.status, 200);
  const calls = ai.prompts.length;
  assert.equal((await request(`/api/teachers/${thread.id}/messages`, 'POST', body('automatic'))).status, 409);
  assert.equal(ai.prompts.length, calls); assert.equal((await request(`/api/teachers/${thread.id}`)).data.turns.length, 0);
  const manual = await start(thread.id, body('check', '// latest snapshot', 'check')); await manual.promise; assert.equal(manual.status, 'done');
  const question = await start(thread.id, { ...body('question', '// new code', 'question'), message: '这里为什么不对？' }); await question.promise; assert.equal(question.status, 'done');
  assert.equal(app.store.problem('one').teacherHints, 2);
});
