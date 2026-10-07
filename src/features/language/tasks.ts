import { randomUUID } from "node:crypto";
import { parseModelJson, askModel } from "../../shared/ai/model-output.ts";
import { LANGUAGES } from "../../shared/programming.ts";
import { Store } from "../../shared/persistence/store.ts";
import {
  drillContent,
  languageFocus,
  type LanguageDrill,
  type LanguageSelection,
} from "./domain.ts";
import { Tasks } from "../../shared/tasks/executor.ts";

const now = () => new Date().toISOString();

export class LanguageTasks {
  constructor(
    private tasks: Tasks,
    private store: Store,
  ) {}
  generateLanguage(selection: LanguageSelection) {
    const drills = this.store.snapshot().languageDrills ?? [];
    const focus = languageFocus(selection, drills);
    const previous = drills
      .filter(
        (d) => d.language === selection.language && d.topic === focus.topic,
      )
      .slice(-15)
      .map((d) => d.title);
    return this.tasks.start("language", async (ask, signal) => {
      const raw = await askModel(
        ask,
        "language",
        `生成一组语言写法练习。语言=${LANGUAGES[selection.language]}；模块=${focus.spec.label}。
本次必须覆盖以下每个知识点，exercises[].concepts 必须逐字引用其中的字符串：${JSON.stringify(focus.concepts)}。
目标是掌握语言基础、关键写法、语法糖和 Lambda，而不是算法推理。按知识点关联和复杂度自行分成 1-6 个小练习：基础声明请一次组合多个类型（如 int/String/List/Map/Set）；同一类循环、条件表达式或函数写法可以集中对比；复杂并发或类型建模控制在能理解的规模。
条件表达式练习可以用 ans == nums.length + 1 ? 0 : ans 这类表达式，要求改写为等价分支并解释结果选择。对没有 ?: 的语言使用惯用等价写法；重点是语法理解，不是算法题。
题干必须要求用户自己动手写，指令具体。starterCode 只包含题号、TODO、必要接口和空骨架，不能包含答案。templateCode 是覆盖整组练习的完整、正确参考文件，按题号标注位置，包含所有必要 import、最小调用或入口，不省略关键实现，不使用“...”代替代码。
每个小练习的 explanation 必须讲清语法、为什么这么写、关键表达式怎样理解；benefits 写这种写法的好处与适用场景；pitfalls 写约束、易错点、与常见替代写法的区别。基础用同一个简单例子；有多种合法写法时说明它们的差异。
不能生搬其他语言的语法：Dart 通常用 List 表达数组；Kotlin/Go 无三元运算符；Python dict 是哈希映射而非内建 HashMap 类；Go 的 Set 需自行表示；Swift 用 enum 建模封闭状态而非 sealed class。DI 是设计方式，默认以构造函数/初始化器/工厂与接口注入演示，不要求外部 DI 框架。
优先标准库。确实需要 kotlinx.coroutines 等外部库时，requirements 明确包名和最低版本/必要环境。新语法或有平台差异时写明语言版本和平台。并发示例必须解释生命周期、取消与资源关闭。不能声称已编译或运行；这份模板由模型生成。
避免重复已有练习标题：${JSON.stringify(previous)}。
仅返回 JSON：{"title":"整组题名","introduction":"学习目标","requirements":["语言版本、必要导入或依赖"],"starterCode":"整组待写骨架","templateCode":"整组完整正确模板","exercises":[{"title":"小练习题名","instruction":"具体要求，不含答案","concepts":["从指定知识点逐字引用"],"explanation":"写法解析与原因","benefits":["好处和使用场景"],"pitfalls":["边界、易错点或替代写法差异"]}]}`,
      );
      const content = parseModelJson(raw, "language", (value) =>
        drillContent(value, focus.concepts),
      );
      signal.throwIfAborted();
      const drill: LanguageDrill = {
        ...content,
        language: selection.language,
        topic: focus.topic,
        selectionTopic: selection.topic,
        concepts: focus.concepts,
        id: randomUUID(),
        createdAt: now(),
        updatedAt: now(),
        code: content.starterCode,
      };
      await this.store.update((state) => {
        signal.throwIfAborted();
        (state.languageDrills ??= []).push(drill);
      });
      return { drillId: drill.id };
    });
  }
}
