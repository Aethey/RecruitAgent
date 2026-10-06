import { formatMessage } from './generated/localizations.ts';
import { AppError, object } from "./domain.ts";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales.ts";
import type { RealtimeVoice } from './generated/codex/RealtimeVoice.js';
import type { RealtimeVoicesList } from './generated/codex/RealtimeVoicesList.js';

export const VOICE_TONES = {
  natural: { label: formatMessage('zh', "ui.natural"), instruction: "语气自然、清楚、平稳，像面对面交谈。使用口语短句，按句意停顿，避免书面汇报式长句和每轮重复的开场白。" },
  gentle: { label: formatMessage('zh', "ui.gentle"), instruction: "语气温和、耐心，语速稍慢，但点评仍直接指出具体问题。" },
  strict: { label: formatMessage('zh', "ui.rigorous"), instruction: "语气严谨、克制，问题和点评简洁直接，不讽刺、不施压。" },
  lively: { label: formatMessage('zh', "ui.lightAndUpbeat"), instruction: "语气轻快、有精神，保持清晰，不夸张、不讨好。" },
} as const;
// The ChatGPT WebRTC call transport accepts v1 and v3; v2 is a separate API transport.
export const VOICE_MODELS = [
  { id: "gpt-live-1-codex", label: formatMessage('zh', "ui.gPTLiveCodexDefault"), version: "v3", group: "v1", source: "codex" },
  { id: "gpt-live-1", label: "GPT-Live 1", version: "v3", group: "v1", source: "api" },
  { id: "gpt-realtime-1.5", label: "GPT-Realtime 1.5", version: "v1", group: "v1", source: "codex" },
  { id: "gpt-realtime-2.1", label: "GPT-Realtime 2.1", version: "v1", group: "v1", source: "api" },
  { id: "gpt-realtime-2.1-mini", label: "GPT-Realtime 2.1 Mini", version: "v1", group: "v1", source: "api" },
  { id: "gpt-realtime-2", label: "GPT-Realtime 2", version: "v1", group: "v1", source: "api" },
  { id: "gpt-realtime", label: "GPT-Realtime", version: "v1", group: "v1", source: "api" },
  { id: "gpt-realtime-mini", label: "GPT-Realtime Mini", version: "v1", group: "v1", source: "api" },
] as const;
export type VoiceTone = keyof typeof VOICE_TONES;
export type VoiceSettings = { model: string; voice: RealtimeVoice; tone: VoiceTone; showTips: boolean; language: Locale };
export type VoiceCatalog = RealtimeVoicesList;
export type ModelCheck = { status: "available" | "failed"; at: string; message?: string; authType: string | null };
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { model: "gpt-live-1-codex", voice: "cove", tone: "natural", showTips: true, language: DEFAULT_LOCALE };
export const VOICE_PREVIEW_TEXT: Record<Locale,string> = {
  zh: "你好，这是我在面试时的声音。请先说结论，再用一个具体例子说明。",
  ja: "こんにちは。面接では、この声でお話しします。まず結論を伝えてから、具体的な例を一つ挙げてください。",
  en: "Hello, this is my interview voice. Start with your conclusion, then support it with one specific example.",
};

export function voiceModel(id: string) {
  const model = VOICE_MODELS.find(m => m.id === id);
  if (!model) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseAVoiceModelFromTheList"));
  return model;
}
export function voiceSettings(value: unknown, catalog: VoiceCatalog, defaults = DEFAULT_VOICE_SETTINGS): VoiceSettings {
  const input = object(value), model = voiceModel(typeof input.model === "string" ? input.model : defaults.model);
  const voice = input.voice === undefined ? (model.id === defaults.model ? defaults.voice : model.group === "v1" ? catalog.defaultV1 : catalog.defaultV2) : input.voice;
  const tone = input.tone ?? defaults.tone, showTips = input.showTips ?? defaults.showTips;
  const language = input.language ?? defaults.language ?? DEFAULT_LOCALE;
  const selectedVoice = catalog[model.group].find(option => option === voice);
  if (!selectedVoice) throw new AppError(400, formatMessage('zh', "ui.thisVoiceModelDoesNotSupportTheSelected"));
  if (typeof tone !== "string" || !Object.hasOwn(VOICE_TONES, tone) || typeof showTips !== "boolean") throw new AppError(400, formatMessage('zh', "ui.pleaseChooseValidToneAndTipsSettings"));
  if (!isLocale(language)) throw new AppError(400, formatMessage('zh', "ui.pleaseChooseChineseJapaneseOrEnglishAsThe"));
  return { model: model.id, voice: selectedVoice, tone: tone as VoiceTone, showTips, language };
}
