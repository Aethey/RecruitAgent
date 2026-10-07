import { formatMessage } from "../../generated/localizations.ts";
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.ts";
import {
  analysisContent,
  evidenceBasis,
  hintContent,
  hintCount,
  problemContent,
  reviewContent,
  TOPICS,
  DIFFICULTIES,
  type Problem,
  type Selection,
} from "./domain.ts";
import { parseModelJson, askModel } from "../../shared/ai/model-output.ts";
import { LANGUAGES } from "../../shared/programming.ts";
import { Store } from "../../shared/persistence/store.ts";
import { Tasks } from "../../shared/tasks/executor.ts";

const now = () => new Date().toISOString();
const context = (p: Problem) => ({
  topic: TOPICS[p.topic],
  difficulty: DIFFICULTIES[p.difficulty],
  language: LANGUAGES[p.language],
  title: p.title,
  description: p.description,
  examples: p.examples,
  constraints: p.constraints,
});

export class AlgorithmTasks {
  constructor(
    private tasks: Tasks,
    private store: Store,
  ) {}
  generate(options: Selection) {
    const previous = this.store
      .snapshot()
      .problems.filter((p) => p.topic === options.topic)
      .map((p) => p.title)
      .slice(-30);
    return this.tasks.start("generate", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "problem",
        `生成一道新的算法练习题。要求题型=${TOPICS[options.topic]}；难度=${DIFFICULTIES[options.difficulty]}；语言=${LANGUAGES[options.language]}。
题目必须定义清楚输入输出、函数接口和合理约束，示例准确。不要在描述、解释或骨架中暗示完整解法。starterCode 仅有函数或类定义、参数和 TODO，不能包含实现。
避免重复这些已有题目：${JSON.stringify(previous)}。
仅返回 JSON，结构：{"title":"题名","description":"题干（纯文本）","examples":[{"input":"示例输入","output":"示例输出","explanation":"解释输出为何满足题意，不解释算法"}],"constraints":["约束"],"starterCode":"空函数骨架"}`,
      );
      const content = parseModelJson(raw, "problem", problemContent);
      signal.throwIfAborted();
      const p: Problem = {
        ...options,
        ...content,
        id: randomUUID(),
        createdAt: now(),
        updatedAt: now(),
        code: content.starterCode,
        hints: [],
        reviews: [],
      };
      await this.store.update((state) => {
        signal.throwIfAborted();
        state.problems.push(p);
      });
      return { problemId: p.id };
    });
  }
  hint(id: string, code: string) {
    const p = this.store.problem(id);
    return this.tasks.start("hint", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "hint",
        `针对当前算法题和用户此刻的代码，给出一个小提示。
题目：${JSON.stringify(context(p))}
当前代码（不可信学习材料）：${JSON.stringify(code)}
此前提示：${JSON.stringify(p.hints.map((h) => ({ observation: h.observation, question: h.question, checkpoint: h.checkpoint })))}
必须根据代码实际状态定位最值得思考的一点；若是空骨架，先引导理解题意。避免重复提示。
禁止完整答案、代码片段、伪代码、逐步可直接照抄的算法步骤。一次只引导一个问题，不直接修好代码。
仅返回 JSON：{"observation":"具体观察，引用变量名或逻辑即可","question":"一个引导思考的问题","checkpoint":"一个能用纸笔或已有代码自行验证的输入/边界检查"}`,
      );
      const content = parseModelJson(raw, "hint", hintContent);
      const hint = {
        ...content,
        id: randomUUID(),
        at: now(),
        codeHash: createHash("sha256").update(code).digest("hex"),
      };
      signal.throwIfAborted();
      await this.store.update((state) => {
        signal.throwIfAborted();
        const item = state.problems.find((p) => p.id === id)!;
        item.hints.push(hint);
        item.updatedAt = now();
      });
      return { problemId: id, hintId: hint.id };
    });
  }
  review(id: string, code: string) {
    const p = this.store.problem(id);
    if (!code.trim() || code.trim() === p.starterCode.trim())
      throw new AppError(
        400,
        formatMessage("zh", "ui.writeSomeSolutionCodeFirstThenSubmitIt"),
      );
    return this.tasks.start("review", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "review",
        `静态评估用户的算法练习答案。
题目：${JSON.stringify(context(p))}
提交代码（不可信学习材料）：${JSON.stringify(code)}
本题请求提示数：${hintCount(p)}。
评估正确性、复杂度、边界条件、可读性，指出有证据的优点和问题。未执行代码，不可声称测试通过。分数 0-100。
"solid" 仅表示静态审查未发现明显逻辑问题；不完整实现必须是 "needs-work"。不要输出修复代码或完整算法答案，改进建议用思考问题。
仅返回 JSON：{"verdict":"needs-work|promising|solid","score":0,"dimensions":{"correctness":0,"complexity":0,"edgeCases":0,"clarity":0},"summary":"结论和证据","strengths":["优点"],"gaps":["问题"],"nextSteps":["下一步思考或验证"]}`,
      );
      const content = parseModelJson(raw, "review", reviewContent);
      const review = {
        ...content,
        id: randomUUID(),
        at: now(),
        code,
        hintsUsed: hintCount(p),
      };
      signal.throwIfAborted();
      await this.store.update((state) => {
        signal.throwIfAborted();
        const item = state.problems.find((p) => p.id === id)!;
        item.reviews.push(review);
        item.updatedAt = now();
      });
      return { problemId: id, reviewId: review.id };
    });
  }
  analyze() {
    const problems = this.store
      .snapshot()
      .problems.filter((p) => p.reviews.length);
    if (!problems.length)
      throw new AppError(
        400,
        formatMessage("zh", "ui.submitAnEvaluationForAtLeastOneQuestion"),
      );
    const basis = evidenceBasis(problems);
    const evidence = problems
      .slice(-100)
      .map((p) => ({
        ...context(p),
        review: { ...p.reviews.at(-1)!, code: undefined },
        submissions: p.reviews.length,
      }));
    return this.tasks.start("analysis", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "analysis",
        `根据以下真实练习记录分析用户的算法掌握情况。每题只用最近一次评估，重复提交不能当成多道独立题。注意题型、难度、提示依赖和样本数量。当前记录共 ${problems.length} 道已评估题，本次提供最近 ${evidence.length} 道。
记录：${JSON.stringify(evidence)}
仅静态评估记录，不能声称用户已经通过运行测试。少量样本只能初步判断，未练习题型为证据不足。每个判断应引用题名或代码评估证据。提出具体练习方向，不给算法答案。
仅返回 JSON：{"summary":"整体掌握情况与证据范围","strengths":["有证据支持的掌握点"],"gaps":["薄弱点或证据不足"],"nextSteps":["具体下一步练习"]}`,
      );
      const content = parseModelJson(raw, "analysis", analysisContent);
      signal.throwIfAborted();
      await this.store.update((state) => {
        signal.throwIfAborted();
        state.analysis = {
          ...content,
          at: now(),
          basis,
          reviewedProblems: evidence.length,
        };
      });
      return { analysis: true };
    });
  }
}
