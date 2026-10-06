import type { Locale } from './locales.ts';
import { authoredMessageKey, formatMessage, type MessageKey, type MessageArgs } from './generated/localizations.ts';

/** Compatibility for authored server catalogs/errors; user documents never pass here. */
export function translateSource(source: string, locale: Locale): string {
  const key = authoredMessageKey(source.trim());
  return key ? formatMessage(locale, key) : source;
}
export function translateMessage<K extends MessageKey>(key: K, locale: Locale, ...args: MessageArgs<K>): string {
  return formatMessage(locale, key, ...args);
}
