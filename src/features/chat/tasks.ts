import { formatMessage } from "../../generated/localizations.ts";
import { AppError } from "../../shared/errors.ts";
import type { AI } from "../../shared/ai/types.ts";
import { Chat, type ChatTurn } from "./service.ts";
import { Tasks } from "../../shared/tasks/executor.ts";

export class ChatTasks {
  constructor(
    private tasks: Tasks,
    private ai: AI,
  ) {}
  chat(chats: Chat, id: string, value: unknown, retry = false) {
    const turn = chats.prepare(id, value, retry),
      prompt = chats.prompt(id, turn);
    return this.reply(chats, id, turn, prompt, "chat", retry);
  }
  teacher(chats: Chat, id: string, value: unknown) {
    const turn = chats.prepareTeacher(id, value);
    return this.reply(
      chats,
      id,
      turn,
      chats.teacherPrompt(id, turn),
      "teacher",
    );
  }
  private reply(
    chats: Chat,
    id: string,
    turn: ChatTurn,
    prompt: string,
    kind: "chat" | "teacher",
    retry = false,
  ) {
    return this.tasks.start(
      kind,
      async (ask, signal, job) => {
        signal.throwIfAborted();
        turn.model = (await this.ai.status()).model;
        await chats.begin(id, turn, retry);
        job.events.emit("chat-start", { chatId: id, turn });
        let assistant = "",
          lastSaved = 0,
          lastSent = 0,
          pending: Promise<void> = Promise.resolve();
        const stream = (delta: string, cumulativeText?: string) => {
          assistant = cumulativeText ?? assistant + delta;
          chats.stream(id, turn.id, assistant);
          if (Date.now() - lastSent >= 50) {
            lastSent = Date.now();
            job.events.emit("message", {
              chatId: id,
              turnId: turn.id,
              text: assistant,
            });
          }
          if (Date.now() - lastSaved >= 1000) {
            lastSaved = Date.now();
            const snapshot = assistant;
            pending = pending.then(() =>
              chats.save(id, turn.id, { assistant: snapshot }),
            );
            // A failed disk write is handled by the final await, without an unhandled rejection.
            void pending.catch(() => {});
          }
        };
        try {
          const output = await ask(prompt, undefined, stream);
          signal.throwIfAborted();
          await pending;
          await chats.save(id, turn.id, {
            assistant: output,
            status: "done",
            error: undefined,
          });
          job.events.emit("message", {
            chatId: id,
            turnId: turn.id,
            text: output,
          });
          return { chatId: id, turnId: turn.id };
        } catch (error) {
          await pending.catch(() => {});
          const message = signal.aborted
            ? signal.reason?.message === "timeout"
              ? formatMessage("zh", "chat.replyTimedOut")
              : formatMessage("zh", "chat.generationStopped")
            : error instanceof AppError
              ? error.message
              : formatMessage("zh", "chat.replyFailed");
          await chats.save(id, turn.id, {
            assistant,
            status: signal.aborted ? "aborted" : "error",
            error: message,
          });
          job.events.emit("message", {
            chatId: id,
            turnId: turn.id,
            text: assistant,
          });
          throw error;
        }
      },
      { chatId: id },
    );
  }
}
