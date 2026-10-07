import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Chat, type ChatThread } from "../src/features/chat/service.ts";
import { createApp } from "../src/app/http.ts";
import { Store } from "../src/shared/persistence/store.ts";
import { FakeAI, fakeInterviewSources } from "./fixtures.ts";

const page = (route = "#practice", title = "当前题目") => ({ route, title, visibleText: "页面里的问题与讲解", selectedText: "这段没有理解", fields: [{ label: "我的回答", value: "仍在编辑的答案" }], editor: "// 未保存代码" });
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const dataDir = await mkdtemp(join(tmpdir(), "recruit-chat-test-")), ai = new FakeAI();
  const app = await createApp({ dataDir, ai, sourceDir: null, interviewSources: fakeInterviewSources });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  async function request(path: string, method = "GET", value?: unknown) {
    const response = await fetch(base + path, { method, headers: value === undefined ? {} : { "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { status: response.status, data: await response.json() };
  }
  async function complete(path: string, value: unknown) {
    const response = await request(path, "POST", value); assert.equal(response.status, 202, JSON.stringify(response.data));
    const job = app.tasks.get(response.data.jobId); await job.promise;
    assert.equal(job.status, "done", job.error ?? "Task should succeed"); return job;
  }
  async function create() { const response = await request("/api/chats", "POST", {}); assert.equal(response.status, 201); return response.data.id as string; }
  const send = (id: string, value: unknown) => complete(`/api/chats/${id}/messages`, value);
  return { ai, app, dataDir, base, request, complete, create, send };
}

test("chat sends current page, live inputs and entire dialogue using the selected model; history survives reload", async t => {
  const { ai, app, request, complete, create, send, dataDir } = await setup(t);
  const problemJob = await complete("/api/problems", { topic: "array", difficulty: "easy", language: "javascript" });
  const problemId = (problemJob.result as { problemId: string }).problemId;
  const id = await create(), calls = ai.prompts.length;
  assert.equal((await request("/api/chats")).data.threads[0].turnCount, 0);
  assert.equal(ai.prompts.length, calls, "opening history does not call AI");
  const first = { id: "first", message: "这里为什么重置？", context: page(`#practice/${problemId}`, "算法题") };
  await send(id, first);
  assert.equal(ai.requestedModes.at(-1), "chat");
  assert(ai.prompts.at(-1)!.includes("最长连续递增片段"));
  assert(ai.prompts.at(-1)!.includes("// 未保存代码"));
  assert(ai.prompts.at(-1)!.includes("仍在编辑的答案"));
  assert(ai.prompts.at(-1)!.includes("这段没有理解"));
  const saved = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(saved.turns[0].status, "done"); assert(saved.turns[0].assistant.includes("```dart"));
  assert.equal(saved.turns[0].context.editor, first.context.editor);
  assert.equal((await request(`/api/chats/${id}/messages`, "POST", first)).status, 409);
  await request("/api/model", "PUT", { model: "test-small" });
  await send(id, { id: "second", message: "换到设置后，刚才的结论还能用吗？", context: page("#settings", "模型设置") });
  assert.equal(ai.requestedModels.at(-1), "test-small");
  assert(ai.prompts.at(-1)!.includes(saved.turns[0].user));
  assert(ai.prompts.at(-1)!.includes(JSON.stringify(saved.turns[0].assistant).slice(1, -1)));
  const latest = JSON.parse(ai.prompts.at(-1)!.match(/最新一轮：([^\n]+)\n/)![1]);
  assert.equal(latest.page.route, "#settings"); assert(!latest.page.record, "old problem must not become the new page's record");
  assert.equal((await request("/api/state")).data.chats, undefined, "learning state need not download all chat snapshots");
  assert.equal((await request("/api/chats")).data.threads[0].turnCount, 2);
  await app.store.flush(); const restored = new Store(join(dataDir, "state.json")); await restored.load();
  assert.equal(new Chat(restored).get(id).turns[1].model, "test-small");
  assert.equal(new Chat(restored).get(id).turns[0].context.route, first.context.route);
});

test("all module hubs are valid page contexts without importing unrelated records", async t => {
  const { app } = await setup(t), chats = new Chat(app.store);
  for (const name of ["practice", "history", "analysis", "language", "interview", "training", "study", "breadth", "entertainment", "voice", "library", "settings"]) {
    const snapshot = chats.context(page(`#${name}`, name));
    assert.equal(snapshot.title, name); assert.equal(snapshot.selectedText, "这段没有理解");
    if (name !== "analysis") assert.equal(snapshot.record, undefined);
  }
});

test("detail contexts include authorized records and exclude unrevealed templates, repairs and test answers", async t => {
  const { app, complete, request } = await setup(t), chats = new Chat(app.store);
  const language = await complete("/api/language-drills", { language: "dart", topic: "foundation" });
  const drillId = (language.result as { drillId: string }).drillId;
  assert(!chats.context(page(`#language/${drillId}`)).record!.includes("templateCode"));
  await request(`/api/language-drills/${drillId}/reveal`, "POST", {});
  assert(chats.context(page(`#language/${drillId}`)).record!.includes("templateCode"));
  const diagnosis = await complete("/api/trainings/diagnosis", { language: "dart", topic: "async" });
  const trainingId = (diagnosis.result as { trainingId: string }).trainingId;
  const trainingContext = chats.context(page(`#training/${trainingId}`)).record!;
  assert(trainingContext.includes("旧请求")); assert(!trainingContext.includes("fixedCode"));
  const quiz = await complete("/api/study/batches", { category: "language", language: "dart", facet: "recall", count: 3 });
  const batchId = (quiz.result as { batchId: string }).batchId;
  const quizContext = chats.context(page(`#breadth/${batchId}`)).record!;
  assert(!quizContext.includes('"reference"'));
  const batch = app.store.snapshot().studyBatches!.find(batch => batch.id === batchId)!;
  await request(`/api/study/batches/${batchId}/items/${batch.items[0].id}/reveal`, "POST", {});
  const revealed = JSON.parse(chats.context(page(`#study/${batchId}`)).record!);
  assert(revealed.items[0].reference); assert(!revealed.items[1].reference);
  const interview = await complete("/api/interviews", { type: "technical", topic: "architecture", count: 3 });
  const interviewId = (interview.result as { interviewId: string }).interviewId;
  const interviewContext = chats.context(page(`#interview/${interviewId}`)).record!;
  assert(interviewContext.includes("questions")); assert(!interviewContext.includes("【隔离测试资料】"));
  assert.throws(() => chats.context(page("#practice/missing")), /不存在/);
});

test("library PDF context follows the current page instead of sending another page's text", async t => {
  const { app } = await setup(t);
  await app.store.update(state => { state.library = [{ blob: "test.pdf", origin: "upload", id: "pdf-test", kind: "pdf", title: "两页资料", filename: "test.pdf", mime: "application/pdf", category: "学习", tags: [], summary: "测试", keyPoints: [], notes: "", status: "ready", createdAt: "2026-10-03", updatedAt: "2026-10-03", size: 1, hash: "test", revision: 1, extractedText: "第一页内容；第二页内容", pages: [{ number: 1, text: "第一页专属内容", vision: false }, { number: 2, text: "第二页专属内容", vision: false }] }]; });
  const context = new Chat(app.store).context({ ...page("#library/pdf-test"), pdfPage: 2 });
  assert(context.record!.includes("第二页专属内容")); assert(!context.record!.includes("第一页专属内容"));
});

test("chat emits cumulative text before completion, supports SSE replay, and persists exactly the final text", async t => {
  const { ai, app, base, request, create } = await setup(t);
  ai.chatChunkDelay = 20; ai.chatOutput = "**实时文本**\n" + "分段输出，不能重复。".repeat(35);
  const id = await create();
  const started = await request(`/api/chats/${id}/messages`, "POST", { id: "stream", message: "说明这里", context: page() });
  assert.equal(started.status, 202);
  const response = await fetch(`${base}/api/jobs/${started.data.jobId}/events`), reader = response.body!.getReader();
  let wire = "", sawPartial = false;
  while (!wire.includes("event: done\n")) {
    const result = await reader.read(); if (result.done) break;
    wire += new TextDecoder().decode(result.value);
    if (wire.includes("event: message\n") && app.tasks.get(started.data.jobId).status === "running") {
      sawPartial = true;
      const running = (await request(`/api/chats/${id}`)).data as ChatThread;
      assert(running.turns[0].assistant.length > 0); assert.equal(running.turns[0].status, "streaming");
    }
  }
  await reader.cancel(); assert(sawPartial);
  const frames = wire.split("\n\n").filter(frame => frame.includes("event: message\n"));
  const texts = frames.map(frame => JSON.parse(frame.match(/data: (.+)/)![1]).text as string);
  assert(texts.length > 2); assert(texts.every(text => ai.chatOutput!.startsWith(text)));
  assert.equal(texts.at(-1), ai.chatOutput);
  const lastId = Number(frames.at(-2)!.match(/id: (\d+)/)![1]);
  const replay = await fetch(`${base}/api/jobs/${started.data.jobId}/events`, { headers: { "Last-Event-ID": String(lastId) } });
  const replayReader = replay.body!.getReader(); let replayWire = "";
  while (!replayWire.includes("event: done\n")) {
    const chunk = await replayReader.read(); if (chunk.done) break;
    replayWire += new TextDecoder().decode(chunk.value);
  }
  await replayReader.cancel();
  assert(replayWire.includes("event: message"));
  assert([...replayWire.matchAll(/id: (\d+)/g)].every(match => Number(match[1]) > lastId));
  const thread = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(thread.turns[0].assistant, ai.chatOutput); assert.equal(thread.turns[0].status, "done");
});

test("cancellation preserves partial output; retry uses the same question and snapshot with the new selected model", async t => {
  const { ai, app, request, create, complete } = await setup(t);
  ai.chatOutput = "逐段回复。".repeat(80); ai.chatChunkDelay = 15;
  const id = await create(), context = page("#entertainment", "当前知识卡");
  const started = await request(`/api/chats/${id}/messages`, "POST", { id: "stop", message: "卡片讲解", context });
  const job = app.tasks.get(started.data.jobId);
  while (!new Chat(app.store).get(id).turns[0]?.assistant) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await request(`/api/jobs/${job.id}/abort`, "POST", {})).status, 200);
  const stopped = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(stopped.turns[0].status, "aborted"); assert(stopped.turns[0].assistant.length > 0); assert(stopped.turns[0].error);
  ai.chatChunkDelay = 0; ai.chatOutput = "已重新完整回答。";
  await request("/api/model", "PUT", { model: "test-small" });
  await complete(`/api/chats/${id}/retry`, { turnId: "stop" });
  const retried = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(retried.turns.length, 1); assert.equal(retried.turns[0].assistant, ai.chatOutput);
  assert.equal(retried.turns[0].model, "test-small"); assert.deepEqual(retried.turns[0].context, stopped.turns[0].context);
  assert.equal((await request(`/api/chats/${id}/retry`, "POST", { turnId: "stop" })).status, 400);
});

