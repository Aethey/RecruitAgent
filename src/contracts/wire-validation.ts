import * as validators from '../generated/wire-validators.mjs';
import { routes } from '../generated/registry.mjs';
import type { ValidateFunction } from 'ajv';
import type { EventPayloads } from './api.ts';

const available: Record<string, ValidateFunction> = validators;
export function validateEvent<K extends keyof EventPayloads>(kind: K, value: unknown): EventPayloads[K] {
  if (!available[`event_${kind.replaceAll('-', '_')}`]?.(value)) throw new Error(`Invalid event payload: ${kind}`);
  return value as EventPayloads[K];
}
const matchers = Object.values(routes).map(route => ({ route, pattern: new RegExp('^' + route.path.replace(/\{[^}]+\}/g, '[\\w-]+') + '$') }));
export function apiContract(method: string, path: string) {
  return matchers.find(entry => entry.route.method === method && entry.pattern.test(path))?.route;
}
export function validateApiValue(name: string, value: unknown): boolean { return !!available[name]?.(value); }
