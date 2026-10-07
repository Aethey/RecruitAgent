import type { ServerResponse } from "node:http";
import type { EventPayloads } from '../contracts/api.ts';
import { validateEvent } from '../contracts/validation.ts';

type Event = { id: number; type: string; data: unknown };
export class Events {
  private items: Event[] = [];
  private listeners = new Set<ServerResponse>();
  private sequence = 0;
  private frame(event: Event) { return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`; }
  emit<K extends keyof EventPayloads>(type: K, data: EventPayloads[K]) {
    validateEvent(type, data);
    const event = { id: ++this.sequence, type, data };
    this.items.push(event);
    // Domain results are on GET endpoints. Retain only a bounded progress buffer.
    if (this.items.length > 100) this.items.shift();
    for (const response of this.listeners) {
      if (response.writableLength > 1024 * 1024) { response.destroy(); this.listeners.delete(response); }
      else response.write(this.frame(event));
    }
  }
  connect(response: ServerResponse, after = 0) {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    response.write("retry: 1500\n\n");
    for (const event of this.items) if (event.id > after) response.write(this.frame(event));
    this.listeners.add(response);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    response.on("close", () => { clearInterval(heartbeat); this.listeners.delete(response); });
  }
  close() { for (const response of this.listeners) response.end(); this.listeners.clear(); }
}
