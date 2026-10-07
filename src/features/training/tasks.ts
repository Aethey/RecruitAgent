import { formatMessage } from "../../generated/localizations.ts";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.ts";
import { object, text } from "../../shared/input.ts";
import { parseModelJson, askModel } from "../../shared/ai/model-output.ts";
import { LANGUAGES } from "../../shared/programming.ts";
import type { AI } from "../../shared/ai/types.ts";
import { Store } from "../../shared/persistence/store.ts";
import {
  compressionInput,
  compressionResult,
  debriefEntries,
  debriefResult,
  diagnosisResult,
  draftInput,
  followupResult,
  scenarioContent,
  trainingRecord,
  DIAGNOSIS_TOPICS,
  type Draft,
  type TrainingReview,
} from "./domain.ts";
import { Tasks } from "../../shared/tasks/executor.ts";

const now = () => new Date().toISOString();

export class TrainingTasks {
  constructor(
    private tasks: Tasks,
    private ai: AI,
    private store: Store,
  ) {}
  generateDiagnosis(selection: {
    language: keyof typeof LANGUAGES;
    topic: keyof typeof DIAGNOSIS_TOPICS;
    focus: string;
  }) {
    const previous =
      this.store
        .snapshot()
        .trainings?.filter(
          (t) => t.kind === "diagnosis" && t.topic === selection.topic,
        )
        .slice(-10)
        .map((t) => t.title) ?? [];
    return this.tasks.start("training", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "scenario",
        `生成一个小型工程故障诊断练习。语言=${LANGUAGES[selection.language]}；方向=${DIAGNOSIS_TOPICS[selection.topic]}；希望练习的背景=${JSON.stringify(selection.focus)}。
优先该语言标准库、真实可解释的小场景，代码不超过100行。用requirements注明版本与必要依赖。faultyCode必须是一段包含可定位故障的完整教学代码，而不是TODO。description给背景，不泄露原因；symptoms是情境设定，不声称实测。cases给出至少一个正常和一个边界输入及预期行为。reference提供正确修复、根因、原因解释和验证检查，仅用于后端评估，用户提交前不能看见。不要虚构API，代码使用请求语言。避免重复：${JSON.stringify(previous)}。
仅返回JSON：{"title":"题名","description":"情境","symptoms":["设定的现象"],"expected":"应有行为","requirements":["版本或依赖"],"faultyCode":"带故障的代码","cases":[{"input":"正常或边界情境","expected":"应有行为"}],"reference":{"cause":"根因","fixedCode":"完整修复代码","explanation":"为什么这样修复","checks":["正常路径检查","失败或边界检查"]}}`,
      );
      const content = parseModelJson(raw, "scenario", scenarioContent),
        record = trainingRecord("diagnosis", content.title, {
          code: content.scenario.faultyCode,
          cause: "",
          checks: "",
        });
      Object.assign(record, {
        language: selection.language,
        topic: selection.topic,
        scenario: content.scenario,
      });
      await this.store.update((s) => {
        signal.throwIfAborted();
        (s.trainings ??= []).push(record);
      });
      return { trainingId: record.id, created: true };
    });
  }
  train(id: string, action: string, value: unknown) {
    const record = this.store.training(id);
    if (record.kind === "followup") {
      if (action !== "next" || record.finished)
        throw new AppError(
          400,
          formatMessage("zh", "ui.thisFollowUpRoundHasEndedOrThe"),
        );
      const v = object(value),
        turn = record.turns!.at(-1)!;
      if (v.turnId !== turn.id)
        throw new AppError(
          409,
          formatMessage("zh", "ui.youCanOnlySubmitTheCurrentFinalFollow"),
        );
      const answer = text(v.answer, 10000),
        turns = structuredClone(record.turns!);
      return this.tasks.start("training", async (ask, signal) => {
        const raw = await askModel(
          ask,
          "followup",
          `根据上一回答递进追问。当前题：${JSON.stringify(turn)}；提交回答：${JSON.stringify(answer)}；此前问答：${JSON.stringify(turns)}；事实核对资料：${JSON.stringify(record.sources)}。
评价内容、参考keywords和下一题均使用设置中的用户语言，均只给3-5个短要点，每项<=80字符。技术理解、表达、证据分开评。只在回答确有具体缺口时问下一题，优先问一个最有区分度的理由/替代方案/失败边界/验证问题；不得重复已经问过的问题。来源必须使用已给资料ID，不能把学习资料写成已做项目。
这是第${turns.length}题，最多8题。${turns.length >= 8 ? "必须结束，next为null。" : "如果已充分覆盖本主题，next为null并说明下一步；否则生成一个下一题。"}
仅返回JSON：{"feedback":{"summary":"总结","technical":"技术理解或本题不涉及技术","evidence":"本人事实与未知","expression":"重点表达","gaps":["具体缺口"],"keywords":["简短要点"]},"next":{"question":"追问","kind":"${turn.kind}","focus":"考察重点","keywords":["短要点"],"answerBasis":"experience|knowledge|needs-detail","evidenceNote":"依据与边界","sourceIds":["真实资料ID"]},"stopReason":"结束时说明原因，否则空字符串"}。结束时next必须为null。`,
        );
        const result = parseModelJson(raw, "followup", (v) =>
          followupResult(v, record.sources, turns.length >= 8),
        );
        if (
          result.next &&
          turns.some((t) => t.question.trim() === result.next!.question.trim())
        )
          throw new AppError(
            502,
            formatMessage(
              "zh",
              "ui.theFollowUpDuplicatesAnExistingQuestionPlease",
            ),
          );
        await this.store.update((s) => {
          signal.throwIfAborted();
          const current = s.trainings!.find((t) => t.id === id)!;
          const parent = current.turns!.at(-1)!;
          if (parent.id !== turn.id)
            throw new AppError(
              409,
              formatMessage("zh", "ui.followUpUpdatedPleaseRefresh"),
            );
          parent.submittedAnswer = answer;
          parent.feedback = result.feedback;
          if (result.next)
            current.turns!.push({ ...result.next, id: randomUUID() });
          else {
            current.finished = true;
            current.stopReason = result.stopReason;
          }
          current.updatedAt = now();
        });
        return { trainingId: id };
      });
    }
    let input: Draft;
    if (
      record.kind === "compression" &&
      ["analyze", "rewrite"].includes(action)
    )
      input = compressionInput(value, record, action);
    else if (record.kind === "diagnosis" && action === "review") {
      input = draftInput(value, record);
      text(input.code, 100000);
      text(input.cause, 10000);
      text(input.checks, 10000);
    } else if (record.kind === "debrief" && action === "review") {
      input = draftInput(value, record);
      debriefEntries(input);
    } else
      throw new AppError(400, formatMessage("zh", "ui.invalidTrainingAction"));
    const submitted = structuredClone(input);
    return this.tasks.start("training", async (ask, signal) => {
      let result: TrainingReview["result"];
      if (record.kind === "compression") {
        const raw = await askModel(
          ask,
          "compression",
          `回答压缩训练。阶段=${action === "rewrite" ? "评价用户自己压缩后的3-5个要点，和原回答对照" : "诊断原回答的冗余与重点，帮助用户随后自己压缩"}。
面试问题：${JSON.stringify(record.question)}；原回答：${JSON.stringify(submitted.original)}；用户压缩稿：${JSON.stringify(submitted.points ?? "")}；最近提交：${JSON.stringify(record.reviews.slice(-2))}；事实资料：${JSON.stringify(record.sources)}。
检查是否直接回应、结论先行、删掉铺垫与重复、保留本人的行动和结果。篇幅短不代表完整；不得替用户补造事实或删掉改变含义的重要信息。cuts最多3条，每条quote必须逐字出现在原回答中，reason解释为什么删/后移。不需要删则空数组。keywords使用用户语言3-5条，每条<=80字符，供提炼重点，不给整段答案。comparison指出自己的压缩稿相较原稿有什么改善/遗漏；原稿阶段说明压缩目标，不假称已压缩。只评价书面表达，不推断口语或技术等级。
仅返回JSON：{"summary":"重点","relevance":"切题","conciseness":"冗余","fidelity":"事实与含义保留","cuts":[{"quote":"原文逐字片段","reason":"删减理由"}],"missing":["需补充或保留的事实"],"keywords":["短重点"],"comparison":"前后对照或压缩目标"}`,
        );
        result = parseModelJson(raw, "compression", (v) =>
          compressionResult(v, submitted.original),
        );
      } else if (record.kind === "diagnosis") {
        const raw = await askModel(
          ask,
          "diagnosis",
          `静态评价工程故障诊断。原始情境与参考修复：${JSON.stringify(record.scenario)}；语言=${record.language}；提交修复、根因和验证思路：${JSON.stringify(submitted)}。
分别检查cause能否解释症状、repair是否消除根因并保留正常行为、validation是否覆盖正常/边界/失败/并发路径。参考代码也可能有误，按语言语义判断，不能只因实现不同就判错。指出具体变量与逻辑位置，不给完整修复，不宣称运行代码或通过测试。只返回JSON：{"summary":"基于证据的结论","cause":"根因分析评价","repair":"修复评价","validation":"验证评价","strengths":["优点"],"gaps":["问题"],"nextSteps":["下一步检查"]}`,
        );
        result = parseModelJson(raw, "diagnosis", diagnosisResult);
      } else {
        const entries = debriefEntries(submitted);
        const raw = await askModel(
          ask,
          "debrief",
          `复盘用户记录的真实面试。公司/职位/阶段/备注：${JSON.stringify({ company: submitted.company, role: submitted.role, date: submitted.date, stage: submitted.stage, notes: submitted.notes })}；逐题记录：${JSON.stringify(entries)}。
必须区分用户记下的面试官实际反馈和你对书面回答的观察。未记回答或反馈时明确证据不足，不想象实际发言，不推断被拒原因、口语、性格或录用。逐题分析content内容/机制，expression重点表达，evidence事实与个人贡献；practice是一个具体补强任务。keywords使用用户语言3-5条每项<=80字符，缺事实标待本人补充。
必须为以下每个entryId给一次observation：${JSON.stringify(entries.map((e) => e.id))}。给1-3个优先练习，kind只允许compression/followup/diagnosis；须引用本次问题entryId和记录中的依据。压缩适合有原回答的冗余问题，追问适合理由/取舍/验证缺口，诊断适合技术机制/代码缺口。没有原回答不能提出基于其实际内容的删减。只返回JSON：{"summary":"主要问题与证据范围","observations":[{"entryId":"问题ID","content":"内容","expression":"表达","evidence":"事实依据","practice":"补强练习","keywords":["短要点"]}],"priorities":[{"entryId":"问题ID","kind":"compression|followup|diagnosis","title":"练习名","reason":"记录中的理由"}],"nextSteps":["下一次面试前具体动作"]}`,
        );
        result = parseModelJson(raw, "debrief", (v) =>
          debriefResult(
            v,
            entries.map((e) => e.id),
          ),
        );
      }
      const review: TrainingReview = {
        id: randomUUID(),
        at: now(),
        action,
        model: (await this.ai.status()).model,
        input: submitted,
        result,
      };
      await this.store.update((s) => {
        signal.throwIfAborted();
        const current = s.trainings!.find((t) => t.id === id)!;
        current.reviews.push(review);
        current.updatedAt = now();
      });
      return { trainingId: id };
    });
  }
}
