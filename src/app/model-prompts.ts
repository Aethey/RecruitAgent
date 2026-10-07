import type { AIMode } from "../shared/ai/types.ts";
import {
  outputLanguageInstruction,
  type Locale,
} from "../shared/i18n/locales.ts";
import { SYSTEM as ALGORITHM_SYSTEM } from "../features/algorithm/prompt.ts";
import { LANGUAGE_SYSTEM } from "../features/language/prompt.ts";
import { INTERVIEW_SYSTEM } from "../features/interview/prompt.ts";
import { LIBRARY_SYSTEM } from "../features/library/prompt.ts";
import { TRAINING_SYSTEM } from "../features/training/prompt.ts";
import { STUDY_SYSTEM } from "../features/study/prompt.ts";
import { CHAT_SYSTEM, TEACHER_SYSTEM } from "../features/chat/prompts.ts";

export function systemPrompt(
  mode: AIMode,
  userLanguage: Locale = "zh",
): string {
  const prompts: Record<AIMode, string> = {
    algorithm: ALGORITHM_SYSTEM,
    language: LANGUAGE_SYSTEM,
    interview: INTERVIEW_SYSTEM,
    library: LIBRARY_SYSTEM,
    training: TRAINING_SYSTEM,
    study: STUDY_SYSTEM,
    chat: CHAT_SYSTEM,
    teacher: TEACHER_SYSTEM,
  };
  return `${outputLanguageInstruction(userLanguage)}\n\n${prompts[mode]}`;
}
