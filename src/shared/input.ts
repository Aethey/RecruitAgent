import { formatMessage } from "../generated/localizations.ts";
import { AppError } from "./errors.ts";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, formatMessage("zh", "ui.invalidDataFormat"));
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 20000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AppError(400, formatMessage("zh", "ui.textIsEmptyOrTooLong"));
  return value;
}
