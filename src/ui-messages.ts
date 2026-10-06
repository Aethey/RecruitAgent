import en from '../public/locales/en.json' with { type: 'json' };
import ja from '../public/locales/ja.json' with { type: 'json' };
import zh from '../public/locales/zh.json' with { type: 'json' };
import type { Locale } from './locales.ts';
import { mapSource } from './ui-source.ts';

const dictionaries: Partial<Record<Locale, Record<string, string>>> = { en, ja };

/** For authored interface messages only, never for user code, documents or model output. */
export function translateSource(source: string, locale: Locale, markup = false): string {
  const messages = dictionaries[locale];
  if (!messages) return source;
  return mapSource(source, markup, text => Object.hasOwn(messages, text) ? messages[text] : text);
}

/** Stable keys for messages containing variables; substituted values are never translated. */
export function translateMessage(key: keyof typeof zh, locale: Locale, params: Record<string, string | number> = {}): string {
  const source = dictionaries[locale]?.[key] ?? zh[key];
  if (source === undefined) throw new Error(`Unknown UI message: ${key}`);
  return source.replace(/\{([a-zA-Z][\w]*)\}/g, (_, name: string) => {
    if (!Object.hasOwn(params, name)) throw new Error(`Missing parameter ${name} for ${key}`);
    return String(params[name]);
  });
}
