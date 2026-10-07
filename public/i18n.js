import { LOCALES, LOCALE_TAGS, isLocale } from '../src/shared/i18n/locales.ts';
import { formatMessage, authoredMessageKey } from '../src/generated/localizations.ts';
export { LOCALES };
const initialInterface = globalThis.document?.documentElement.dataset.uiLanguage;
let interfaceLanguage = isLocale(initialInterface) ? initialInterface : 'zh';
const initialContent = globalThis.document?.documentElement.dataset.userLanguage;
let contentLanguage = isLocale(initialContent) ? initialContent : 'zh';
export const uiLanguage = () => interfaceLanguage;
export const userLanguage = () => contentLanguage;
export const languageTag = () => LOCALE_TAGS[interfaceLanguage];

/** @template {import('../src/generated/localizations.ts').MessageKey} K
 * @param {K} key
 * @param {import('../src/generated/localizations.ts').BrowserMessageArgs<K>} args
 */
export function t(key, ...args) {
  const [params, locale = interfaceLanguage] = /** @type {[Record<string, string | number> | undefined, import('../src/shared/i18n/locales.ts').Locale?]} */ (/** @type {unknown} */ (args));
  return formatMessage(locale, key, .../** @type {import('../src/generated/localizations.ts').MessageArgs<K>} */ ([params]));
}
/** @type {typeof t} */
export const message = t;

/** Application-authored catalogs received through existing API contracts. */
export function catalogText(value, locale = interfaceLanguage) {
  const key = authoredMessageKey(String(value));
  if (key) return formatMessage(locale, key);
  if (/[\u3400-\u9fff]/u.test(String(value))) throw new Error('Unregistered authored catalog message');
  return String(value ?? '');
}
/** Preserve external technical details; known application errors use generated resources. */
export function errorText(value, locale = interfaceLanguage) {
  const key = authoredMessageKey(String(value));
  return key ? formatMessage(locale, key) : String(value ?? '');
}
export function setLanguages(settings) {
  if (isLocale(settings.uiLanguage)) interfaceLanguage = settings.uiLanguage;
  if (isLocale(settings.userLanguage)) contentLanguage = settings.userLanguage;
  if (globalThis.document) {
    document.documentElement.lang = LOCALE_TAGS[interfaceLanguage];
    document.documentElement.dataset.uiLanguage = interfaceLanguage;
    document.documentElement.dataset.userLanguage = contentLanguage;
  }
}
/** Only explicit resource bindings in the authored shell are applied. */
export function localizeShell() {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(/** @type {import('../src/generated/localizations.ts').MessageKey} */ (element.getAttribute('data-i18n')));
  for (const attribute of ['title', 'aria-label', 'placeholder']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(/** @type {import('../src/generated/localizations.ts').MessageKey} */ (element.getAttribute(`data-i18n-${attribute}`))));
  }
}
