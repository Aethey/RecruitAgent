import { formatMessage } from "../../generated/localizations.ts";
import { AppError } from "../../shared/errors.ts";
import { object } from "../../shared/input.ts";

export type TeacherSettings = {
  trigger: "idle" | "manual";
  idleSeconds: number;
};
export const DEFAULT_TEACHER_SETTINGS: TeacherSettings = {
  trigger: "idle",
  idleSeconds: 20,
};
export function teacherSettings(value: unknown): TeacherSettings {
  const input = object(value);
  if (input.trigger !== "idle" && input.trigger !== "manual")
    throw new AppError(
      400,
      formatMessage("zh", "ui.chooseAValidTeacherAnalysisTrigger"),
    );
  if (
    !Number.isInteger(input.idleSeconds) ||
    Number(input.idleSeconds) < 1 ||
    Number(input.idleSeconds) > 3600
  )
    throw new AppError(
      400,
      formatMessage("zh", "ui.inactivityWaitMustBeAnIntegerFromTo"),
    );
  return { trigger: input.trigger, idleSeconds: Number(input.idleSeconds) };
}
