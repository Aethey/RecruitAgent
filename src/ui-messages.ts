import en from '../public/locales/en.json' with { type: 'json' };
import ja from '../public/locales/ja.json' with { type: 'json' };
import type { Locale } from './locales.ts';

const dictionaries: Partial<Record<Locale, Record<string, string>>> = { en, ja };
const patterns = Object.fromEntries(Object.entries(dictionaries).map(([locale, messages]) => [locale,
  new RegExp(Object.keys(messages).sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'),
]));
const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** For authored interface messages only, never for user code, documents or model output. */
export function translateSource(source: string, locale: Locale, markup = false): string {
  const messages = dictionaries[locale];
  if (!messages) return source;
  if (Object.hasOwn(messages, source)) return markup ? escapeHTML(messages[source]) : messages[source];
  return source.replace(patterns[locale], key => markup ? escapeHTML(messages[key]) : messages[key]);
}
