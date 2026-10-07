import { formatMessage } from "../../generated/localizations.ts";
import { translateSource, translateMessage } from "../i18n/messages.ts";
import { outputLanguageInstruction, type Locale } from "../i18n/locales.ts";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.ts";
import { Events } from "../events.ts";
import type { AI, AIImage, AIMode } from "../ai/types.ts";
import type { TaskResult } from "../../contracts/api.ts";
import { Store } from "../persistence/store.ts";

export type TaskKind =
  | "training"
  | "generate"
  | "hint"
  | "review"
  | "analysis"
  | "language"
  | "interview"
  | "interview-review"
  | "library"
  | "study"
  | "study-review"
  | "study-import"
  | "chat"
  | "teacher";
export type TaskDefinition = {
  message: string;
  mode: AIMode;
  timeoutMs: number;
};
export type Job = {
  id: string;
  userLanguage: Locale;
  kind: TaskKind;
  chatId?: string;
  status: "running" | "done" | "error" | "aborted";
  events: Events;
  controller: AbortController;
  promise: Promise<void>;
  result?: TaskResult;
  error?: string;
};

export class Tasks {
  private jobs = new Map<string, Job>();
  private active?: Job;
  constructor(
    private ai: AI,
    private store: Store,
    private definition: (kind: TaskKind) => TaskDefinition,
  ) {}
  get(id: string) {
    const job = this.jobs.get(id);
    if (!job)
      throw new AppError(
        404,
        formatMessage("zh", "ui.theTaskDoesNotExistOrHasExpired"),
      );
    return job;
  }
  activeJob() {
    return this.active
      ? {
          id: this.active.id,
          kind: this.active.kind,
          ...(this.active.chatId ? { chatId: this.active.chatId } : {}),
        }
      : null;
  }
  async start(
    kind: TaskKind,
    work: (
      ask: (
        prompt: string,
        images?: AIImage[],
        onText?: (delta: string, cumulativeText?: string) => void,
      ) => Promise<string>,
      signal: AbortSignal,
      job: Job,
    ) => Promise<TaskResult>,
    details?: { chatId: string },
  ) {
    if (this.active)
      throw new AppError(
        409,
        formatMessage("zh", "ui.processingThePreviousTaskPleaseWaitOrCancel"),
      );
    const definition = this.definition(kind);
    const preferences = this.store.snapshot().settings;
    const userLanguage = preferences?.userLanguage ?? "zh",
      uiLanguage = preferences?.uiLanguage ?? "zh";
    const message = (source: string) => translateSource(source, uiLanguage);
    // Reserve the slot before the asynchronous credential check.
    const job: Job = {
      id: randomUUID(),
      userLanguage,
      kind,
      ...details,
      status: "running",
      events: new Events(),
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    this.active = job;
    try {
      if (!(await this.ai.status()).authenticated)
        throw new AppError(
          401,
          formatMessage("zh", "ui.pleaseConnectYourCodexSubscriptionFirst"),
        );
    } catch (error) {
      this.active = undefined;
      throw error;
    }
    this.jobs.set(job.id, job);
    if (this.jobs.size > 100) {
      const oldest = this.jobs.keys().next().value!;
      this.jobs.get(oldest)?.events.close();
      this.jobs.delete(oldest);
    }
    job.events.emit("progress", { message: message(definition.message) });
    let lastProgress = 0;
    const timer = setTimeout(
      () => job.controller.abort(new Error("timeout")),
      definition.timeoutMs,
    );
    job.promise = Promise.resolve()
      .then(() =>
        work(
          (prompt, images, onText) =>
            this.ai.ask(
              `${prompt}\n\n${outputLanguageInstruction(userLanguage)}`,
              job.controller.signal,
              (characters, delta, cumulativeText) => {
                if (delta !== undefined) onText?.(delta, cumulativeText);
                if (Date.now() - lastProgress < 500) return;
                lastProgress = Date.now();
                job.events.emit("progress", {
                  message: translateMessage("task.generating", uiLanguage, {
                    count: characters,
                  }),
                });
              },
              definition.mode,
              images,
              userLanguage,
            ),
          job.controller.signal,
          job,
        ),
      )
      .then((result) => {
        job.result = result;
        job.status = "done";
        job.events.emit("done", { result });
      })
      .catch((error) => {
        if (job.controller.signal.aborted) {
          job.status = "aborted";
          job.events.emit("aborted", {
            message: message(
              job.controller.signal.reason?.message === "timeout"
                ? formatMessage("zh", "ui.requestTimedOutAndWasCanceledYouCan")
                : formatMessage("zh", "ui.canceledExistingRecordsAreKept"),
            ),
          });
        } else {
          job.status = "error";
          job.error = message(
            error instanceof AppError
              ? error.message
              : formatMessage(
                  "zh",
                  "ui.requestFailedPleaseCheckTheNetworkOrReconnect",
                ),
          );
          job.events.emit("error", { message: job.error });
        }
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.active === job) this.active = undefined;
      });
    return job;
  }
  async abort(id: string) {
    const job = this.get(id);
    if (job.status === "running") {
      job.controller.abort();
      await job.promise;
    }
  }
  async stop() {
    if (this.active) await this.abort(this.active.id);
    for (const job of this.jobs.values()) job.events.close();
  }
}
