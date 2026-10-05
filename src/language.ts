import { AppError, LANGUAGES, object, text, type Language } from "./domain.ts";

type TopicSpec = { label: string; concepts: string[]; batch: number };
const topic = (label: string, concepts: string, batch = 4): TopicSpec => ({ label, concepts: concepts.split("；"), batch });
// Language-specific syllabus, rather than treating every language as Java with different keywords.
export const LANGUAGE_SYLLABUS = {
  dart: {
    foundation: topic("基础值与集合声明", "int/double/bool/String 声明；var/final/const 与可变性；List 与固定长度/可增长列表；Map 键值声明；Set 与空集合字面量；HashMap/HashSet 与 dart:collection", 6),
    strings: topic("字符串与数值", "字符串插值与多行/原始字符串；字符串切分与拼接；数值转换与 tryParse；相等比较与 identical；算术/逻辑/位运算；DateTime/Duration 基本写法", 6),
    collections: topic("集合操作", "索引/添加/删除/查找；Map entries/putIfAbsent/update；Set 集合运算；map/where/expand 与 toList；fold/reduce/any/every；排序与 Comparator；Iterable 惰性求值与迭代器；不可修改集合与浅拷贝", 4),
    control: topic("分支与循环", "if/else 与三元条件表达式；经典 for/for-in/forEach 对比；while/do-while；break/continue 与标签；switch 语句与表达式；assert 与调试检查", 6),
    functions: topic("函数、Lambda 与闭包", "返回类型与 => 箭头函数；位置/可选/命名/required 参数；默认值；匿名函数/Lambda 与函数类型；高阶函数与闭包捕获；typedef 与方法 tear-off", 4),
    objects: topic("类与构造函数", "字段与初始化形参 this；命名/重定向/const 构造函数；初始化列表与 super 参数；factory 构造函数；getter/setter/static；继承/implements/abstract 与 override；操作符重载", 4),
    idioms: topic("空安全与语法糖", "可空类型与类型提升；?. / ?? / ??= 与 ! 的风险；late 与初始化约束；级联 .. / ?..；集合 if/for 与 ... / ...?；record 与解构；模式匹配与 if-case", 4),
    types: topic("扩展、Mixin 与类型建模", "extension 方法与静态分派；mixin/with/on 与复用；sealed class 与穷尽 switch；增强 enum；泛型类型/函数与 extends 约束；base/interface/final 类修饰符；extension type 与包装", 2),
    errors: topic("异常、资源与模块", "try/on/catch/finally 与 rethrow；自定义 Exception；import/export/show/hide/as；library 私有标识符；文件/JSON 与必要的 dart 库", 4),
    async: topic("异步、Stream 与 Isolate", "Future 与 async/await；Future.wait 与异常；Stream 与 await-for；async* / sync* 与 yield；StreamSubscription 与取消；Isolate.run 计算隔离；Isolate.spawn/ReceivePort/SendPort；Isolate 不共享内存与消息限制", 2),
    design: topic("依赖注入与可测试设计", "构造函数注入与接口抽象；组合优于继承的简单实现；假实现与替换依赖；泛型仓储边界；工厂创建与对象生命周期", 2),
  },
  kotlin: {
    foundation: topic("基础值与集合声明", "Int/Long/Double/Boolean/String 声明；val/var 与类型推断；Array/IntArray 与数组初始化；List/MutableList；Map/MutableMap/HashMap；Set/MutableSet/HashSet", 6),
    strings: topic("字符串、数字与区间", "字符串模板与原始字符串；trimIndent/trimMargin；数值转换与 toIntOrNull；== 与 ===；范围/步长/until/downTo；算术/逻辑/位操作", 6),
    collections: topic("集合与序列", "集合增删查与不可变性边界；Map getOrPut/entries；map/filter/flatMap；fold/reduce/groupBy/associate；排序/比较器/去重；Sequence 惰性处理；zip/windowed/chunked；集合复制与共享引用", 4),
    control: topic("分支与循环", "if 表达式（无三元运算符）；when 表达式；for 范围/集合/indices/withIndex；forEach 与 forEachIndexed；while/do-while；break/continue 与标签；return@label 与局部返回", 6),
    functions: topic("函数、Lambda 与高阶函数", "表达式函数与返回类型；命名/默认/vararg 参数；Lambda/尾随 Lambda/it；函数类型与函数引用；闭包与捕获；带接收者函数类型；inline/noinline/crossinline", 4),
    objects: topic("类、构造与属性", "主/次构造函数与 init；data class/copy/componentN；object/companion object；open/override/abstract/interface；属性访问器与可见性；内部类与嵌套类；enum class", 4),
    idioms: topic("空安全、扩展与语法糖", "可空类型/安全调用/Elvis；智能转换与安全强转 as?；let/run/with/apply/also 对比；扩展函数与静态分派；解构与 componentN；运算符重载与 infix；by lazy 与属性委托", 4),
    types: topic("泛型与类型建模", "sealed class/interface 与穷尽 when；泛型约束与 where；in/out 与型变；星投影；reified 与运行时类型；值类与 @JvmInline", 2),
    errors: topic("异常、资源与模块", "try 表达式/throw/finally；runCatching/Result；use 与资源关闭；包/import/别名；JVM 互操作与平台类型", 4),
    async: topic("协程与并发写法", "suspend 函数与挂起；协程作用域与结构化并发；launch/async/await；取消与超时；Flow 与 collect；Mutex/Channel；明确 kotlinx.coroutines 依赖及语言/库边界", 2),
    design: topic("依赖注入与组合", "接口与构造函数注入；by 类委托；假实现与单元替换；工厂与生命周期；不依赖 DI 框架的最小示例", 2),
  },
  swift: {
    foundation: topic("基础值与集合声明", "Int/Double/Bool/String 声明；let/var 与类型推断；Array 与初始化；Dictionary 键值声明；Set 与初始化；Optional 与 nil", 6),
    strings: topic("字符串、数值与区间", "字符串插值与多行/原始字符串；String.Index 与 Unicode；数值转换与可选结果；== 与引用身份 ===；闭区间/半开区间；元组与命名元素", 6),
    collections: topic("集合操作", "Array 增删与下标；Dictionary 默认值/遍历；Set 集合运算；map/filter/compactMap/flatMap；reduce 与 sorted；enumerated/zip；值语义与 copy-on-write；lazy 与序列", 4),
    control: topic("分支与循环", "if/else 与三元表达式；switch 与模式/where；for-in/indices/enumerated；forEach 与 for-in 的返回区别；while/repeat-while；guard 提前返回；break/continue/fallthrough", 6),
    functions: topic("函数、闭包与 Lambda", "参数标签与省略标签；默认参数/可变参数/inout；函数类型与函数传递；闭包缩写参数 $0/$1；尾随闭包；捕获列表/weak/unowned；escaping 与 autoclosure", 4),
    objects: topic("结构体、类与初始化", "struct/class 与值/引用语义；init/便捷初始化/失败初始化；存储/计算属性；属性观察器 willSet/didSet；继承/override/final；static/class 成员；访问控制；deinit 与 ARC", 4),
    idioms: topic("可选值、扩展与语法糖", "if-let/guard-let；可选链与 ??；extension 与成员扩展；属性包装器；下标 subscript；模式匹配与解构；KeyPath 基本写法", 4),
    types: topic("协议、枚举与泛型", "protocol 与默认实现；带关联值的 enum；穷尽 switch（非 sealed class）；泛型与 where 约束；associatedtype；some 与 any；Equatable/Hashable/Codable；协议组合", 2),
    errors: topic("错误、资源与模块", "Error/throws/do-catch；try?/try! 与风险；defer 清理；Result；import 与模块边界；Codable 的编码/解码", 4),
    async: topic("并发与隔离", "async/await；Task 与 async-let；任务组；取消与错误；actor 与数据隔离；MainActor；Sendable；AsyncSequence/AsyncStream", 2),
    design: topic("依赖注入与组合", "protocol 与初始化器注入；struct 组合；协议假实现；工厂闭包；依赖生命周期与强引用循环", 2),
  },
  python: {
    foundation: topic("基础值与集合声明", "int/float/bool/str 赋值；list 与索引；tuple 与不可变性；dict 键值声明（无内建 HashMap 类）；set/frozenset 与空集合；None 与动态类型", 6),
    strings: topic("字符串、运算与拆包", "f-string 与格式规格；多行/原始字符串；数值转换；切片与负索引；== 与 is；真值/and/or 短路；拆包与星号赋值", 6),
    collections: topic("集合与迭代器", "list 增删查与浅拷贝；dict get/setdefault/items；set 集合运算；列表/字典/集合推导式；sorted/key 与稳定排序；enumerate/zip；collections Counter/defaultdict/deque；iter/next 与惰性迭代", 4),
    control: topic("分支与循环", "if/elif/else；条件表达式 x if cond else y；for/range/enumerate；while；break/continue 与循环 else；match-case 与模式；无内建 forEach 方法时的惯用 for 写法", 6),
    functions: topic("函数、Lambda 与闭包", "位置/关键字/默认参数；仅位置/仅关键字参数；*args/**kwargs；lambda 与单表达式限制；高阶函数与函数对象；闭包/nonlocal/global；可变默认参数陷阱；类型标注", 4),
    objects: topic("类、初始化与数据类", "class/self/__init__；__new__ 与对象创建区别；实例/类变量；property/classmethod/staticmethod；dataclass；继承/super/多重继承与 MRO；__repr__/__eq__/__hash__", 4),
    idioms: topic("装饰器与语法糖", "函数装饰器与 wraps；带参数装饰器；生成器/yield/yield-from；with/contextmanager；海象运算符；协议式鸭子类型；模式解构", 4),
    types: topic("类型与协议建模", "泛型类型标注与 TypeVar；Protocol 与结构化类型；Union/Optional/Literal；Enum 与状态表示；TypedDict；版本相关类型语法与注解边界", 2),
    errors: topic("异常、资源与模块", "try/except/else/finally；raise 与异常链；自定义异常；文件 with/open；import/from 与 __name__；JSON 序列化", 4),
    async: topic("异步与并发", "async/await 与 asyncio.run；create_task/gather/TaskGroup；异步上下文管理与迭代；取消与异常；threading 与共享状态；multiprocessing 与进程隔离；执行模型和 GIL 的适用边界", 2),
    design: topic("依赖注入与组合", "构造函数注入与 Protocol；可调用对象/函数注入；组合与假实现；工厂函数；避免模块全局状态耦合", 2),
  },
  go: {
    foundation: topic("基础值与集合声明", "int/float64/bool/string 声明；var/:= 与 const；固定长度 array；slice 与 make；map 键值声明；map[T]struct{} 模拟 set（无内建 Set/HashMap 类）；零值与 nil", 6),
    strings: topic("字符串、数值与指针", "字符串/rune/byte 与 UTF-8；原始字符串；strconv 转换；算术/逻辑/位操作；指针 &/* 与零值；值赋值与共享底层数据", 6),
    collections: topic("数组、切片与 Map", "len/cap/append/copy；切片表达式与底层数组；map 查询 comma-ok；map delete/迭代；nil map 与空 map；排序与 slices 包；映射/过滤的循环实现；map 迭代顺序", 4),
    control: topic("分支与循环", "if 与初始化语句（无三元运算符）；三段式 for；for-range 与索引/值；for 作为 while/无限循环；switch/type switch；break/continue 与标签；select 多路通信", 6),
    functions: topic("函数、匿名函数与闭包", "多返回值与命名返回值；可变参数；匿名函数/闭包；函数类型与高阶函数；defer 求值时机；闭包捕获与循环变量版本边界", 4),
    objects: topic("Struct、方法与接口", "struct 与复合字面量；NewX 工厂惯例（无构造关键字）；值/指针接收者；接口隐式实现；嵌入与组合；导出字段与可见性；方法集", 4),
    idioms: topic("常用惯例", "comma-ok 与类型断言；空白标识符 _；iota 常量；defer 资源清理；interface nil 陷阱；函数选项模式；struct 标签", 4),
    types: topic("泛型与类型建模", "类型参数与约束；类型集合与 ~；泛型函数/类型；any/comparable；命名类型与类型别名；接口组合", 2),
    errors: topic("错误、资源与模块", "error 返回与提前退出；errors.Is/As；fmt.Errorf 与 %w；panic/recover 的边界；包/import 与 go.mod；文件关闭与 JSON 编解码", 4),
    async: topic("Goroutine 与 Channel", "go 启动与同步等待；chan 缓冲/非缓冲；发送/接收/关闭；select 与超时；context 取消；WaitGroup/Mutex；避免数据竞争/泄漏；管道与单向 Channel", 2),
    design: topic("依赖注入与组合", "小接口与工厂函数注入；struct 字段依赖；接口假实现；函数注入；组合与生命周期", 2),
  },
  java: {
    foundation: topic("基础值与集合声明", "int/long/double/boolean/String 声明；var/final 与推断限制；原始类型/包装类型；array 初始化；List/ArrayList；Map/HashMap；Set/HashSet", 6),
    strings: topic("字符串与运算", "字符串拼接/StringBuilder；文本块；数字解析与异常；equals 与 ==；装箱/拆箱；算术/逻辑/位运算；格式化字符串", 6),
    collections: topic("集合与 Stream", "集合增删查与 List.of；Map getOrDefault/computeIfAbsent；Set 集合操作；泛型集合与迭代器；Stream map/filter/flatMap；reduce/collect/groupingBy；Comparator 与排序；可变/不可变集合与拷贝", 4),
    control: topic("分支与循环", "if/else 与三元表达式；传统 for；增强 for；forEach 与 Lambda；while/do-while；break/continue 与标签；switch 语句/表达式；模式 switch 的版本要求", 6),
    functions: topic("方法、Lambda 与函数式接口", "方法定义/重载/varargs；函数式接口与 @FunctionalInterface；Lambda 的参数/返回形式；方法引用；Predicate/Function/Consumer/Supplier；闭包与 effectively final", 4),
    objects: topic("类与构造函数", "字段/构造函数/this/super；访问控制与 static/final；继承/override/abstract；interface/default 方法；record 与不可变数据；enum；内部/嵌套/匿名类；equals/hashCode 契约", 4),
    idioms: topic("常用写法与语法糖", "Optional 与避免误用；模式 instanceof；try-with-resources；record 模式的版本要求；注解的声明与用途；增强 switch 与 yield", 4),
    types: topic("泛型与类型建模", "泛型类/方法；extends/super 通配符与 PECS；类型擦除；sealed class/interface 与 permits；record/enum 状态建模；反射的使用边界", 2),
    errors: topic("异常、资源与模块", "checked/unchecked 异常；try/catch/finally/throw/throws；自定义异常与异常链；AutoCloseable；package/import 与模块；文件与标准库资源操作", 4),
    async: topic("并发与异步", "Thread/Runnable；ExecutorService/Future；CompletableFuture；synchronized/volatile/Atomic；Lock 与并发集合；虚拟线程的版本要求；资源关闭与任务取消", 2),
    design: topic("依赖注入与组合", "接口与构造函数注入；假实现与可测试性；组合与工厂；不可变依赖；不依赖 Spring 的最小 DI", 2),
  },
  javascript: {
    foundation: topic("基础值与集合声明", "number/boolean/string 声明；let/const 与作用域；Array；Object 键值；Map；Set；null/undefined 与区别", 6),
    strings: topic("字符串与运算", "模板字符串；字符串切分/拼接；数值转换与 NaN；=== 与 ==；真值与短路；算术/位运算", 6),
    collections: topic("集合操作", "数组增删查；map/filter/flatMap；reduce/some/every；sort 与比较器；Object.entries/fromEntries；Map/Set 遍历与复制；迭代器与惰性处理", 4),
    control: topic("分支与循环", "if/else 与三元表达式；经典 for；for-of/for-in 区别；forEach 与返回；while/do-while；switch/break/continue", 6),
    functions: topic("函数、Lambda 与闭包", "function 与箭头函数；默认/剩余参数；高阶函数与闭包；this/call/apply/bind；函数提升；递归与作用域", 4),
    objects: topic("类与原型", "class/constructor；extends/super；getter/setter/static；私有字段；prototype 与继承；对象组合", 4),
    idioms: topic("语法糖与惯用写法", "解构与默认值；展开语法；?. 与 ??；逻辑赋值；对象简写与计算属性；生成器与 yield", 4),
    types: topic("对象协议与类型检查", "typeof/instanceof；Symbol 与迭代协议；属性描述符；代理 Proxy；运行时检查与鸭子类型", 2),
    errors: topic("异常与模块", "try/catch/finally/throw；自定义 Error；ES import/export；JSON 转换；资源与环境 API 边界", 4),
    async: topic("异步", "Promise；async/await；Promise.all/allSettled；错误与取消；异步迭代；事件循环与微任务", 2),
    design: topic("依赖注入与组合", "构造函数注入；函数注入；假实现；工厂与闭包；避免全局依赖", 2),
  },
  typescript: {
    foundation: topic("基础类型与集合声明", "number/boolean/string 注解；let/const 与类型推断；Array/ReadonlyArray；Record 对象键值；Map；Set；null/undefined 与 strictNullChecks", 6),
    strings: topic("字符串、运算与元组", "模板字符串；字符串/数值转换；严格相等；真值/短路；tuple 与 readonly；可选元组元素", 6),
    collections: topic("集合操作", "数组增删查与只读边界；map/filter/reduce；类型谓词过滤；Object.entries 与键类型；Map/Set 遍历；sort 比较器；拷贝与共享引用", 4),
    control: topic("分支与循环", "if/else 与三元表达式；经典 for；for-of/for-in 区别；forEach；switch 与控制流收窄；break/continue/while", 6),
    functions: topic("函数与 Lambda", "函数类型与箭头函数；可选/默认/rest 参数；泛型函数；重载签名；闭包与 this 类型；高阶函数", 4),
    objects: topic("类与接口", "interface/type 与结构化类型；constructor 与参数属性；public/private/protected/readonly；abstract/extends/implements；getter/setter/static；对象组合", 4),
    idioms: topic("语法糖与类型收窄", "解构/展开；?. / ??；可辨识联合；as const 与 satisfies；类型守卫；非空断言风险", 4),
    types: topic("高级类型", "泛型约束与 keyof；索引访问类型；映射类型；条件类型与 infer；工具类型 Partial/Pick/Omit；模板字面量类型；unknown/never 与穷尽检查", 2),
    errors: topic("异常与模块", "try/catch 的 unknown；自定义 Error；import/export 与类型导入；JSON 的运行时校验；类型不替代运行时检查", 4),
    async: topic("异步", "Promise 泛型；async/await 返回类型；并发 Promise；错误与取消；异步迭代；运行时环境边界", 2),
    design: topic("依赖注入与组合", "interface 与构造函数注入；函数类型注入；假实现；工厂；组合与依赖生命周期", 2),
  },
} satisfies Record<Language, Record<string, TopicSpec>>;

