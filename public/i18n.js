import { LOCALES, LOCALE_TAGS, isLocale } from '../src/locales.ts';
import { translateSource } from '../src/ui-messages.ts';

export { LOCALES };
const initialInterface = globalThis.document?.documentElement.dataset.uiLanguage;
let interfaceLanguage = isLocale(initialInterface) ? initialInterface : 'zh';
const initialContent = globalThis.document?.documentElement.dataset.userLanguage;
let contentLanguage = isLocale(initialContent) ? initialContent : 'zh';
export const uiLanguage = () => interfaceLanguage;
export const userLanguage = () => contentLanguage;
export const languageTag = () => LOCALE_TAGS[interfaceLanguage];

/** Explicit source messages only. User text, code and AI replies never pass through this function. */
export function t(source, locale = interfaceLanguage) {
  return translateSource(String(source ?? ''), locale, String(source ?? '').includes('<'));
}
/** Translate authored template fragments; interpolation values are preserved byte for byte. */
export function ui(parts, ...values) {
  return parts.reduce((result, part, index) => result + translateSource(part, interfaceLanguage, part.includes('<') || part.includes('>')) + (index < values.length ? values[index] : ''), '');
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
/** Called once for the authored application shell, before any user content is mounted. */
export function localizeShell() {
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, source = node.nodeValue.trim();
    if (source) node.nodeValue = node.nodeValue.replace(source, t(source));
  }
  for (const element of document.body.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }
  }
}