test("stream errors retain partial output and safe messages without exposing internal errors", async t => {
  const { ai, app, request, create } = await setup(t);
  ai.chatFailAfter = 2;
  const id = await create();
  const started = await request(`/api/chats/${id}/messages`, "POST", { id: "failure", message: "看看这里", context: page() });
  await app.tasks.get(started.data.jobId).promise;
  const result = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(result.turns[0].status, "error"); assert(result.turns[0].assistant.length > 0);
  assert(!JSON.stringify(result).includes("PRIVATE_CREDENTIAL_MUST_NOT_APPEAR"));
});

test("provider retry snapshots replace old partial text instead of duplicating it", async t => {
  const { ai, app, request, create } = await setup(t);
  ai.ask = async (_prompt, _signal, progress) => {
    progress(3, "旧片段", "旧片段");
    progress(3, "新片段", "新片段");
    throw new Error("PRIVATE_CREDENTIAL_MUST_NOT_APPEAR");
  };
  const id = await create();
  const started = await request(`/api/chats/${id}/messages`, "POST", { id: "provider-retry", message: "看看这里", context: page() });
  await app.tasks.get(started.data.jobId).promise;
  const result = (await request(`/api/chats/${id}`)).data as ChatThread;
  assert.equal(result.turns[0].assistant, "新片段");
});

