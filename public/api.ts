import type { ApiClient, TaskPath } from '../src/generated/api-client.js';
import type { ApiEndpoints, EventPayloads, TaskStarted } from '../src/contracts.ts';
import { routes } from '../src/generated/registry.mjs';
import { apiContract, validateApiValue, validateEvent } from '../src/wire-validation.ts';

async function checkedResponse(contract: { response: string }, response: Response, translateError: (message: string) => string): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '请求失败，请重试。';
    throw new Error(translateError(message));
  }
  if (!validateApiValue(contract.response, data)) throw new Error(translateError('接口返回的数据格式不正确。'));
  return data;
}

/** Uploads and keepalive requests retain their transport while sharing generated response validation. */
export async function readApiResponse<K extends keyof ApiEndpoints>(key: K, response: Response, translateError: (message: string) => string = value => value): Promise<ApiEndpoints[K]['response']> {
  return await checkedResponse(routes[key], response, translateError) as ApiEndpoints[K]['response'];
}

export function createApiClient(translateError: (message: string) => string = value => value): ApiClient {
  return (async (path: string, method = 'GET', body?: unknown) => {
    const pathname = new URL(path, 'http://localhost').pathname;
    const contract = apiContract(method, pathname);
    if (!contract) throw new Error(translateError('接口不存在。'));
    if (contract.request && !validateApiValue(contract.request, body)) throw new Error(translateError('请求的数据结构不正确。'));
    const response = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return checkedResponse(contract, response, translateError);
  }) as ApiClient;
}

/** Dynamic task dispatch still verifies the selected endpoint and its body at runtime. */
export async function requestTask(api: ApiClient, path: TaskPath, body: unknown): Promise<TaskStarted> {
  const contract = apiContract('POST', path);
  if (!contract?.request || !validateApiValue(contract.request, body)) throw new Error('请求的数据结构不正确。');
  // Every TaskPath is generated from an endpoint whose response contains jobId.
  const send = api as (path: TaskPath, method: 'POST', body: unknown) => Promise<TaskStarted>;
  return send(path, 'POST', body);
}
export function eventData<K extends keyof EventPayloads>(kind: K, event: { data: string }): EventPayloads[K] {
  return validateEvent(kind, JSON.parse(event.data));
}
