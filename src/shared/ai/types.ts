import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Locale } from "../i18n/locales.ts";

export type LoginInteraction = Parameters<ModelRuntime["login"]>[2];
export type ModelOption = { id: string; name: string; vision?: boolean };
export type AIImage = { type: "image"; data: string; mimeType: string };
export type AIMode =
  | "algorithm"
  | "language"
  | "interview"
  | "library"
  | "training"
  | "study"
  | "chat"
  | "teacher";
export interface AI {
  models(): readonly ModelOption[];
  setModel(id: string): void;
  visionModel(): ModelOption | undefined;
  status(): Promise<{
    authenticated: boolean;
    provider: string;
    model: string;
  }>;
  login(interaction: LoginInteraction): Promise<void>;
  ask(
    prompt: string,
    signal: AbortSignal,
    progress: (
      characters: number,
      delta?: string,
      cumulativeText?: string,
    ) => void,
    mode?: AIMode,
    images?: AIImage[],
    userLanguage?: Locale,
  ): Promise<string>;
}
