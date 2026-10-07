import type { ClientRequest } from '../../generated/codex/ClientRequest.js';
import type { ServerNotification } from '../../generated/codex/ServerNotification.js';
import type { RpcResponses } from '../../generated/codex/rpc-responses.js';

/** Only methods used by this adapter. Shapes and associations come from the pinned CLI. */
export type RpcMethod = 'initialize' | 'account/read' | 'thread/start' | 'thread/unsubscribe' | 'turn/interrupt' | 'thread/realtime/listVoices' | 'thread/realtime/start' | 'thread/realtime/stop' | 'thread/realtime/appendText' | 'thread/realtime/appendSpeech';
export type RpcParams<M extends RpcMethod> = Extract<ClientRequest, { method: M }>['params'];
export type RpcResult<M extends RpcMethod> = RpcResponses[M];
export type NativeNotification = Extract<ServerNotification, { method: 'turn/started' | 'turn/completed' | 'error' | 'thread/realtime/sdp' | 'thread/realtime/error' | 'thread/realtime/closed' | 'thread/realtime/transcript/delta' | 'thread/realtime/transcript/done' | 'thread/realtime/item/started' | 'thread/realtime/item/completed' | 'thread/realtime/item/transcript/delta' | 'thread/realtime/itemAdded' }>;
export type Notification = NativeNotification | { method: 'voice/processExited'; params: { message: string } };
export interface NativeContracts {
  requests: { [M in RpcMethod]: RpcParams<M> };
  responses: { [M in RpcMethod]: RpcResult<M> };
  notification: NativeNotification;
}
