import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { ServerResponse } from "node:http";
import { AppError, object, text } from "./domain.ts";
import { Events } from "./events.ts";
import { LOCALES, outputLanguageInstruction, type Locale } from "./locales.ts";
import { VOICE_MODELS, VOICE_TONES, VOICE_PREVIEW_TEXT, DEFAULT_VOICE_SETTINGS, voiceSettings, voiceModel, type VoiceCatalog, type VoiceSettings, type VoiceTone, type ModelCheck } from "./voice-options.ts";
import { classifyVoiceIntent } from "./voice-intent.ts";
import type { EventPayloads } from './contracts.ts';
import type { Notification, RpcMethod, RpcParams, RpcResult } from './codex-protocol.ts';
import { nativeParams, nativeResult, nativeNotification } from './contract-validation.ts';

export type VoiceTranscript = { role: "user" | "assistant"; text: string; done: boolean; itemId?: string; source?: "segment" | "turn" };
export type VoiceContext = { prompt: string; instructions?: string; previewText?: string; onTranscript?: (line: VoiceTranscript) => void; onEnd?: () => Promise<void> };

export interface VoiceRpc {
  request<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  subscribe(listener: (event: Notification) => void): () => void;
  close(): Promise<void>;
}

export function voiceError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  try { const parsed = JSON.parse(message); if (typeof parsed.error?.message === "string") message = parsed.error.message; else if (typeof parsed.detail === "string") message = parsed.detail; } catch { /* Native errors can be plain text. */ }
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\b(?:sk-|ek[-_])[A-Za-z0-9_-]+/g, "[redacted]").slice(0,1800);
}

export class CodexVoiceRpc implements VoiceRpc {
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private listeners = new Set<(event: Notification) => void>();
  private ended = false;
  private constructor(private process: ChildProcessWithoutNullStreams) {
    // Credentials and native diagnostic logs stay in the backend.
    process.stderr.on("data", () => {});
    const lines = createInterface({ input: process.stdout });
    lines.on("line", line => {
      let message: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new AppError(502, voiceError(message.error.message)));
        else pending.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        process.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "This voice demo does not handle tool or approval requests." } }) + "\n");
      } else if (message.method) {
        const event = nativeNotification({ method: message.method, params: message.params ?? {} });
        if (event) for (const listener of this.listeners) listener(event);
      }
    });
    process.stdin.on("error", () => {});
    process.on("error", error => this.fail(new AppError(503, "code" in error && error.code === "ENOENT" ? "未找到 Codex CLI，请先安装并登录 Codex。" : "无法启动 Codex App Server。")));
    process.on("exit", () => { lines.close(); this.fail(new AppError(503, "Codex App Server 已退出，请重试连接。")); });
  }
  static async create(dataDir: string): Promise<CodexVoiceRpc> {
    const nativeDir = resolve(dataDir, "voice-demo");
    await mkdir(nativeDir, { recursive: true, mode: 0o700 });
    const rpc = new CodexVoiceRpc(spawn(process.env.CODEX_BIN ?? process.execPath, [
      ...(process.env.CODEX_BIN ? [] : [fileURLToPath(new URL("../node_modules/@openai/codex/bin/codex.js", import.meta.url))]),
      "app-server", "--stdio", "-c", `sqlite_home=${JSON.stringify(resolve(nativeDir,"state"))}`,
      "-c", `log_dir=${JSON.stringify(resolve(nativeDir,"logs"))}`,
      "-c", "features.apps=false", "-c", "features.plugins=false",
    ], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CODEX_SQLITE_HOME: resolve(nativeDir,"state") } }));
    try {
      await rpc.request("initialize", { clientInfo: { name: "recruitagent_voice_demo", title: "RecruitAgent Voice Demo", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      rpc.process.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
      return rpc;
    } catch (error) { await rpc.close(); throw error; }
  }
  request<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    if (!nativeParams(method, params)) return Promise.reject(new AppError(502, 'Codex 请求参数与 CLI 协议不一致。'));
    if (this.ended) return Promise.reject(new AppError(503, "Codex App Server 已退出，请重试连接。"));
    const id = ++this.sequence;
    return new Promise<RpcResult<M>>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectRequest(new AppError(504,"Codex 接口响应超时，请重试。")); }, 35000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); if (nativeResult(method, value)) resolveRequest(value); else rejectRequest(new AppError(502, 'Codex 返回的数据与 CLI 协议不一致。')); }, reject: error => { clearTimeout(timer); rejectRequest(error); } });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  subscribe(listener: (event: Notification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private fail(error: AppError) {
    if (this.ended) return;
    this.ended = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: "voice/processExited", params: { message: error.message } });
  }
  async close() {
    this.fail(new AppError(503, "语音连接已关闭。"));
    this.listeners.clear();
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    await new Promise<void>(resolveClose => {
      const timer = setTimeout(() => { this.process.kill("SIGKILL"); resolveClose(); }, 2000);
      this.process.once("exit", () => { clearTimeout(timer); resolveClose(); });
      this.process.kill("SIGTERM");
    });
  }
}

