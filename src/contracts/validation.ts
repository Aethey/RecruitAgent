import { formatMessage } from '../generated/localizations.ts';
import * as validators from '../generated/validators.mjs';
import type { ValidateFunction } from 'ajv';
import type { ModelOutputs, BackupArchive } from './api.ts';
import type { State } from '../shared/persistence/state.ts';
import type { RpcMethod, RpcParams, RpcResult, NativeNotification } from '../integrations/codex/protocol.ts';
export { apiContract, validateApiValue, validateEvent } from './wire-validation.ts';

// Generated validators are the only trust boundary casts. They never coerce or modify data.
const available: Record<string, ValidateFunction> = validators;
export function modelValue<K extends keyof ModelOutputs>(kind: K, value: unknown): ModelOutputs[K] {
  if (!available[`model_${kind}`]?.(value)) throw new Error(`Invalid model output: ${kind}`);
  return value as ModelOutputs[K];
}
export function stateValue(value: unknown): State {
  if (!validators.validateState(value)) throw new Error('Invalid persisted state');
  return value;
}
export function archiveValue(value: unknown): BackupArchive {
  if (!validators.validateArchive(value)) throw new Error(formatMessage('zh', "ui.theBackupFormatOrDataStructureIsIncorrect"));
  return value;
}
export function nativeParams<M extends RpcMethod>(method: M, value: unknown): value is RpcParams<M> {
  return !!available[`native_requests_${method.replaceAll('/', '_')}`]?.(value);
}
export function nativeResult<M extends RpcMethod>(method: M, value: unknown): value is RpcResult<M> {
  return !!available[`native_responses_${method.replaceAll('/', '_')}`]?.(value);
}
export function nativeNotification(value: unknown): NativeNotification | undefined {
  return validators.native_notification(value) ? value : undefined;
}
