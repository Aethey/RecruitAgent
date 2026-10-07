# 源码结构

后端按业务模块组织，应用入口负责装配；模型接入、任务执行、持久化和契约生成各有明确位置。

```text
src/
├── server.ts                 # 启动、端口和进程退出
├── app/                      # 服务装配、HTTP 路由、模型提示词关联和任务配置
├── features/
│   ├── algorithm/            # 算法题、提示、评估和掌握分析
│   ├── language/             # 语言写法练习
│   ├── interview/            # 面试题、资料来源、职位导入和语音面试
│   ├── training/             # 回答压缩、追问、故障诊断和面试复盘
│   ├── study/                # 知识短测、复习安排和技术广度
│   ├── library/              # 资料导入、读取和模型整理
│   └── chat/                 # 页面聊天和实时教师
├── integrations/
│   ├── pi/                   # 文本模型接入和 OAuth 交互
│   └── codex/                # App Server RPC、语音连接和选项
├── shared/
│   ├── ai/                   # 模型调用接口、结构化输出与解析
│   ├── tasks/                # 单任务执行、进度、取消、超时和历史
│   ├── persistence/          # 应用状态类型、原子存储和备份
│   ├── i18n/                 # 语言定义与文案访问
│   └── *.ts                  # SSE、诊断日志、错误、输入校验和编程语言目录
├── contracts/                # HTTP、SSE、模型与原生 RPC 的契约和校验入口
└── generated/                # CLI 生成的类型、Schema 和校验器
```

## 修改入口

| 要修改的内容 | 所属位置 |
| --- | --- |
| 某个业务的类型、语义校验 | 对应 `features/*/domain.ts` 或现有 `service.ts` |
| 生成、评估、模型结果保存 | 对应 `features/*/tasks.ts` |
| 业务系统提示词 | 对应模块的 `prompt.ts`；聊天使用 `prompts.ts` |
| 训练创建、草稿保存和参考答案揭晓 | `features/training/service.ts` |
| 模型认证、请求、流式回调和资源清理 | `integrations/pi/` |
| 原生语音连接和控制 | `integrations/codex/` |
| 全局任务生命周期 | `shared/tasks/executor.ts` |
| API 请求、响应或事件结构 | `contracts/api.ts`，然后运行生成命令 |
| 持久化数据结构 | `shared/persistence/state.ts` 与对应业务类型 |

`app/http.ts` 创建共享的任务执行器，再把它交给各业务任务服务。因此各业务仍遵循同一套并发限制、取消、事件与任务历史规则。开始文案、模型模式和超时由 `app/task-policy.ts` 提供。

Pi 接入层接收应用装配时传入的提示词选择函数。业务提示词由各业务模块维护；修改提示词从对应模块开始。

业务模块仍共用一份 `data/state.json`，由存储层串行写入并原子替换。此次目录整理保持已有数据格式、HTTP 接口、启动命令和前端页面结构。HTTP 路由统一位于 `app/http.ts`。

## 生成与验证

生成产物由脚本维护，随源码提交。修改业务契约或来源路径后执行：

```sh
npm run generate
npm run check
npm test
```

升级 Codex CLI 协议时使用 `npm run generate:codex`；需要一起生成时使用 `npm run generate:all`。`generated:check` 重建并比较产物，发现缺失或过期文件会失败。
