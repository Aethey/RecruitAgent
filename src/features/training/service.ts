import { formatMessage } from "../../generated/localizations.ts";
import { AppError } from "../../shared/errors.ts";
import { object, text } from "../../shared/input.ts";
import { Store } from "../../shared/persistence/store.ts";
import type { Source, Question } from "../interview/domain.ts";
import {
  debriefEntries,
  draftInput,
  publicTraining,
  trainingRecord,
  type TrainingKind,
} from "./domain.ts";

export class TrainingService {
  constructor(private store: Store) {}
  async create(value: unknown) {
    const v = object(value);
    if (!["compression", "followup", "debrief"].includes(v.kind as string))
      throw new AppError(
        400,
        formatMessage("zh", "ui.pleaseChooseATrainingType"),
      );
    const kind = v.kind as TrainingKind;
    let question: string | undefined,
      original = "",
      sources: Source[] = [],
      seed: Question | undefined;
    if (kind !== "debrief") {
      if (v.interviewId) {
        const set = this.store.interview(text(v.interviewId, 100));
        seed = set.questions.find((q) => q.id === v.questionId);
        if (!seed)
          throw new AppError(
            404,
            formatMessage("zh", "ui.theInterviewQuestionDoesNotExist"),
          );
        question = seed.question;
        original =
          v.original === undefined
            ? (set.answers[seed.id] ?? "")
            : typeof v.original === "string" && v.original.length <= 10000
              ? v.original
              : (() => {
                  throw new AppError(
                    400,
                    formatMessage("zh", "ui.theOriginalAnswerIsTooLong"),
                  );
                })();
        sources = set.sources;
      } else if (v.debriefId) {
        const parent = this.store.training(text(v.debriefId, 100));
        if (parent.kind !== "debrief")
          throw new AppError(
            400,
            formatMessage("zh", "ui.theSourceIsNotAnInterviewRecap"),
          );
        const review = parent.reviews.find((r) => r.id === v.reviewId);
        if (!review)
          throw new AppError(
            404,
            formatMessage("zh", "ui.theReviewEvaluationDoesNotExist"),
          );
        const entry = debriefEntries(review.input).find(
          (e) => e.id === v.entryId,
        );
        if (!entry)
          throw new AppError(
            404,
            formatMessage("zh", "ui.theReviewQuestionDoesNotExist"),
          );
        question = entry.question;
        original = entry.answer;
        sources = [
          {
            id: "debrief-entry",
            kind: "personal",
            title: "本人记录的面试问题与回答",
            content: JSON.stringify(entry),
          },
        ];
      } else {
        question = text(v.question, 400);
        original = v.original === undefined ? "" : text(v.original, 10000);
        sources = [
          {
            id: "personal-answer",
            kind: "personal",
            title: "本人输入的回答材料",
            content: original || "本人尚未补充回答。",
          },
        ];
      }
      seed ??= {
        id: "q1",
        question: question!,
        kind: "technical",
        focus: "理由、边界与验证",
        keywords: [
          "結論を先に述べる",
          "理由と本人の行動を説明する",
          "確認できる結果・不明点を分ける",
        ],
        answerBasis: "needs-detail",
        evidenceNote: "用户记录，需要本人补充实际依据。",
        sourceIds: sources.map((s) => s.id).slice(0, 6),
      };
    }
    const draft: Record<string, string> =
      kind === "compression"
        ? { original, points: "" }
        : kind === "followup"
          ? { ["answer:" + seed!.id]: original }
          : {
              company: "",
              role: "",
              date: "",
              stage: "",
              notes: "",
              "question:1": "",
              "answer:1": "",
              "feedback:1": "",
            };
    const record = trainingRecord(
      kind,
      kind === "debrief"
        ? formatMessage("zh", "ui.newInterviewDebrief")
        : question!.slice(0, 120),
      draft,
      sources,
    );
    Object.assign(record, {
      question,
      ...(v.interviewId
        ? { interviewId: v.interviewId, questionId: v.questionId }
        : {}),
      ...(v.debriefId ? { debriefId: v.debriefId, entryId: v.entryId } : {}),
      ...(kind === "followup" ? { turns: [seed], finished: false } : {}),
    });
    await this.store.update((s) => {
      (s.trainings ??= []).push(record);
    });
    return publicTraining(record);
  }
  async saveDraft(id: string, value: unknown) {
    const patch = draftInput(value, this.store.training(id));
    await this.store.update((state) => {
      const record = state.trainings!.find((item) => item.id === id)!;
      Object.assign(record.draft, patch);
      record.updatedAt = new Date().toISOString();
      if (record.kind === "debrief")
        record.title =
          [record.draft.company, record.draft.role]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 150) || formatMessage("zh", "ui.newInterviewDebrief");
    });
  }
  async reveal(id: string) {
    const record = this.store.training(id);
    if (record.kind !== "diagnosis" || !record.reviews.length)
      throw new AppError(
        400,
        formatMessage("zh", "ui.submitOneFaultDiagnosisFirstThenViewThe"),
      );
    await this.store.update((state) => {
      state.trainings!.find((item) => item.id === id)!.revealedAt ??=
        new Date().toISOString();
    });
    return publicTraining(this.store.training(id));
  }
}
