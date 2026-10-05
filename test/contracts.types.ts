// Compile-only regression cases. These expectations must fail if codegen loses precision.
import type { ApiClient } from '../src/generated/api-client.js';
import type { VoiceRpc } from '../src/codex-voice.ts';
import { Events } from '../src/events.ts';

export async function contractTypeChecks(api: ApiClient, rpc: VoiceRpc, events: Events) {
  const settings = await api('/api/settings');
  settings.userLanguage satisfies 'zh' | 'ja' | 'en';
  // @ts-expect-error Generated responses must not become any or unknown dictionaries.
  settings.nonexistent;
  // @ts-expect-error Unknown API paths are rejected.
  await api('/api/does-not-exist');
  // @ts-expect-error Wrong method is rejected.
  await api('/api/settings', 'DELETE');
  // @ts-expect-error Invalid enum is rejected.
  await api('/api/settings', 'PUT', { userLanguage: 'fr' });
  // @ts-expect-error Wrong field type is rejected.
  await api('/api/problems/example', 'PUT', { code: 123 });
  // @ts-expect-error Required body fields are enforced.
  await api('/api/trainings/example/next', 'POST', { answer: 'answer' });
  const problem = await api('/api/problems/example');
  problem.examples[0].output satisfies string;
  // @ts-expect-error Nested response shapes are preserved.
  problem.examples[0].output satisfies number;
  const voices = await api('/api/voice/options');
  voices.tones.natural satisfies string;
  // @ts-expect-error CLI protocol methods are checked.
  await rpc.request('unknown/method', {});
  // @ts-expect-error Official CLI protocol parameter types are checked.
  await rpc.request('turn/interrupt', { threadId: 123, turnId: 'turn' });
  const result = await rpc.request('account/read', {});
  result.requiresOpenaiAuth satisfies boolean;
  // @ts-expect-error Official response fields are checked.
  result.nonexistent;
  // @ts-expect-error Unknown SSE events are rejected.
  events.emit('missing', {});
  // @ts-expect-error SSE payload types are checked.
  events.emit('transcript', { role: 'user', text: 'hello', done: 'yes' });
}
