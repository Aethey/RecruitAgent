import { formatMessage } from '../../generated/localizations.ts';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { AppError } from '../../shared/errors.ts';
import type { Locale } from '../../shared/i18n/locales.ts';
import { Diagnostics } from '../../shared/diagnostics.ts';
import type { LoginInteraction, ModelOption, AIImage, AIMode, AI } from '../../shared/ai/types.ts';

export class PiAI implements AI {
  private session?: AgentSession;
  private constructor(private runtime: ModelRuntime, private agentDir: string, private modelId: string, private log: Diagnostics, private promptFor: (mode: AIMode, language: Locale) => string) {}
  static async create(dataDir: string, promptFor: (mode: AIMode, language: Locale) => string, log = new Diagnostics(dataDir)) {
    const agentDir = resolve(dataDir, "pi");
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    const runtime = await ModelRuntime.create({ authPath: resolve(dataDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    const modelId = process.env.PI_MODEL ?? "gpt-5.5";
    if (!runtime.getModel("openai-codex", modelId)) throw new Error(`Pi 不包含 Codex 模型 ${modelId}，请设置 PI_MODEL。`);
    return new PiAI(runtime, agentDir, modelId,log,promptFor);
  }
  models(): readonly ModelOption[] {
    return this.runtime.getModels("openai-codex").map(model => ({ id: model.id, name: model.name, vision: model.input.includes("image") }));
  }
  visionModel() {
    const selected = this.models().find(m => m.id === this.modelId && m.vision);
    return selected ?? this.models().find(m => m.vision && /luna/.test(m.id)) ?? this.models().find(m => m.vision);
  }
  setModel(id: string) {
    if (this.session) throw new AppError(409, formatMessage('zh', "ui.pleaseWaitForOrCancelTheCurrentTask"));
    if (!this.runtime.getModel("openai-codex", id)) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseACodexModelFromTheList"));
    this.modelId = id;
  }
  async status() {
    const credential = (await this.runtime.listCredentials()).find(c => c.providerId === "openai-codex");
    return { authenticated: credential?.type === "oauth", provider: "openai-codex", model: this.modelId };
  }
  async login(interaction: LoginInteraction) {
    await this.runtime.login("openai-codex", "oauth", interaction);
    // The returned credential is intentionally never forwarded to the HTTP layer.
  }
  async ask(prompt: string, signal: AbortSignal, progress: (characters: number, delta?: string, cumulativeText?: string) => void, mode: AIMode = "algorithm", images?: AIImage[], userLanguage: Locale = "zh") {
    if (signal.aborted) throw signal.reason;
    if (this.session) throw new AppError(409, formatMessage('zh', "ui.codexIsProcessingAnotherTask"));
    if (!(await this.status()).authenticated) throw new AppError(401, formatMessage('zh', "ui.pleaseConnectYourCodexSubscriptionOnTheWeb"));
    const requestModel = images?.length ? this.visionModel()?.id : this.modelId;
    if (!requestModel) throw new AppError(400, formatMessage('zh', "ui.theCurrentCodexModelCatalogHasNoAvailable"));
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 2 }, compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: this.agentDir, agentDir: this.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => this.promptFor(mode, userLanguage),
    });
    await loader.reload();
    signal.throwIfAborted();
    const { session } = await createAgentSession({
      cwd: this.agentDir, agentDir: this.agentDir, modelRuntime: this.runtime,
      model: this.runtime.getModel("openai-codex", requestModel)!, thinkingLevel: "medium",
      noTools: "all", resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(this.agentDir),
    });
    this.session = session;
    let characters = 0;
    const unsubscribe = session.subscribe(event => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const output = event.assistantMessageEvent.partial.content.filter(block => block.type === "text").map(block => block.text).join("");
        characters = output.length;
        progress(characters, event.assistantMessageEvent.delta, output);
      }
    });
    const abort = () => { void session.abort().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      await session.prompt(prompt, { expandPromptTemplates: false, ...(images?.length ? { images } : {}) });
      signal.throwIfAborted();
      const messages = session.messages;
      const last = messages.findLast(m => m.role === "assistant");
      if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
        this.log.record('text','provider-failed',{model:requestModel,mode,stopReason:last.stopReason,error:last.errorMessage});
        throw new AppError(502, formatMessage('zh', "ui.codexRequestFailedCheckYourSubscriptionPermissionsNetwork"));
      }
      const output = session.getLastAssistantText();
      if (!output) throw new AppError(502, formatMessage('zh', "ui.codexReturnedNoContentPleaseTryAgain"));
      return output;
    } finally {
      signal.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose();
      this.session = undefined;
    }
  }
}