type Session = { id: string; threadId?: string; events: Events; ended: boolean; ending?: Promise<void>; failure?: string; context?: VoiceContext; previewStarted?: boolean; previewTimer?: ReturnType<typeof setTimeout>; settings?: VoiceSettings; authType?: string | null; lastTranscript?: VoiceTranscript; flatTranscripts?: boolean; canonicalTranscripts?: boolean; transcriptItems?: Map<string,{role:VoiceTranscript["role"];done:boolean}>; unsubscribe?: () => void; disconnectTimer?: ReturnType<typeof setTimeout>; cancel?: () => void; activeTurnId?: string; suspended?: boolean; turnTimer?: ReturnType<typeof setTimeout> };
export class CodexVoice {
  private rpc?: Promise<VoiceRpc>;
  private session?: Session;
  private sessions = new Map<string, Session>();
  private checks: Record<string, ModelCheck> | undefined;
  constructor(private dataDir: string, private factory: () => Promise<VoiceRpc> = () => CodexVoiceRpc.create(dataDir), private timeout = 40000) {}
  private native() {
    if (!this.rpc) this.rpc = this.factory().then(rpc => {
      rpc.subscribe(event => { if (event.method === "voice/processExited") this.rpc = undefined; });
      return rpc;
    }).catch(error => { this.rpc = undefined; throw error; });
    return this.rpc;
  }
  async status() {
    const rpc = await this.native();
    const result = await rpc.request("account/read", { refreshToken: false });
    return { authenticated: !!result.account, authType: result.account?.type ?? null, experimental: true, transport: "webrtc", active: !!this.session && !this.session.ended };
  }
  async catalog(): Promise<VoiceCatalog> {
    const rpc = await this.native();
    const result = await rpc.request("thread/realtime/listVoices", {});
    if (!result.voices?.v1?.length || !result.voices?.v2?.length) throw new AppError(502, "Codex 未返回可用音色列表，请检查 CLI 版本。");
    return result.voices;
  }
  async options() {
    const [voices, status] = await Promise.all([this.catalog(), this.status()]);
    if (!this.checks) {
      try { this.checks = JSON.parse(await readFile(resolve(this.dataDir,"voice-demo","model-checks.json"),"utf8")); }
      catch { this.checks = {}; }
    }
    return { voices, defaults: DEFAULT_VOICE_SETTINGS, languages: LOCALES, tones: Object.fromEntries(Object.entries(VOICE_TONES).map(([key,value]) => [key,value.label])) as Record<VoiceTone, string>,
      models: VOICE_MODELS.map(model => { const check = this.checks?.[model.id]?.authType === status.authType ? this.checks[model.id] : null; return { ...model, check:check ? {...check,...(check.message ? {message:voiceError(check.message)} : {})} : null }; }),
      directoryComplete: false };
  }
  private async checkModel(model: string, status: ModelCheck["status"], authType: string | null, message?: string) {
    if (!this.checks) await this.options();
    this.checks![model] = { status, at: new Date().toISOString(), authType, ...(message ? { message: voiceError(message) } : {}) };
    await mkdir(resolve(this.dataDir,"voice-demo"),{recursive:true,mode:0o700});
    await writeFile(resolve(this.dataDir,"voice-demo","model-checks.json"),JSON.stringify(this.checks,null,2),{mode:0o600});
  }
  async verifyAudio(id: string, value: unknown) {
    const session = this.sessions.get(id), input = object(value);
    if (!session || session.ended || !session.settings) throw new AppError(404,"语音会话已结束。");
    if (typeof input.energy !== "number" || !Number.isFinite(input.energy) || input.energy <= 0 || typeof input.received !== "number" || !Number.isFinite(input.received) || input.received <= 0) throw new AppError(400,"尚未收到有声回复。");
    await this.checkModel(session.settings.model,"available",session.authType ?? null);
    return { verified: true };
  }
  emit<K extends keyof EventPayloads>(id: string, event: K, data: EventPayloads[K]) { this.sessions.get(id)?.events.emit(event,data); }
  async control(id: string, value: unknown) {
    const session = this.sessions.get(id), action = text(object(value).action,30);
    if (!session || session.ended || !session.threadId) throw new AppError(409,"语音尚未连接，请重新开始。");
    if (!["stop","pause","resume"].includes(action)) throw new AppError(400,"未知的语音操作。");
    const rpc = await this.native(), turnId = session.activeTurnId;
    session.suspended = action !== "resume";
    clearTimeout(session.turnTimer);
    if (turnId) await rpc.request("turn/interrupt",{threadId:session.threadId,turnId});
    if (session.activeTurnId === turnId) session.activeTurnId = undefined;
    await this.appendText(id,action === "resume"
      ? "[语音控制] 继续对话。保持安静，等待用户重新开口；不要接续已经停止的任务，不要重读旧回复，也不要口头确认本条控制消息。"
      : "[语音控制] 立即停止当前回复和后台任务。保持安静，不要说稍等、正在整理或停止确认；等待客户端通知继续后，再听用户新的请求。", "developer");
    this.emit(id,"voice-activity",{activity:action === "resume" ? "listening" : action === "pause" ? "paused" : "stopped"});
    return {action,interruptedTurnId:turnId ?? null};
  }
  async appendText(id: string, value: string, role: "user" | "developer" = "developer") {
    const session = this.sessions.get(id);
    if (!session || session.ended || !session.threadId) throw new AppError(409,"语音尚未连接，请重新开始。");
    const rpc = await this.native();
    await rpc.request("thread/realtime/appendText",{threadId:session.threadId,text:value,role});
  }
  async appendSpeech(id: string, value: string) {
    const session = this.sessions.get(id);
    if (!session || session.ended || !session.threadId) throw new AppError(409,"语音尚未连接，请重新开始。");
    const rpc = await this.native();
    await rpc.request("thread/realtime/appendSpeech",{threadId:session.threadId,text:value});
  }
  async startPreview(value: unknown, language: Locale) {
    const input = object(value), settings = voiceSettings(input,await this.catalog(),{...DEFAULT_VOICE_SETTINGS,language});
    return this.start({...input,...settings},settings.language,{
      prompt:"本次仅试听音色。先保持安静，收到试听文本后只朗读该文本。不要提问、补充说明或等待候选人回答。",
      previewText:VOICE_PREVIEW_TEXT[settings.language],
    });
  }
  async preview(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.ended || !session.context?.previewText) throw new AppError(409,"这不是音色试听会话，请重新试听。");
    if (!session.previewStarted) {
      session.previewStarted = true;
      session.previewTimer = setTimeout(() => { void this.end(id); },30000);
      await this.appendSpeech(id,session.context.previewText);
    }
    return {started:true};
  }
  private transcript(session: Session, role: unknown, value: unknown, done: boolean, itemId?: string) {
    if (typeof value !== "string" || !value || !["user","assistant"].includes(String(role))) return;
    if (session.suspended && role === "assistant") return;
    // Native "done" commits a transcript part, not the whole spoken response.
    const line: VoiceTranscript = {role:role as VoiceTranscript["role"],text:value.slice(0,15000),done,source:"segment",...(itemId ? {itemId} : {})};
    if (done && session.lastTranscript?.done && session.lastTranscript.role === line.role && session.lastTranscript.text === line.text && (!itemId || !session.lastTranscript.itemId || itemId === session.lastTranscript.itemId)) return;
    if (done) session.lastTranscript = line;
    session.events.emit("transcript",line); session.context?.onTranscript?.(line);
    if (done && line.role === "user" && !session.context && !session.suspended) {
      const intent = classifyVoiceIntent(line.text);
      if (intent === "stop" || intent === "pause" || intent === "resume") this.emit(session.id,"voice-control",{action:intent});
    }
  }
  async start(value: unknown, language: Locale = "zh", context?: VoiceContext) {
    const input = object(value), id = text(input.id,100), sdp = text(input.sdp,64000);
    if (!/^[\w-]{8,100}$/.test(id) || !sdp.startsWith("v=0") || !/m=audio\s/.test(sdp)) throw new AppError(400, "语音连接参数无效。");
    if (this.session && !this.session.ended) throw new AppError(409, "已有语音通话，请先结束当前通话。");
    if (this.sessions.has(id)) throw new AppError(409, "这次语音连接已发送，请重新连接。");
    for (const [oldId, session] of this.sessions) if (session.ended) { session.events.close(); this.sessions.delete(oldId); }
    const session: Session = { id, events: new Events(), ended: false, context };
    this.session = session; this.sessions.set(id,session);
    let rpc: VoiceRpc | undefined;
    try {
      rpc = await this.native();
      const status = await this.status();
      if (!status.authenticated) throw new AppError(401, "请先在终端运行 codex login，登录 Codex CLI；页面顶部的 Pi 登录与此 Demo 独立。");
      session.authType = status.authType;
      if (input.model !== undefined || input.voice !== undefined || input.tone !== undefined || input.language !== undefined) session.settings = voiceSettings(input, await this.catalog(),{...DEFAULT_VOICE_SETTINGS,language});
      language = session.settings?.language ?? language;
      const model = session.settings ? voiceModel(session.settings.model) : undefined;
      if (session.ended) throw new AppError(409, "语音连接已取消。");
      const workspace = resolve(this.dataDir, "voice-demo", "workspace");
      await mkdir(workspace, { recursive: true });
      const thread = await rpc.request("thread/start", {
        ephemeral: true, cwd: workspace, sandbox: "read-only", approvalPolicy: "never", environments: [],
        baseInstructions: `${outputLanguageInstruction(language)}\n你是用户的语音对话助手。只进行对话，简短自然地回答，不使用工具，不访问或修改文件。保持本次对话的上下文。\n${context?.instructions ?? ""}`,
        config: { model_reasoning_effort: "low", "features.apps": false, "features.plugins": false },
      });
      session.threadId = thread.thread.id;
      if (session.ended) throw new AppError(409, "语音连接已取消。");
      // Register before starting: SDP/error notifications can precede the RPC acknowledgement.
      const answer = new Promise<string>((resolveAnswer,rejectAnswer) => {
        const timer = setTimeout(() => rejectAnswer(new AppError(504,"语音协商超时，请检查网络后重试。")), this.timeout);
        const fail = (message: string) => { clearTimeout(timer); rejectAnswer(new AppError(502,voiceError(message))); };
        session.cancel = () => fail("语音连接已取消。");
        session.unsubscribe = rpc!.subscribe(event => {
          if (event.method !== "voice/processExited" && (!('threadId' in event.params) || event.params.threadId !== session.threadId)) return;
          if (session.ended) return;
          if (event.method === "turn/started") {
            const turn = event.params.turn as {id?:string} | undefined;
            if (!turn?.id) return;
            if (session.suspended) { session.activeTurnId = turn.id; void rpc!.request("turn/interrupt",{threadId:session.threadId!,turnId:turn.id}).catch(error => this.emit(id,"voice-activity",{activity:"failed",message:voiceError(error)})); return; }
            session.activeTurnId = turn.id; clearTimeout(session.turnTimer);
            this.emit(id,"voice-activity",{activity:"thinking",turnId:turn.id});
            session.turnTimer = setTimeout(() => {
              void this.control(id,{action:"stop"}).then(() => this.emit(id,"voice-activity",{activity:"timeout",message:"本轮处理超时，已停止。点击继续对话后重新开口。"})).catch(error => this.emit(id,"voice-activity",{activity:"failed",message:voiceError(error)}));
            },45000);
          } else if (event.method === "turn/completed") {
            const turn = event.params.turn as {id?:string;status?:string;error?:{message?:string}} | undefined;
            if (!turn?.id || turn.id !== session.activeTurnId) return;
            clearTimeout(session.turnTimer); session.activeTurnId = undefined;
            this.emit(id,"voice-activity",{activity:turn.status === "failed" || turn.error ? "failed" : turn.status === "interrupted" ? "stopped" : "processing",message:turn.error?.message ? voiceError(turn.error.message) : turn.status === "failed" ? "后台处理失败，请停止本轮后重新开口。" : ""});
          } else if (event.method === "error" && session.activeTurnId && event.params.willRetry !== true) {
            clearTimeout(session.turnTimer); session.activeTurnId = undefined;
            const error = event.params.error as {message?:string} | undefined;
            this.emit(id,"voice-activity",{activity:"failed",message:voiceError(error?.message ?? "后台处理失败，请停止本轮后重新开口。")});
          } else if (event.method === "thread/realtime/sdp" && typeof event.params.sdp === "string") { clearTimeout(timer); resolveAnswer(event.params.sdp); }
          else if (event.method === "thread/realtime/error" || event.method === "voice/processExited") {
            const message = voiceError(event.params.message ?? "语音连接失败。");
            session.failure = message;
            session.events.emit("voice-error", { message }); fail(message); void this.end(id);
          } else if (event.method === "thread/realtime/closed") { fail("语音会话已关闭。"); void this.end(id); }
          else if (event.method === "thread/realtime/transcript/delta" || event.method === "thread/realtime/transcript/done") {
            if (!session.canonicalTranscripts) { session.flatTranscripts = true; this.transcript(session,event.params.role,event.method === 'thread/realtime/transcript/done' ? event.params.text : event.params.delta,event.method.endsWith("done")); }
          } else if (event.method === "thread/realtime/item/started" || event.method === "thread/realtime/item/completed") {
            const item = event.params.item as {type?:string;id?:string;role?:VoiceTranscript["role"];text?:string} | undefined;
            if (item?.type !== "transcriptSegment" || typeof item.id !== "string" || !["user","assistant"].includes(item.role ?? "")) return;
            // Keep the first transcript stream for this call. Switching after a
            // flat commit would replay its canonical deltas as a second part.
            if (session.flatTranscripts) return;
            session.canonicalTranscripts = true;
            const items = session.transcriptItems ??= new Map(), done = event.method.endsWith("completed");
            if (items.get(item.id)?.done) return;
            items.set(item.id,{role:item.role!,done});
            if (items.size > 100) items.delete(items.keys().next().value!);
            this.transcript(session,item.role,item.text,done,item.id);
          } else if (event.method === "thread/realtime/item/transcript/delta") {
            const itemId = event.params.itemId, item = typeof itemId === "string" ? session.transcriptItems?.get(itemId) : undefined;
            if (item && !item.done) this.transcript(session,item.role,event.params.delta,false,itemId as string);
          } else if (event.method === "thread/realtime/itemAdded") {
            const item = event.params.item as { type?: string; role?: string; text?: string } | undefined;
            if (!session.canonicalTranscripts && item?.type === "transcriptSegment") { session.flatTranscripts = true; this.transcript(session,item.role,item.text,true); }
          }
        });
        void rpc!.request("thread/realtime/start", {
          threadId: session.threadId!, version: model?.version ?? "v3", outputModality: "audio", transport: { type: "webrtc", sdp },
          ...(session.settings ? {model:session.settings.model,voice:session.settings.voice} : {}),
          includeStartupContext: false, flushTranscriptTailOnSessionEnd: false,
          // Deliver the result as spoken content; keep waiting fillers out of the interview.
          codexResponseHandoffMode: "commentary", delegationAckFiller: false,
          prompt: `${outputLanguageInstruction(language)}\n${session.settings ? VOICE_TONES[session.settings.tone].instruction : ""}\n${context?.prompt ?? "与用户自然地轮流交流。用口语短句，先接住当前问题，一次说一个重点；通常一到三句话，不机械重复相同开场。记住本次对话的内容。等待用户先开口。用户说到一半、停顿思考或说还没说完时，保持安静等其继续；不要把句中停顿当成新问题或结束。用户插话时停止旧回复，先听新的内容。"}`,
        }).catch(error => fail(voiceError(error)));
      });
      const remoteSdp = await answer;
      session.cancel = undefined;
      if (session.ended) throw new AppError(409,"语音连接已取消。");
      session.disconnectTimer = setTimeout(() => { void this.end(id); }, 20000);
      return { id, sdp: remoteSdp };
    } catch (error) {
      if (session.settings && session.threadId && (session.failure || !session.ended)) await this.checkModel(session.settings.model,"failed",session.authType ?? null,session.failure ?? voiceError(error)).catch(() => {});
      await this.end(id);
      // A canceled start can finish creating its native thread after end().
      if (rpc && session.threadId) {
        await rpc.request("thread/realtime/stop", { threadId: session.threadId }).catch(() => {});
        await rpc.request("thread/unsubscribe", { threadId: session.threadId }).catch(() => {});
      }
      throw error;
    }
  }
  connect(id: string, response: ServerResponse, after: number) {
    const session = this.sessions.get(id);
    if (!session || session.ended) throw new AppError(404,"语音会话已结束，请重新连接。");
    clearTimeout(session.disconnectTimer);
    session.events.connect(response,after);
    response.on("close", () => { if (!session.ended) session.disconnectTimer = setTimeout(() => { void this.end(id); },10000); });
  }
  async end(id: string) {
    const session = this.sessions.get(id);
    if (session?.ending) return session.ending;
    if (!session || session.ended) return;
    session.ended = true; session.cancel?.(); session.cancel = undefined;
    clearTimeout(session.disconnectTimer); clearTimeout(session.previewTimer); clearTimeout(session.turnTimer); session.unsubscribe?.();
    if (this.session === session) this.session = undefined;
    session.ending = (async () => {
      try { await session.context?.onEnd?.(); }
      catch { session.events.emit("voice-error",{message:"语音转写保存失败，请检查本地记录。"}); }
      session.events.emit("ended", {}); session.events.close();
      const rpc = await this.rpc?.catch(() => undefined);
      if (rpc && session.threadId) {
        if (session.activeTurnId) await rpc.request("turn/interrupt",{threadId:session.threadId,turnId:session.activeTurnId}).catch(() => {});
        await rpc.request("thread/realtime/stop", { threadId: session.threadId }).catch(() => {});
        await rpc.request("thread/unsubscribe", { threadId: session.threadId }).catch(() => {});
      }
    })();
    return session.ending;
  }
  async close() {
    if (this.session) await this.end(this.session.id);
    for (const session of this.sessions.values()) { clearTimeout(session.disconnectTimer); session.events.close(); }
    const rpc = await this.rpc?.catch(() => undefined);
    this.rpc = undefined;
    await rpc?.close();
  }
}
