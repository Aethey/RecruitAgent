import type { AI, AIImage, AIMode, LoginInteraction } from '../src/shared/ai/types.ts';
import type { InterviewSources } from "../src/features/interview/sources.ts";
import type { JobReader } from "../src/features/interview/job-import.ts";

export const fakeInterviewSources: InterviewSources = {
  async status() { return { available: true, files: ["测试简历.pdf", "questions/通用技术.md"] }; },
  async load() { return [
    { id: "resume-test", title: "测试简历 · 项目经历", kind: "resume", content: "【隔离测试资料】支付应用 BLoC 重构；本人整理共通与个别状态，View 发出 Intent。未记录量化效果。" },
    { id: "study-test", title: "测试资料 · 状态建模知识", kind: "study", content: "【学习案例】Payment Attempt 与 Subscription 有不同时间尺度，不代表已经投入生产。" },
  ]; },
};
export const fakeJobReader: JobReader = async url => {
  if (url.includes("unavailable")) throw new Error("PRIVATE_NETWORK_ERROR");
  return { title: `测试职位来源 ${new URL(url).pathname}`, content: "【隔离测试职位正文】Mobile Engineer，Kotlin 与 Flutter 开发、SDK 集成、代码审查与测试，团队协作。" };
};

// Isolated test data. This gateway is never imported by the application entrypoint.
export const sampleProblem = {
  title: "最长连续递增片段", description: "给定一个整数数组 nums，返回其中最长的连续严格递增片段的长度。空数组返回 0。连续片段中的元素必须相邻。",
  examples: [{ input: "nums = [1, 3, 5, 4, 7]", output: "3", explanation: "[1, 3, 5] 是长度为 3 的连续严格递增片段。" }, { input: "nums = []", output: "0", explanation: "空数组没有片段。" }],
  constraints: ["0 ≤ nums.length ≤ 100000", "-1000000000 ≤ nums[i] ≤ 1000000000"],
  starterCode: "function longestIncreasingRun(nums) {\n  // TODO: 写下你的思路\n}\n",
};
export const sampleHint = { observation: "你已经记录了当前长度，但片段中断时 current 仍然沿用旧值。", question: "当 nums[i] 不大于前一个数时，新的片段应从哪个长度开始？", checkpoint: "手动跟踪 [1, 2, 1, 2, 3]，观察遇到第二个 1 时 current 的变化。" };
export const sampleReview = {
  verdict: "promising", score: 68, dimensions: { correctness: 55, complexity: 90, edgeCases: 45, clarity: 82 },
  summary: "当前实现遍历一次数组，复杂度方向合理；连续片段中断时的状态重置还需要检查。这是静态评估，未运行代码。",
  strengths: ["用 current 和 longest 表达局部状态与全局结果。"], gaps: ["空数组与下降元素处的状态转换尚不完整。"], nextSteps: ["分别用空数组和包含下降元素的输入手动跟踪状态。"],
};
export const sampleAnalysis = {
  summary: "目前只有一道数组题的静态评估，初步体现出线性遍历和状态记录的思路。样本不足，不能据此推断其他题型的掌握情况。",
  strengths: ["在《最长连续递增片段》中，能区分局部状态和全局结果。"], gaps: ["片段中断和空输入仍需巩固；其他题型缺少记录。"], nextSteps: ["先手动跟踪含下降元素的输入，再独立练习一道简单数组题。"],
};
export const sampleCompression={summary:"结论应放在开头。",relevance:"与问题相关。",conciseness:"背景可缩短。",fidelity:"保留本人行动与验证，不编造效果。",cuts:[],missing:["验证依据"],keywords:["結論","本人の行動","検証方法"],comparison:"压缩后保留行动，仍需说明验证。"};
export const sampleScenario={title:"旧请求覆盖新状态 · 隔离测试",description:"两个异步请求按不同顺序完成时，页面偶尔显示旧内容。",symptoms:["先发出的请求后完成时，旧结果覆盖新结果。"],expected:"只接受最近一次请求的结果。",requirements:["Dart 3 标准库；隔离教学数据。"],faultyCode:"class Loader {\n  String value = '';\n  Future<void> load(Future<String> result) async {\n    value = await result;\n  }\n}\n",cases:[{input:"后请求先完成",expected:"保持后请求结果"},{input:"只有一次请求",expected:"显示请求结果"}],reference:{cause:"没有请求序号检查。",fixedCode:"class Loader {\n  int epoch = 0;\n  String value = '';\n  Future<void> load(Future<String> result) async {\n    final token = ++epoch;\n    final next = await result;\n    if (token == epoch) value = next;\n  }\n}\n",explanation:"序号在发起时记录，完成时仅提交最新请求。",checks:["后请求先完成再完成前请求。","正常单请求成功。"]}};
export const sampleDiagnosisReview={summary:"这是静态检查，没有执行代码。",cause:"正确定位完成顺序与状态覆盖。",repair:"请求序号阻止旧结果提交。",validation:"仍应验证异常与取消。",strengths:["说明了竞态触发条件。"],gaps:["异常路径需补充。"],nextSteps:["补充失败请求后旧请求完成的场景。"]};
export class FakeAI implements AI {
  authenticated = true;
  prompts: string[] = [];
  mode: "normal" | "block" | "malformed" | "error" = "normal";
  delay = 0;
  model = "test-model";
  requestedModels: string[] = [];
  requestedModes: string[] = [];
  requestedImages: AIImage[][]=[];
  chatChunkDelay = 10;
  chatFailAfter?: number;
  chatOutput?: string;
  models() { return [{ id: "test-model", name: "Test Model",vision:false }, { id: "test-small", name: "Test Small",vision:true }]; }
  visionModel(){return this.models().find(m=>m.id===this.model&&m.vision)??this.models().find(m=>m.vision);}
  setModel(id: string) { this.model = id; }
  async status() { return { authenticated: this.authenticated, provider: "openai-codex", model: this.model }; }
  async login(interaction: LoginInteraction) {
    const method = await interaction.prompt({ type: "select", message: "Login method", options: [{ id: "browser", label: "Browser" }] });
    if (method !== "browser") throw new Error("Invalid method");
    interaction.notify({ type: "auth_url", url: "https://auth.openai.com/oauth/authorize?test=1" });
    const value = await interaction.prompt({ type: "manual_code", message: "Paste callback", signal: interaction.signal });
    if (value !== "test-callback") throw new Error("PRIVATE_CREDENTIAL_MUST_NOT_APPEAR");
    this.authenticated = true;
  }
  async ask(prompt: string, signal: AbortSignal, progress: (characters: number, delta?: string, cumulativeText?: string) => void, mode: AIMode = "algorithm",images?:AIImage[]) {
    this.prompts.push(prompt);
    this.requestedModels.push(images?.length?this.visionModel()!.id:this.model);
    this.requestedImages.push(images??[]);
    this.requestedModes.push(mode);
    signal.throwIfAborted();
    if (this.mode === "block") return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay));
    signal.throwIfAborted();
    if (this.mode === "error") throw new Error("PRIVATE_CREDENTIAL_MUST_NOT_APPEAR");
    if (this.mode === "malformed") return '{"title":"incomplete"}';
    if (mode === "chat" || mode === "teacher") {
      const latest = JSON.parse(prompt.match(/最新一轮：([^\n]+)\n/)![1]);
      const output = this.chatOutput ?? (mode === "teacher" ? `**代码观察**：${latest.page.editor?.includes("return nums.length") ? "目前返回的是整个数组长度，还没有区分连续片段。" : "你已经开始搭建片段状态。"}\n\n**想一想**：相邻两个数不再递增时，当前片段如何变化？\n\n**自己验证**：手动跟踪 \`[1, 2, 1, 2, 3]\`，区分当前片段与最长片段。\n\n此提示为隔离测试数据。` : `## 当前页面：${latest.page.title}\n\n你问的是：**${latest.user}**\n\n${latest.page.selectedText ? `选中的内容：${latest.page.selectedText}\n\n` : ''}结合这轮页面和之前的追问，先观察状态变化，再说明原因。\n\n\`\`\`dart\nfinal value = 1;\nprint(value);\n\`\`\`\n\n| 检查 | 原因 |\n| --- | --- |\n| 最新输入 | 确认当前状态 |\n\n- 先看题目约束\n- 再检查边界情况\n\n此回复为隔离测试数据。`);
      let characters = 0, index = 0;
      for (const delta of output.match(/[\s\S]{1,24}/g) ?? []) {
        if (this.chatChunkDelay) await new Promise(resolve => setTimeout(resolve, this.chatChunkDelay));
        signal.throwIfAborted(); characters += delta.length; progress(characters, delta);
        if (++index === this.chatFailAfter) throw new Error("PRIVATE_CREDENTIAL_MUST_NOT_APPEAR");
      }
      return output;
    }
    if(mode==='study') {
      let result:unknown;
      if(prompt.startsWith('生成一组简短知识测试')) {
        const slots=JSON.parse(prompt.match(/顺序保持一致：(\[[^\n]+\])。/u)![1]) as {point:{id:string;title:string;category:string};facet:string}[];
        result={items:slots.map(s=>({pointId:s.point.id,facet:s.facet,prompt:s.facet==='write'?'定义一个整型变量，并创建一个含两个整数的列表。':s.point.category==='expression'?'用最多三个要点，简短说明结论、行动与验证。':s.point.title+'：用两条要点说明用途和使用边界。',starterCode:s.facet==='write'?'// TODO: 完成声明\n':'',reference:{keywords:['核心用途','使用边界'],explanation:'隔离测试学习参考。明确用途，再说明适用条件。',code:s.facet==='write'?'final count = 1;\nfinal values = <int>[1, 2];':'',requirements:[]}}))};
      } else if(prompt.startsWith('评价知识短测')) {
        const ids=JSON.parse(prompt.match(/必须为这些itemId各返回一次：(\[[^\n]+\])。/u)![1]) as string[];
        const answers=JSON.parse(prompt.match(/用户提交：(\{[^\n]+\})。/u)![1]) as Record<string,string>;
        result={items:ids.map(itemId=>({itemId,verdict:answers[itemId].includes('错误')?'incorrect':answers[itemId].includes('部分')?'partial':'correct',summary:'隔离评价：结合回答检查核心要点。',gaps:answers[itemId].includes('错误')?['复习适用边界。']:[]}))};
      } else result={points:[{title:'来源中的状态边界',category:'concept',topic:'职责分离',description:'所选资料讨论状态和责任边界。',facets:['recall','apply']},{title:'来源中的结论表达',category:'expression',topic:'简洁表达',description:'先结论，再说明行动与验证。',facets:['explain']}]};
      const output=JSON.stringify(result);progress(output.length);return output;
    }
    if(mode==="training"){
      let result:unknown;
      if(prompt.startsWith("生成一个小型"))result=sampleScenario;
      else if(prompt.startsWith("回答压缩"))result=sampleCompression;
      else if(prompt.startsWith("根据上一回答")){
        const count=Number(prompt.match(/这是第(\d+)题/)![1]);
        const sources=JSON.parse(prompt.match(/事实核对资料：(\[[^\n]+\])。/u)![1]);
        result={feedback:{summary:"已有结论，但验证路径还需具体。",technical:"描述状态覆盖机制。",evidence:"未确认测试结果，不添加数据。",expression:"先结论，再给验证点。",gaps:["明确边界验证。"],keywords:["結論を先に伝える","変更点を限定する","境界条件を検証する"]},next:count>=8?null:{question:`どの検証条件を追加しますか？（追問${count}）`,kind:"technical",focus:"验证依据",keywords:["正常経路","失敗経路","境界条件"],answerBasis:"knowledge",evidenceNote:"通用验证练习，不作为本人项目事实。",sourceIds:[sources[0].id]},stopReason:count>=8?"已完成八题，请整理验证重点。":""};
      }else if(prompt.startsWith("静态评价工程"))result=sampleDiagnosisReview;
      else if(prompt.startsWith("复盘用户")){
        const entries=JSON.parse(prompt.match(/逐题记录：(\[[^\n]+\])。/u)![1]) as {id:string;answer:string;feedback:string}[];
        result={summary:"以实际记录为依据，优先练结论和验证。",observations:entries.map(e=>({entryId:e.id,content:e.answer?"已有行动，机制细节需补充。":"NE：未提供当时回答。",expression:e.answer?"把结论放在开头。":"NE：没有表达证据。",evidence:e.feedback?`实际反馈：${e.feedback}`:"NE：没有面试官明确反馈。",practice:"用三条要点说明本人行动与验证。",keywords:["結論","本人の行動","検証方法"]})),priorities:[{entryId:entries[0].id,kind:"compression",title:"练习短要点",reason:"记录中的回答需要突出结论。"},{entryId:entries[0].id,kind:"followup",title:"补充验证依据",reason:"记录没有说明验证条件。"},{entryId:entries[0].id,kind:"diagnosis",title:"定位异步状态故障",reason:"通过工程情境练习根因与验证。"}],nextSteps:["下一轮面试前整理三条关键要点。"]};
      }else throw new Error("Unexpected training prompt");
      const output=JSON.stringify(result);progress(output.length);return output;
    }
    if(mode==="library"){
      const result=prompt.startsWith("识别附件")?{pages:(JSON.parse(prompt.match(/页码顺序：(\[[^\n]+\])。/u)![1])as number[]).map(number=>({number,text:`第${number}页：隔离视觉识别结果，状态建模与测试。`}))}:prompt.startsWith("为长资料")?{notes:"本段讨论职责与状态建模。"}:{title:"资料整理 · 测试记录",category:"技术知识",tags:["Flutter","状态管理","测试"],summary:"这份资料介绍状态管理、职责分离与测试验证。此结果为隔离测试数据。",keyPoints:["区分共通与特定状态。","清晰表达责任边界。","按状态转移验证。"],...(images?.length?{extractedText:"视觉识别测试：状态图、职责边界与测试。"}:{})};
      const output=JSON.stringify(result);progress(output.length);return output;
    }
    if (mode === "interview") {
      const resumeId = prompt.match(/"id":"(library-[a-f0-9-]+)"[^}]*"kind":"resume"/)?.[1] ?? "resume-test";
      const result = prompt.startsWith("生成") ? {
        title: "重点表达 · 隔离测试练习", introduction: "以下题目用于验证面试练习界面。",
        questions: Array.from({ length: Number(prompt.match(/^生成(\d+)道/)![1]) }, (_, i) => ({
          question: ["なぜ状態と責務を整理したのですか？", "ご自身が具体的に変更した点は何ですか？", "改善した結果をどう確認しましたか？"][i % 3],
          kind: prompt.includes("共通 · 经验与表达") ? "behavioral" : "technical", focus: "結論と本人の行動を簡潔に説明する", keywords: ["結論：変更しやすい構造", "行動：共通状態と個別状態を分離", "結果：影響範囲を確認しやすくした"],
          answerBasis: "experience", evidenceNote: "隔離テスト用の履歴資料。数値効果は未確認。", sourceIds: prompt.includes("职位定制 · 简历 × JD") ? [resumeId, prompt.includes('"id":"job-url-1"') ? "job-url-1" : "job-pasted"] : [resumeId],
        })),
      } : {
        summary: "结论应先说清，再保留本人行动与结果。此处为隔离测试评价。",
        items: (JSON.parse(prompt.match(/必须为以下题号各返回一次评价：(\[[^\n]+\])/u)![1]) as string[]).map(questionId => ({
          questionId, assessment: "needs-focus", summary: "已有行动描述，把结论放在开头更清楚。",
          dimensions: { relevance: "回答与状态整理相关。", conciseness: "背景可以缩短。", structure: "先说结论，再补行动。", evidence: "不添加未记录的量化结果。" },
          strengths: ["说出了本人参与的改动。"], gaps: ["补一句验证方法。"], cuts: ["删掉与问题无关的背景介绍。"],
          improvedKeywords: ["結論：変更に強い責務分離", "行動：状態と画面判断を整理", "検証：遷移ごとに期待値を確認"], followUp: "どの状態遷移をテストしましたか？",
        })),
      };
      const output = JSON.stringify(result); progress(output.length); return output;
    }
    if (mode === "language") {
      const concepts: string[] = JSON.parse(prompt.match(/字符串：(\[[^\n]+\])/u)![1]);
      const language = prompt.match(/语言=([^；]+)；/u)![1];
      const templates: Record<string, string> = {
        Dart: "import 'dart:collection';\n\nvoid main() {\n  int count = 1;\n  String name = 'Dart';\n  final values = <int>[1, 2];\n  final labels = <String, int>{'one': 1};\n  final unique = <int>{1, 2};\n  final lookup = HashMap<String, int>()..addAll(labels);\n  print([count, name, values, unique, lookup]);\n}\n",
        Kotlin: "fun main() {\n  val count: Int = 1\n  val name: String = \"Kotlin\"\n  val array = intArrayOf(1, 2)\n  val values = listOf(1, 2)\n  val labels = hashMapOf(\"one\" to 1)\n  val unique = setOf(1, 2)\n  println(listOf(count, name, array.toList(), values, labels, unique))\n}\n",
        Swift: "let count: Int = 1\nlet name: String = \"Swift\"\nlet values: [Int] = [1, 2]\nlet labels: [String: Int] = [\"one\": 1]\nlet unique: Set<Int> = [1, 2]\nlet optional: Int? = nil\nprint(count, name, values, labels, unique, optional as Any)\n",
        Python: "count: int = 1\nname: str = 'Python'\nvalues = [1, 2]\npair = (1, 2)\nlabels = {'one': 1}\nunique = {1, 2}\noptional = None\nprint(count, name, values, pair, labels, unique, optional)\n",
        Go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n  count := 1\n  name := \"Go\"\n  array := [2]int{1, 2}\n  values := []int{1, 2}\n  labels := map[string]int{\"one\": 1}\n  unique := map[int]struct{}{1: {}, 2: {}}\n  fmt.Println(count, name, array, values, labels, unique)\n}\n",
        Java: "import java.util.*;\n\nclass Practice {\n  public static void main(String[] args) {\n    int count = 1;\n    String name = \"Java\";\n    int[] array = {1, 2};\n    List<Integer> values = new ArrayList<>(List.of(1, 2));\n    Map<String, Integer> labels = new HashMap<>(Map.of(\"one\", 1));\n    Set<Integer> unique = new HashSet<>(Set.of(1, 2));\n    System.out.println(List.of(count, name, Arrays.toString(array), values, labels, unique));\n  }\n}\n",
        JavaScript: "const count = 1;\nconst name = 'JavaScript';\nconst values = [1, 2];\nconst labels = new Map([['one', 1]]);\nconst unique = new Set(values);\nconsole.log(count, name, values, labels, unique);\n",
        TypeScript: "const count: number = 1;\nconst name: string = 'TypeScript';\nconst values: number[] = [1, 2];\nconst labels = new Map<string, number>([['one', 1]]);\nconst unique = new Set<number>(values);\nconsole.log(count, name, values, labels, unique);\n",
      };
      const exercises = Array.from({ length: Math.ceil(concepts.length / 2) }, (_, i) => ({ title: `写法练习 ${i + 1}`, concepts: concepts.slice(i * 2, i * 2 + 2),
        instruction: `请定义并使用：${concepts.slice(i * 2, i * 2 + 2).join("；")}。`,
        explanation: "先声明类型与初值，再使用容器。显式写出元素类型有助于看清类型边界，具体模板请对照上面的代码。",
        benefits: ["把数据类型和用途表达清楚，减少混淆。"], pitfalls: ["变量不可重新赋值不一定意味着集合内容不可修改。"] }));
      const content = { title: `${language} 基础写法练习`, introduction: "一次练习多个基础值与集合声明。", requirements: [`${language} 标准库；本结果仅为隔离测试数据。`],
        starterCode: language === "Python" ? "# TODO: 完成这一组练习\n" : "// TODO: 完成这一组练习\n", templateCode: templates[language], exercises };
      const output = JSON.stringify(content); progress(output.length); return output;
    }
    const problem = {
      ...sampleProblem,
      starterCode: prompt.includes("语言=Dart。") ? "int longestIncreasingRun(List<int> nums) {\n  // TODO\n}\n"
        : prompt.includes("语言=Swift。") ? "func longestIncreasingRun(_ nums: [Int]) -> Int {\n  // TODO\n}\n"
        : sampleProblem.starterCode,
    };
    const result = prompt.startsWith("生成") ? problem : prompt.startsWith("针对") ? sampleHint : prompt.startsWith("静态") ? sampleReview : sampleAnalysis;
    const output = JSON.stringify(result); progress(output.length); return output;
  }
}
