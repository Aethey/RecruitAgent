import { randomUUID } from "node:crypto";
import { AppError } from "./domain.ts";
import { Events } from "./events.ts";
import type { AI, LoginInteraction } from "./pi.ts";

type Prompt = Parameters<LoginInteraction["prompt"]>[0];
type Login = {
  id: string; status: "pending" | "done" | "error" | "cancelled"; events: Events;
  controller: AbortController; promise: Promise<void>;
  answer?: { id: string; resolve(value: string): void };
};
export class Auth {
  private current?: Login;
  constructor(private ai: AI) {}
  get(id: string) {
    if (this.current?.id !== id) throw new AppError(404, "登录流程已过期，请重新连接。");
    return this.current;
  }
  start() {
    if (this.current?.status === "pending") return this.current;
    this.current?.events.close();
    const controller = new AbortController();
    const login: Login = { id: randomUUID(), status: "pending", events: new Events(), controller, promise: Promise.resolve() };
    this.current = login;
    const timer = setTimeout(() => controller.abort(new Error("登录超时")), 15 * 60 * 1000);
    login.promise = this.ai.login({
      signal: controller.signal,
      prompt: (prompt: Prompt) => {
        if (prompt.type === "select") {
          const option = prompt.options.find(o => o.id === "browser") ?? prompt.options[0];
          if (!option) return Promise.reject(new Error("No login method"));
          return Promise.resolve(option.id);
        }
        // Never ask the browser for access tokens, refresh tokens or API keys.
        if (prompt.type !== "manual_code" && prompt.type !== "text") return Promise.reject(new Error("Unsupported credential prompt"));
        const id = randomUUID();
        return new Promise<string>((resolve, reject) => {
          const signal = prompt.signal ?? controller.signal;
          const onAbort = () => {
            login.answer = undefined;
            login.events.emit("prompt_cancelled", { id });
            reject(new Error("登录步骤结束"));
          };
          if (signal.aborted) { onAbort(); return; }
          login.answer = { id, resolve: value => { signal.removeEventListener("abort", onAbort); login.answer = undefined; resolve(value); } };
          signal.addEventListener("abort", onAbort, { once: true });
          login.events.emit("prompt", { id, message: prompt.message });
        });
      },
      notify: event => {
        if (event.type === "auth_url") login.events.emit("auth_url", { url: event.url });
        else if (event.type === "device_code") login.events.emit("device_code", { url: event.verificationUri, code: event.userCode });
        else if (event.type === "progress" || event.type === "info") login.events.emit("progress", { message: event.message });
      },
    }).then(() => {
      login.status = "done";
      login.events.emit("done", { authenticated: true });
    }).catch(() => {
      login.status = controller.signal.aborted ? "cancelled" : "error";
      login.events.emit("error", { message: controller.signal.aborted ? "登录已取消或超时，请重新连接。" : "OAuth 登录失败，请重新连接并完成授权。" });
    }).finally(() => { clearTimeout(timer); login.answer = undefined; });
    return login;
  }
  answer(id: string, promptId: string, value: string) {
    const login = this.get(id);
    if (login.status !== "pending" || login.answer?.id !== promptId) throw new AppError(409, "该授权步骤已结束。");
    login.answer.resolve(value);
  }
  async stop() {
    this.current?.controller.abort();
    await this.current?.promise;
    this.current?.events.close();
  }
}
