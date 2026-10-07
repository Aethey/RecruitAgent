import type { VoiceRpc } from "../src/integrations/codex/voice.ts";

type Notification = Parameters<VoiceRpc["subscribe"]>[0] extends (event: infer N) => void ? N : never;
export class FakeVoiceRpc implements VoiceRpc {
  calls: { method: string; params: any }[] = [];
  listeners = new Set<(event: Notification) => void>();
  mode: "normal" | "error" | "wait" = "normal";
  authenticated = true;
  closed = false;
  threadGate?: Promise<void>;
  async request<T = Record<string, unknown>>(method: string, params: any): Promise<T> {
    this.calls.push({ method, params });
    if (method === "account/read") return { account: this.authenticated ? { type: "chatgpt", email: "private@example.test", accessToken: "PRIVATE_CREDENTIAL" } : null } as T;
    if (method === "thread/realtime/listVoices") return { voices: {
      v1: ["juniper","maple","spruce","ember","vale","breeze","arbor","sol","cove"],
      v2: ["alloy","ash","ballad","coral","echo","sage","shimmer","verse","marin","cedar"], defaultV1: "cove", defaultV2: "marin",
    } } as T;
    if (method === "thread/realtime/appendSpeech") this.emit("thread/realtime/transcript/done", { threadId: "native-thread", role: "assistant", text: params.text });
    if (method === "thread/start") { await this.threadGate; return { thread: { id: "native-thread" } } as T; }
    if (method === "thread/realtime/start") {
      if (this.mode === "normal") this.emit("thread/realtime/sdp", { threadId: "native-thread", sdp: "REMOTE_ANSWER" });
      if (this.mode === "error") this.emit("thread/realtime/error", { threadId: "native-thread", message: "Denied Bearer SECRET_VALUE sk-secret_123" });
    }
    return {} as T;
  }
  // Deliberately permits partial/malformed notifications for adapter recovery tests.
  emit(method: string, params: Record<string, unknown>) { for (const listener of this.listeners) listener({ method, params } as Notification); }
  subscribe(listener: (event: Notification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async close() { this.closed = true; }
}
