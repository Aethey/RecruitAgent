import { schemas } from "../../generated/model-schemas.mjs";
import type { ModelOutputs } from "../../contracts/api.ts";
import type { AIImage } from "./types.ts";
import { formatMessage } from "../../generated/localizations.ts";
import { AppError } from "../errors.ts";
import { modelValue } from "../../contracts/validation.ts";

export function modelInstruction(kind: keyof ModelOutputs): string {
  return `输出结构必须符合以下 JSON Schema；示例中的自然语言仅供说明，业务与事实要求仍须遵守：\n${JSON.stringify(schemas[kind])}`;
}
export function askModel(
  ask: (prompt: string, images?: AIImage[]) => Promise<string>,
  kind: keyof ModelOutputs,
  prompt: string,
  images?: AIImage[],
) {
  return ask(`${prompt}\n\n${modelInstruction(kind)}`, images);
}

export function parseModelJson<K extends keyof ModelOutputs, T>(
  raw: string,
  kind: K,
  validate: (value: ModelOutputs[K]) => T,
): T {
  try {
    const clean = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    return validate(modelValue(kind, JSON.parse(clean)));
  } catch {
    throw new AppError(
      502,
      formatMessage("zh", "ui.codexReturnedIncompleteDataRetryNoResultWas"),
    );
  }
}