test("chat shares the existing task lock and respects configured model visibility", async t => {
  const { ai, app, request, create } = await setup(t), id = await create();
  await request("/api/settings", "PUT", { visibleModels: ["test-model"] });
  assert.equal((await request("/api/model", "PUT", { model: "test-small" })).status, 400);
  ai.mode = "block";
  const started = await request(`/api/chats/${id}/messages`, "POST", { id: "lock", message: "请解释", context: page() });
  assert.equal((await request("/api/problems", "POST", { topic: "array", difficulty: "easy", language: "dart" })).status, 409);
  assert.equal((await request("/api/model", "PUT", { model: "test-model" })).status, 409);
  assert.equal((await request(`/api/chats/${id}`, "DELETE")).status, 409);
  assert.equal((await request("/api/state")).data.activeJob.chatId, id);
  await request(`/api/jobs/${started.data.jobId}/abort`, "POST", {});
  assert.equal(app.tasks.activeJob(), null);
  assert.equal((await request(`/api/chats/${id}`, "DELETE")).status, 200);
  assert.equal((await request(`/api/chats/${id}`)).status, 404);
});

test("chat validation rejects missing inputs, invalid routes and forged records before calling AI", async t => {
  const { ai, request, create, send } = await setup(t), id = await create();
  ai.authenticated = false;
  assert.equal((await request(`/api/chats/${id}/messages`, "POST", { id: "no-auth", message: "hi", context: page() })).status, 401);
  assert.equal((await request(`/api/chats/${id}`)).data.turns.length, 0);
  ai.authenticated = true;
  for (const value of [
    { id: "empty", message: " ", context: page() },
    { id: "long", message: "x".repeat(20001), context: page() },
    { id: "bad-route", message: "hi", context: page("https://example.com") },
    { id: "bad-fields", message: "hi", context: { ...page(), fields: [{ label: "input", value: {} }] } },
    { id: "bad-page", message: "hi", context: { ...page(), pdfPage: -1 } },
  ]) assert.equal((await request(`/api/chats/${id}/messages`, "POST", value)).status, 400);
  assert.equal(ai.prompts.length, 0);
  await send(id, { id: "valid", message: "hi", context: { ...page(), record: "FORGED_PRIVATE_RECORD" } });
  assert(!ai.prompts[0].includes("FORGED_PRIVATE_RECORD"));
});

test("recovery marks interrupted replies and keeps all messages and learning data intact", async t => {
  const { app, dataDir, create, send } = await setup(t), id = await create();
  await send(id, { id: "recover", message: "测试重启", context: page() });
  await app.store.update(state => { const turn = state.chats![0].turns[0]; turn.status = "streaming"; turn.assistant = "重启前的部分内容"; });
  await app.store.flush();
  const restored = new Store(join(dataDir, "state.json")); await restored.load();
  const chats = new Chat(restored); await chats.recover();
  assert.equal(chats.get(id).turns[0].status, "aborted");
  assert.equal(chats.get(id).turns[0].assistant, "重启前的部分内容");
  assert(chats.get(id).turns[0].error!.includes("重启"));
  assert.equal(JSON.parse(await readFile(join(dataDir, "state.json"), "utf8")).chats[0].turns[0].status, "aborted");
});
