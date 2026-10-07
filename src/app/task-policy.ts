import { formatMessage } from "../generated/localizations.ts";
import type { TaskDefinition, TaskKind } from "../shared/tasks/executor.ts";

/** Application policy; the executor only manages the task lifecycle. */
export function taskDefinition(kind: TaskKind): TaskDefinition {
  return {
    message: {
      teacher: formatMessage(
        "zh",
        "ui.inspectingTheCurrentProblemAndLatestCode",
      ),
      chat: formatMessage(
        "zh",
        "ui.readingTheCurrentPageAndConversationContext",
      ),
      generate: formatMessage("zh", "ui.draftingQuestionsAndExamples"),
      hint: formatMessage("zh", "ui.readingYourCodeToFindAStartingPoint"),
      review: formatMessage("zh", "ui.checkingCodeLogicComplexityAndEdgeCases"),
      analysis: formatMessage(
        "zh",
        "ui.analyzingMasteryBasedOnPracticeRecords",
      ),
      language: formatMessage(
        "zh",
        "ui.organizingLanguagePracticeCorrectTemplatesAndExplanations",
      ),
      interview: formatMessage(
        "zh",
        "ui.preparingInterviewQuestionsBasedOnTheResumeAnd",
      ),
      "interview-review": formatMessage(
        "zh",
        "ui.checkingTheAnswerSFocusEvidenceAndExpression",
      ),
      library: formatMessage(
        "zh",
        "ui.readingMaterialsAndOrganizingCategoriesTagsAndSummaries",
      ),
      training: formatMessage(
        "zh",
        "ui.preparingTrainingAndFeedbackBasedOnCurrentRecords",
      ),
      study: formatMessage("zh", "ui.preparingTheDailyQuiz"),
      "study-review": formatMessage(
        "zh",
        "ui.evaluatingTheQuizReviewTimeIsCalculatedBy",
      ),
      "study-import": formatMessage(
        "zh",
        "ui.extractingKnowledgePointsFromTheSelectedMaterials",
      ),
    }[kind],
    mode:
      kind === "teacher"
        ? "teacher"
        : kind === "chat"
          ? "chat"
          : kind.startsWith("study")
            ? "study"
            : kind === "training"
              ? "training"
              : kind === "library"
                ? "library"
                : kind.startsWith("interview")
                  ? "interview"
                  : kind === "language"
                    ? "language"
                    : "algorithm",
    timeoutMs: kind === "library" ? 900000 : 180000,
  };
}
