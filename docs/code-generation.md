# CLI 生成与类型安全

业务类型由各领域模块维护；`src/contracts.ts` 负责声明 HTTP、SSE、模型输出和备份的边界，复用现有领域类型。生成器产出契约、类型和校验器，业务逻辑与语义规则仍由应用代码负责。

| 权威来源 | CLI 产物 | 使用位置 |
| --- | --- | --- |
| `src/contracts.ts` 与领域类型 | OpenAPI 3.1、API 客户端类型、JSON Schema、Ajv 独立校验器 | HTTP 请求/响应、前端 API、存储、备份、SSE |
| `ModelOutputs` | 模型输出 Schema、运行时校验器 | 结构化模型提示词与解析；校验后再执行业务规则 |
| 固定版本 `@openai/codex` CLI | 官方 App Server TypeScript 类型和 JSON Schema、方法/响应映射 | 语音 RPC 参数、返回值与通知校验 |

```sh
npm run generate       # 修改业务契约后重新生成
npm run generate:codex # 更新官方 Codex 协议产物
npm run generate:all   # 顺序生成协议和业务契约
npm run check          # 校验产物一致性 + 后端严格类型检查 + 前端 checkJs
npm test              # 运行回归测试（包含前端构建）
```

`src/generated/` 中的文件需要随源码提交，禁止手工修改。`generated:check` 在临时目录/内存重建并比较，不修改工作区；发现缺失或过期产物就失败。`npm run build` 也检查业务契约一致性。CI 在 Linux、macOS、Windows 执行相同检查。

新增接口：在 `ApiEndpoints` 声明请求和响应，实现路由与业务规则，运行生成命令。前端 `createApiClient` 会按方法和路径推导请求/返回类型，并在网络边界校验。动态任务提交会验证实际选中接口的请求。文件上传/下载和 SSE 流使用原有传输实现，JSON 返回与 SSE 事件分别校验。

模型输出先经过生成的结构校验，再经过原有长度、取值范围、引用与事实边界规则。存储加载、原子写入和备份恢复也验证嵌套结构；无效数据会被拒绝，原文件保留。旧版可选字段继续兼容。

Codex 协议来自固定版本 CLI，默认运行项目安装的同一版本；`CODEX_BIN` 仍支持显式覆盖，但使用其他版本时需要确认协议兼容。升级 CLI 时同时更新锁文件、重新生成协议并运行完整检查。生成器消除了本机绝对路径，产物可跨电脑复现。

前端现有 JavaScript 已加入 `checkJs`，API、SSE 和新增 TypeScript 边界有类型约束。现有 JS 尚未全面开启 `noImplicitAny` 与严格空值检查；CLI 生成也不能证明业务逻辑或模型内容正确，仍需回归测试和真实环境验证。

工具链固定使用 TypeScript 5.9.3，与 `typescript-json-schema` 的编译器版本一致；升级 TypeScript 时需同步确认生成器兼容性并重新生成。

2026-10-05 依赖审计：现有 Pi SDK 0.99.2 的内置 shrinkwrap 固定了 `brace-expansion` 5.0.9，存在一个高风险审计项；普通 update/override 不生效，0.99 系列没有更新补丁。本次新增生成工具依赖未增加审计项。该问题需要后续验证 Pi SDK 跨版本升级，不能把契约检查通过等同于依赖审计完全通过。