export type LanguageSelection = { language: Language; topic: string };
export type DrillContent = {
  title: string; introduction: string; starterCode: string; templateCode: string; requirements: string[];
  exercises: { title: string; instruction: string; concepts: string[]; explanation: string; benefits: string[]; pitfalls: string[] }[];
};
export type LanguageDrill = DrillContent & LanguageSelection & {
  id: string; createdAt: string; updatedAt: string; code: string; concepts: string[]; revealedAt?: string; selectionTopic?: string;
};
export function languageSelection(value: unknown): LanguageSelection {
  const v = object(value);
  if (typeof v.language !== "string" || !Object.hasOwn(LANGUAGES, v.language) || typeof v.topic !== "string" ||
      (v.topic !== "auto" && !Object.hasOwn(LANGUAGE_SYLLABUS[v.language as Language], v.topic))) throw new AppError(400, "请选择有效的语言与练习方向。");
  return { language: v.language as Language, topic: v.topic };
}
export function languageFocus(selection: LanguageSelection, drills: LanguageDrill[]) {
  const syllabus: Record<string, TopicSpec> = LANGUAGE_SYLLABUS[selection.language];
  const count = (concept: string, id: string) => drills.filter(d => d.language === selection.language && d.topic === id && d.concepts.includes(concept)).length;
  const topics = Object.entries(syllabus);
  const id = selection.topic === "auto"
    ? topics.find(([id, spec]) => spec.concepts.some(c => !count(c, id)))?.[0]
      ?? [...topics].sort(([a, x], [b, y]) => x.concepts.reduce((n, c) => n + count(c, a), 0) / x.concepts.length - y.concepts.reduce((n, c) => n + count(c, b), 0) / y.concepts.length)[0][0]
    : selection.topic;
  const spec = syllabus[id];
  const concepts = [...spec.concepts].sort((a, b) => count(a, id) - count(b, id)).slice(0, spec.batch);
  return { language: selection.language, topic: id, spec, concepts };
}
function strings(value: unknown, min = 0, max = 12): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AppError(400, "语言练习列表格式不正确。");
  return value.map(v => text(v, 6000));
}
export function drillContent(value: unknown, focus: string[]): DrillContent {
  const v = object(value);
  if (!Array.isArray(v.exercises) || v.exercises.length < 1 || v.exercises.length > 6) throw new AppError(400, "语言练习数量不正确。");
  const exercises = v.exercises.map(value => {
    const e = object(value), concepts = strings(e.concepts, 1, 6);
    if (concepts.some(c => !focus.includes(c))) throw new AppError(400, "知识点与题目不匹配。");
    return { title: text(e.title, 150), instruction: text(e.instruction, 5000), concepts,
      explanation: text(e.explanation, 6000), benefits: strings(e.benefits, 1), pitfalls: strings(e.pitfalls) };
  });
  if (focus.some(c => !exercises.some(e => e.concepts.includes(c)))) throw new AppError(400, "语言练习没有覆盖本次知识点。");
  return { title: text(v.title, 150), introduction: text(v.introduction, 6000), starterCode: text(v.starterCode, 30000),
    templateCode: text(v.templateCode, 50000), requirements: strings(v.requirements, 1), exercises };
}
