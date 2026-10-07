import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AI } from './ai/types.ts';

export function diagnosticError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-|ek[-_])[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|password|client[_-]?secret)\s*["']?\s*[:=]\s*)["']?[^\s,;"']+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 1800);
}

function sanitize(value: unknown, key = ''): unknown {
  if (/^(?:.*token|authorization|cookie|.*password|.*secret|.*credential|api[_-]?key|sdp|audio|images?|prompt|instructions|baseInstructions|email|text|content)$/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return diagnosticError(value);
  if (value instanceof Error) return diagnosticError(value);
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([name, item]) => [name, sanitize(item, name)]));
  return value;
}

/** Local, bounded diagnostics; no prompts, transcripts, audio or credentials. */
export class Diagnostics {
  readonly path: string;
  private queue = Promise.resolve();
  private context = new AsyncLocalStorage<{ httpRequestId: string }>();
  private instanceId = randomUUID();
  constructor(dataDir: string, private maxBytes = 5 * 1024 * 1024) { this.path = resolve(dataDir, 'logs', 'codex.jsonl'); }
  run<T>(httpRequestId: string, action: () => T): T { return this.context.run({httpRequestId}, action); }
  record(component: string, event: string, details: Record<string, unknown> = {}) {
    const line = JSON.stringify({at:new Date().toISOString(),pid:process.pid,instanceId:this.instanceId,...this.context.getStore(),component,event,...sanitize(details) as Record<string, unknown>}) + '\n';
    this.queue = this.queue.then(async () => {
      await mkdir(resolve(this.path, '..'), {recursive:true,mode:0o700});
      const size = await stat(this.path).then(info => info.size, () => 0);
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await rm(this.path + '.3', {force:true});
        for (let index = 2; index >= 0; index--) {
          await rename(index ? this.path + '.' + index : this.path, this.path + '.' + (index+1)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
      await appendFile(this.path, line, {mode:0o600});
    }).catch(error => { console.error('Unable to write local Codex diagnostics:', diagnosticError(error)); });
  }
  flush() { return this.queue; }
}

/** Covers every text request across chat, question generation, feedback and study. */
export function loggedAI(ai: AI, log: Diagnostics): AI {
  return {
    models:() => ai.models(), setModel:id => ai.setModel(id), visionModel:() => ai.visionModel(),
    status:() => ai.status(), login:interaction => ai.login(interaction),
    async ask(prompt, signal, progress, mode = 'algorithm', images, userLanguage) {
      const requestId = randomUUID(), started = Date.now();
      let characters = 0, model: string | undefined;
      log.record('text','request',{requestId,mode,promptCharacters:prompt.length,imageCount:images?.length ?? 0,userLanguage});
      try {
        model = images?.length ? ai.visionModel()?.id : (await ai.status()).model;
        log.record('text','model',{requestId,mode,model});
        const output = await ai.ask(prompt,signal,(count,delta,cumulative) => { characters=count; progress(count,delta,cumulative); },mode,images,userLanguage);
        log.record('text','completed',{requestId,mode,model,durationMs:Date.now()-started,responseCharacters:output.length});
        return output;
      } catch (error) {
        log.record('text',signal.aborted ? 'cancelled' : 'failed',{requestId,mode,model,durationMs:Date.now()-started,responseCharacters:characters,error});
        throw error;
      }
    },
  };
}
