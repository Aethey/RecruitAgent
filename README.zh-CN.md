# RecruitAgent

[日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

为面向日本转职准备而开发的本地 AI 面试与学习工具。围绕经历整理、日语面试表达和技术复习，整合面试准备、算法与编程语言练习、知识复习、本地资料库和页面聊天。语音面试与语音 Demo 为可选功能。

代码采用 MIT 许可。你的资料、学习记录和登录凭据保存在本机；调用 AI 时，会把当前任务需要的题目、代码、资料或音频发送给相应服务。

## 主要功能

- 面试准备：根据自己的简历、项目经历和职位 JD 准备共通问题、技术追问和职位定制问题。
- 表达与复盘：练习先说结论，再说明本人行动与验证；区分真实经历与学习材料。
- 技术复习：算法、编程语言、工程情境训练、技术广度测验和知识卡片。
- 本地资料与记录：管理学习资料、回看练习、安排复习，并随时备份。
- 多语言：界面与 AI 输出语言分别设置，支持日语、英语和中文。

## 界面预览

以下截图展示日语界面。语音面试图片截取自实际运行的应用，不含个人资料或账号标识；其他图片使用隔离的演示数据。截图中的 `Test Model` 为演示模型。

### 面试准备

选择面试类型和练习方向，使用自己选择的资料准备问题。

![日语面试准备：面试类型、出题选项与表达提示](docs/images/interview-practice.jpg)

### 语音面试

选择面试语言、音色和语气，用语音回答 Codex 的提问，在同一页面查看回答转写与点评。

![日语语音面试：语音设置、题目、回答与点评](docs/images/voice-interview.png)

### 算法练习

阅读题目、编写代码，按需查看提示或提交静态评估。

![算法练习：题目、代码编辑器与提示入口](docs/images/algorithm-practice.jpg)

### 技术广度

按技术领域与知识方向选择练习，逐步补齐知识地图。

![技术广度：知识领域与测验选项](docs/images/technical-breadth.jpg)

### 知识卡片

在知识卡片入口按领域选择内容，再开始浏览。

![日语知识卡片入口：领域分类与开始浏览](docs/images/knowledge-cards.jpg)

## 下载与启动

需要 **Node.js 22.19.0 或更新版本**（包含 npm）。首次启动需要联网下载依赖，之后每次启动会构建网页资源。

下载 GitHub 的项目 ZIP 并解压，或克隆仓库。进入项目目录后：

- macOS：双击 `start.command`。若下载后执行权限丢失，在终端执行 `chmod +x start.command`。
- Windows：双击 `start.cmd`。
- Linux：在终端执行 `sh start.sh`。

也可以在三种系统的终端中运行：

```sh
node scripts/launch.mjs
```

启动器检查 Node 版本和端口、按锁文件安装缺少的依赖、构建前端并打开浏览器。默认地址为 [http://localhost:3000](http://localhost:3000)。关闭服务用 `Ctrl+C`。

已安装依赖时可使用 `npm start`；检查环境用 `npm run doctor`。依赖更新后先运行 `npm ci --ignore-scripts`。

## 第一次使用

界面默认为中文。要使用日语，在「设置 → 语言设置」将「界面语言」和「用户语言」都设为「日本語」并保存。已有资料与 AI 内容保留原文，新生成内容跟随用户语言。内置知识卡片使用三语资源，正文跟随用户语言。

1. 打开「设置 → 开始使用」，点击右上角「连接 Codex」。
2. 在 OpenAI 官方页面用自己的账号完成授权。实际模型权限和额度以请求结果为准。
3. 算法、语言、学习、聊天可以直接使用。面试练习先在资料库上传自己的 PDF 或 Markdown，再在「面试练习 → 出题资料」选择用途并保存。
4. 至少选择一份「简历 / 项目经历」；本人案例与技术学习材料分别选择，避免把学习材料当成真实经历。
5. 扫描 PDF 或图片先在资料库整理以取得文字。也可参考 `examples/resume-template.md` 填写真实项目经历。

浏览和上传文字资料不调用模型；自动整理、AI 练习和聊天会调用模型。生成代码的评价是静态评估，不会执行用户代码。

授权弹窗被阻止时，使用页面中的「打开授权页面」。本机回调端口冲突时，按授权对话框提示粘贴回调 URL；不要粘贴 API Key 或 OAuth token。

## 可选语音功能

语音功能另外依赖本机 **Codex CLI**，使用 CLI 自己的登录。安装方式见 [Codex CLI 官方说明](https://developers.openai.com/codex/cli)。安装后在终端运行：

```sh
codex login
```

再到「设置 → 开始使用」检查语音连接，或打开语音 Demo。顶部网页授权用于文字功能，不替代 CLI 登录。未安装或未登录 CLI 时，其余学习功能仍可使用。

语音使用实验性的 Codex app-server / WebRTC 接口；可用性受 CLI 版本、账号和服务端权限影响。允许麦克风后才开始录音。面试保存回答转写和点评，Demo 不保存录音或字幕。通话时相关音频发送给 OpenAI。

## 配置

将 `.env.example` 复制为 `.env`，按需要修改。启动时自动加载，终端已设置的环境变量优先。相对目录以项目目录为基准。

| 变量 | 默认 / 用途 |
| --- | --- |
| `PORT` | `3000`，本机服务端口 |
| `DATA_DIR` | `./data`，学习记录、凭据和资料原文件的目录 |
| `SOURCE_DIR` | `./sources`，兼容导入已有 PDF / Markdown 的目录，可不创建 |
| `PI_MODEL` | `gpt-5.5`，首次使用的文字模型；已保存的模型选择优先 |
| `CODEX_BIN` | `codex`，语音使用的 CLI 路径 |
| `OPEN_BROWSER` | 启动器默认 `1`；改为 `0` 可关闭自动打开浏览器 |

修改配置后重启。端口被占用时修改 `PORT`，无需修改代码。模型列表从后端 SDK 读取，可在页面选择与设置显示范围。

旧版本的 `data/state.json` 与原有资料目录继续兼容；保存新的出题资料选择后，面试以选择的资料为准。资料目录不会随公开代码发布。

## 备份与恢复

在「设置 → 数据备份」下载 `.json.gz` 备份。也可停止应用后运行：

```sh
npm run backup
```

默认写入 `backups/`；指定文件名：

```sh
npm run backup -- backups/my-study.json.gz
```

备份含学习记录与资料库原文件，**不包含登录凭据、Pi 会话和语音日志**。备份含个人资料，不应提交到 GitHub。内置备份上限为 512 MB；更大的资料库请停止应用后直接复制整个数据目录，注意该目录同时包含凭据。

恢复必须指定一个尚不存在的新目录：

```sh
npm run restore -- backups/my-study.json.gz --data-dir ./data-restored
```

恢复会检查格式、校验和与文件路径，保留现有目录。停止应用后将 `.env` 的 `DATA_DIR` 改成 `./data-restored`，再启动并重新授权。升级步骤见 `docs/release-checklist.md`。

## 通信日志

每次 Codex 文字请求、语音 RPC 和关键通话状态都会写入 `data/logs/codex.jsonl`（自定义 `DATA_DIR` 时位于该目录的 `logs/`）。日志包含 UTC 时间、实例与请求 ID、会话/线程 ID、模型、耗时、结果及脱敏错误；HTTP 响应的 `X-Request-ID` 可用于关联请求。浏览器会记录连接、录音、回复和音频验证状态变化。

日志不保存问题/回答正文、简历、音频、图片、SDP 或登录凭据。每个文件最多约 5 MB，保留当前文件和三份轮转文件；日志不会进入 Git、发布包或数据备份。可用 `tail -f data/logs/codex.jsonl` 查看。面试回答正文仍保存在原有面试记录中。

模型菜单中的失败结果表示上次检查结果；本次通话连接和收到音频后的状态优先显示。单轮后台失败不会等同于整个语音连接失效，后续回复恢复时会清除旧提示。

## 开发与发布

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run release:check
npm run release:prepare
```

`release:prepare` 在 `release/` 生成独立的公开项目目录和文件校验清单；只复制代码、公开文档、已审核的演示截图、合成测试资料与模板，不复制个人资料、凭据、依赖目录、未审核截图或现有 Git 历史。可从该目录创建 GitHub 仓库。

已有 `.gitignore` 不会清理已经提交的敏感文件。上传原工作目录前，按 `docs/release-checklist.md` 检查待提交文件与历史。

CI 配置覆盖 Linux、macOS、Windows；实际结果以 GitHub Actions 为准。合成模型测试验证程序逻辑，不代表真实账号、额度、麦克风或实验语音接口已验证。

服务只监听本机回环地址，适合每个人在自己的电脑上运行；GitHub 提供下载与源码托管。此版本不提供公网多人访问。

[CLI 生成与类型安全](docs/code-generation.md)

## 多语言资源与代码生成

界面文案统一维护在 `public/locales/zh.json`、`public/locales/ja.json` 和 `public/locales/en.json`。三份资源使用相同的固定 key，新增文案时填写全部三种译文；修改文案时保留 key，并同步更新对应译文。

```sh
npm run i18n:generate
npm run i18n:check
```

`i18n:generate` 读取本地资源，生成 `src/generated/localizations.ts` 的文案 key、参数类型和访问接口。**它生成代码，不生成译文，也不调用模型或翻译服务。** 生成文件由 CLI 维护，不直接编辑。

页面通过 `t('ui.startVoiceInterview')` 访问文案；动态文案使用命名参数，例如 `t('voice.stats', {seconds, sent, received})`。资源检查会拒绝三语 key 不一致、空译文、占位符不一致、过期生成代码，以及直接写入界面代码的中文。`npm run check` 同时执行这项检查和前后端类型检查。

用户资料、回答、代码及保存的 AI 正文保留原文。
