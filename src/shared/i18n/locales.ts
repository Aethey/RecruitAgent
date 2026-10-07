export const LOCALES = { zh: "中文", en: "English", ja: "日本語" } as const;
export type Locale = keyof typeof LOCALES;
export const LOCALE_TAGS: Record<Locale, string> = { zh: "zh-CN", en: "en", ja: "ja" };
export const DEFAULT_LOCALE: Locale = "zh";
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(LOCALES, value);
}
export function outputLanguageInstruction(locale: Locale): string {
  const language = { zh: "Simplified Chinese (简体中文)", en: "English", ja: "Japanese (日本語)" }[locale];
  return `OUTPUT LANGUAGE: ${language}.
Write all newly generated human-readable content in ${language}: questions, titles, descriptions, examples' explanations, hints, teaching guidance, reference points, summaries, feedback and chat replies. This also applies to interview questions and keywords. The selected output language takes precedence over the language of historical messages, source materials and examples of JSON values.
Keep JSON keys, enum values, IDs and exact syllabus concept identifiers unchanged. Write code in the requested programming language. Preserve verbatim quotations, filenames, URLs, product names and source transcriptions (including OCR) in their original language; explain them in ${language}. Do not translate or rewrite the user's code or stored history.`;
}
