# Pi 模型目录、认证与上游适配规范

- 状态：进行中（Pi 驱动的模型目录与通用 OAuth 发现已接入；认证交互专项验证和厂商政策核验仍需完善）
- 更新日期：2026-09-28
- 范围：Microcode 对 `pi-ai` / `pi-agent-core` 的模型目录、Provider 认证、上下文窗口和上游版本更新流程
- 当前基线：`@earendil-works/pi-ai@0.87.1`、`@earendil-works/pi-agent-core@0.87.1`，以 `package.json` 与 `bun.lock` 为准

## 1. 目标与更新原则

Microcode 使用 Pi 提供的 Provider、模型目录、API 适配器和认证实现，尽量不复制上游数据或另写厂商协议。厂商经常新增模型、调整上下文窗口、模型能力和认证方式，因此项目应及时跟进 Pi 的正式发布；但已发布的 Microcode 使用锁定并打包的依赖，**不会在运行时自动获得上游更新**。

“及时更新”指持续关注上游、尽快评估兼容版本，并通过更新依赖、测试、构建和发布把变化带给用户；不指启动时动态下载最新目录或未审核地切换认证实现。可自动化上游版本监测或更新 PR，但不得绕过锁文件、验证和发布流程直接改变用户正在运行的程序。

上游的模型目录和 Provider 定义是运行时事实来源。任何目录快照、发布说明或社区报告都只是更新线索，合并版本前必须核验精确依赖包中的实现。遇到供应商未被 Pi 支持的模型或认证需求，优先向 Pi 社区贡献通用 Provider/API 适配，而不是在 Microcode 内复制协议。

## 2. 当前架构与职责边界

- `src/models/registry.ts` 使用 `builtinModels()` 建立共享 Pi `Models` 集合，并注入 Microcode 的 `EncryptedCredentialStore`。
- `src/models/authChoices.ts` 按 Provider 的 OAuth/API-key 描述生成登录选项；TUI 不维护逐厂商认证分支。
- `src/tui/app.ts` 通过 Pi 的 `models.login()`、`checkAuth()` 和 `logout()` 执行登录、状态检查和退出；Pi Provider 实现 OAuth 登录、刷新、凭证转换和请求认证。
- `src/entry.ts` 调用 `registerBunOAuthFlows()`，将 Pi 的动态 OAuth loader 注册为 Bun standalone 编译可用的静态实现。
- `src/models/EncryptedCredentialStore.ts` 实现 Pi 的凭证存储接口，负责加密持久化。不得新增与 Pi 并行的 OAuth token 文件或供应商专属凭证缓存。
- `src/models/custom.ts` 支持用户自定义 API-compatible 模型；当前自定义模型只支持 API key，不允许通过配置执行任意 OAuth 回调代码。

按 Provider 而不是单个模型管理认证：一个 Provider 可以提供多个模型，模型元数据和认证协议属于不同层。除确有 Pi 不支持且厂商允许的行为外，不要在 Microcode 为每家厂商另建 OAuth 实现文件。

## 3. 当前 Pi Provider 认证目录

下表是锁定的 `pi-ai@0.87.1` 目录快照，须由 `builtinProviders()` 和实际注册的 `Models` 集合验证；未来版本可能变化。自动化代码和测试不得把这张静态表当作发现新 Provider 的实现机制。

| Provider ID | 当前认证描述 | 说明 |
|---|---|---|
| `anthropic` | API key + 订阅 OAuth | Pi 提供 Claude Pro/Max OAuth。 |
| `openai-codex` | 订阅 OAuth | Pi 提供浏览器和 device-code 登录；Microcode 不重复包装。 |
| `github-copilot` | API key/token + 订阅 OAuth | OAuth 和模型可用性由 Pi 管理。 |
| `kimi-coding` | API key + 订阅 OAuth | Pi 提供 Kimi Code 设备授权流程。 |
| `xai` | API key + 订阅 OAuth | Pi 将 OAuth 标注为 SuperGrok/X Premium。 |
| `meta` | API key + 订阅 OAuth | Pi 将 OAuth 标注为 Muse 订阅。 |
| `openrouter` | API key + 非订阅 OAuth | OAuth 用于账户关联/获取用户 API key，不应描述为消费者订阅登录。 |
| `radius` | API key + 非订阅 OAuth | 网关账户认证，不应描述为模型厂商订阅。 |

当前目录中的其他 API-key Provider ID 为：

`amazon-bedrock`、`ant-ling`、`azure-openai-responses`、`baseten`、`cerebras`、`cloudflare-ai-gateway`、`cloudflare-workers-ai`、`deepseek`、`fireworks`、`google`、`google-vertex`、`groq`、`huggingface`、`minimax`、`minimax-cn`、`mistral`、`moonshotai`、`moonshotai-cn`、`nvidia`、`openai`、`opencode`、`opencode-go`、`qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual`、`together`、`vercel-ai-gateway`、`xiaomi`、`xiaomi-token-plan-ams`、`xiaomi-token-plan-cn`、`xiaomi-token-plan-sgp`、`zai`、`zai-coding-cn`。

若 Pi 新版本新增 OAuth Provider，目录驱动的 UI 应自动显示该选项，并由对应 Pi Provider 完成登录；若新增云身份或其他非交互认证，只展示其实际支持的配置指引，不得虚构 OAuth 流程。

## 4. 认证、订阅与凭证规则

### 4.1 按能力展示认证选项

登录方式从实时 Provider descriptor 获取：

1. `provider.auth.oauth` 存在时展示 OAuth；`isSubscription` 用来区分订阅授权和普通账户关联。优先使用上游 `loginLabel`、`name` 等文案。
2. 仅当 `provider.auth.apiKey.login` 存在时展示交互式 API key 登录。
3. 不为 API-key-only Provider 展示 OAuth，也不将所有 OAuth 一概标为浏览器登录或订阅登录。
4. 多种方式并存时由用户选择；不得因已保存 API key 就忽略用户明确选择的 OAuth。
5. `authChoices.test.ts` 应动态遍历精确锁定版本的 Provider 目录，验证 OAuth/API-key 选项、订阅标签和注册实现；更新 Pi 时应自然暴露目录变化，而非手工维护多处厂商清单。

Pi 包含 OAuth 代码只证明技术实现存在，不自动证明所有地区、账户等级、商业分发或第三方客户端使用都获得供应商许可。发布订阅 OAuth 前，应记录该供应商的政策来源、适用账户/地区、核验日期、负责人和发布决定。政策不清楚时将 OAuth 保持为 gated；可以保留厂商允许的 API key 或云身份路径。

不得读取其他 CLI 的凭证文件、浏览器 cookie、设备身份或密钥链条目来冒充其客户端；不得抓取私有接口，也不得复用未获许可的第一方 client ID。Google Gemini Code Assist/Gemini CLI 消费者 OAuth 在当前基线中明确排除；继续支持公开 Gemini API key 和 Google Cloud/Vertex 路径，不导入 Gemini CLI token。

### 4.2 登录生命周期

- 把 `AbortSignal` 传给 Pi 登录调用和提示交互；支持 Provider 的 `select`、`secret`、`text`、`manual_code` 提示。
- `auth_url` 和 `device_code` 的链接必须验证为 HTTP(S)，在尝试打开浏览器的同时保留可见、可复制的 URL；设备码及验证地址在轮询期间应保持可见。
- 展示 Pi 提供的说明、进度和信息，但不得在 TUI 状态、日志或错误中泄露 access token、refresh token、设备 token、授权码或回调查询参数。
- 只有 `models.login()` 成功返回且 Pi 凭证存储成功后才能报告登录成功。打开浏览器不是授权成功；设备码流程必须等待用户授权及 token exchange 完成。
- 用户取消时中止登录、恢复提示/浏览器回调资源，不得留下部分凭证；错误消息应有帮助且经过脱敏。
- 不在常规 CI 调用供应商 OAuth 网络端点。真实登录 smoke test 只能由有权限的人员使用专用、非生产测试账户手动执行。

### 4.3 API key、云身份与计划型产品

供应商以兼容 API 提供 Coding Plan，不代表该服务使用 OAuth；API 兼容套餐仍按其官方要求使用 API key、专属 endpoint、API dialect 和模型目录。云平台身份或 ambient credentials 继续走 Pi 支持的云身份路径，不转换成通用 OAuth。

Alibaba Model Studio 的当前 `qwen-token-plan*` Provider 表示 Token Plan endpoint，不能因为同属月付方案就当作 Alibaba Coding Plan。若后续新增 Coding Plan，先核验专用密钥、endpoint、API 兼容性、模型 allowlist 和用途限制，并优先向 Pi 社区贡献 Provider。Xiaomi 区域 Token Plan 和 Z.AI Coding Plan 同样保留各自 Provider ID、凭证环境变量和 endpoint。

计划专用密钥不得回退到通用 key；不得静默改写 base URL 以切换计费产品。认证状态可以显示 Provider ID、endpoint 类型和凭证来源，但绝不显示 secret 值。自定义模型的 `contextWindow` 必须显式配置，且不得从 endpoint 或 key 推断。

## 5. Pi 依赖更新与社区协作流程

### 5.1 发现与评估

1. 检查 Pi 正式发布和上游社区的变更线索；核对 `pi-ai`、`pi-agent-core` 的兼容版本、release notes 和目标 Provider/model 变更。社区讨论是线索，不是运行时支持承诺。
2. 对照本项目当前锁定版本的 Provider ID、模型 ID、`provider`、`api`、`contextWindow`、`maxTokens`、模态、价格元数据、认证描述、OAuth loader、API adapter、callback/device-code 行为及 agent-core 压缩默认值。
3. 供应商刚发布模型但 Pi 尚未支持时，先确认 Pi 上游是否已有进行中的实现；能复用的通用变更应向 `earendil-works/pi` 提交 issue/PR。除非上游阻塞且有明确必要性、兼容性和维护计划，不在 Microcode 内复制 Provider 协议或目录。
4. 价格/订阅元数据只表示上游目录描述，不代表 Microcode 账单，也不能据此推断用户订阅额度。

### 5.2 升级与验证

仓库目前将 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 保持同一精确版本；除非 Pi 发布说明明确要求，否则升级时继续成对更新：

```sh
bun add --exact @earendil-works/pi-ai@<version> @earendil-works/pi-agent-core@<version>
```

同步提交 `package.json`、`bun.lock`、因目录/认证变化需要的代码和目录驱动测试。升级前先在精确锁定的已发布包中检查实现，不以 Pi `main` 分支或 README 替代包内事实。完成仓库测试、类型/构建验证和 standalone 编译后，再打包、发布 Microcode；用户安装新版本后才能获得新目录。

建议的本地验证命令：

```sh
bun test ./tests
bun run build --no-install
```

`bun run build` 默认也会安装生成的二进制；验证时优先使用 `--no-install`，避免覆盖用户已安装版本。编译 smoke 验证静态 OAuth loader 是否可打包及 CLI 是否启动，但不等同于用真实账号走完供应商授权。提交前检查 `git diff --check` 和构建产物状态。

### 5.3 发布节奏

上游监测可以高频或自动运行，并生成升级候选/PR；正式版本仍通过依赖锁定、变更审查、测试与构建发布。不得将某厂商官网的新模型宣传直接等同于 Pi 已收录，也不得宣称 Microcode 已支持尚未随版本打包的模型。发布说明应指出新增/变更 Provider、模型、上下文窗口或认证方式及已知限制。

## 6. 模型目录与上下文窗口

内置模型的上下文窗口取自锁定 `pi-ai` 模型对象的 `contextWindow`，Microcode 不再维护平行的内置上下文窗口表。`BASE_URL` 等环境变量可以覆盖 API 地址，但不能改变模型目录给出的窗口。自定义模型从用户级 `~/.microcode/config.json` 或项目级 `.microcode/config.json` 读取，必须显式提供 `contextWindow`，其值原样进入模型对象。

切换模型时，Agent 与 `CompactionManager` 更新为当前模型的窗口。`src/agent/MicrocodeAgent.ts` 将 `transformContext` 交给 pi-agent-core；每次模型请求前运行 `prepareModelContext()` 和 `compactIfNeeded()`：

1. 先清理符合条件的旧工具输出，同时保留每类工具最近三个结果；该步骤不调用模型。
2. `CompactionManager.isCompactionNeeded()` 用当前模型的 `contextWindow` 检查本地 token 估算，再与 pi-agent-core 默认压缩阈值比较。
3. 当前锁定版本默认启用自动压缩，`reserveTokens` 为 16,384；估算用量**大于** `contextWindow - reserveTokens` 时触发。
4. Microcode 的消息估算大致为每四个字符一个 token，图片使用固定估值，仅是保护性近似值，不是供应商精确 token 数；界面上下文用量也基于该估算。
5. 触发后用当前模型概括较早对话并保留近期内容。用户可用 `/compact` 手动触发。自动概括失败时保留轻量压缩结果并继续请求；实际上下文仍可能超过供应商限制并被拒绝。

升级 `pi-ai` 或 `pi-agent-core` 时，必须检查模型目录字段及压缩默认值变化是否需要调整 Microcode 行为，并确认切换模型后压缩检查仍使用所选模型窗口。

## 7. 验收清单

- `/model list` 来自当前锁定 Pi 包的目录；每个 Provider/model 在运行时只出现一次，目录变化的来源可追溯。
- `/login`、`/auth`、`/logout` 的认证能力与 Provider `auth` 元数据一致；所有 `auth.oauth` Provider（包括非订阅 OAuth）均能被目录驱动发现，API-key-only Provider 不出现 OAuth 选项。
- 订阅 OAuth 与账户关联文案有区分；未确认厂商政策的 OAuth 不被宣称为普遍可用。Google 消费者 OAuth 不导入。
- API key、云身份和计划专属 endpoint/key 遵循各自 Pi Provider 定义；不存在静默跨计费产品的 key fallback 或 base URL 替换。
- 登录覆盖 browser URL、device code、manual code、prompt/cancel、错误和成功时机；Pi 负责 credential refresh 和 request auth，Microcode 加密凭证存储；没有密钥/token/授权码泄露。
- OAuth 交互、凭证刷新、logout、失败和并发 store 行为有不依赖供应商密钥的专项测试；live OAuth 仅做手动账号授权验证。
- Bun standalone 构建可包含锁定 Pi 包提供的全部 OAuth loader，且编译 CLI 能启动；不得只以开发模式可用作为打包成功证据。
- 上游更新包含配套测试、锁文件、构建验证和可读发布说明；用户必须安装新版才能取得上游新目录。

当前已完成 Provider 驱动的登录方式发现、8 个锁定 Pi OAuth Provider（6 个订阅 OAuth + OpenRouter/Radius 2 个非订阅 OAuth）的目录覆盖，以及 Codex 重复包装移除。常规测试与编译已通过；真实供应商登录、完整 OAuth 交互专项测试和逐厂商政策/地区/账户资格核验仍是待办。

## 8. 代码入口

- `src/models/registry.ts`：Pi 内置模型目录、共享 `Models` 集合、自定义 Provider。
- `src/models/authChoices.ts`：Provider 驱动的登录选项生成。
- `src/models/EncryptedCredentialStore.ts`：Pi 凭证存储接口与加密持久化。
- `src/entry.ts`：Bun standalone OAuth loader 注册。
- `src/tui/app.ts`：`/login`、`/logout`、`/auth`、提示与浏览器链接。
- `src/models/custom.ts`：用户自定义模型定义和 `contextWindow`。
- `src/agent/MicrocodeAgent.ts`：请求前上下文转换和自动压缩入口。
- `src/session/CompactionManager.ts`：轻量压缩、阈值判断和摘要压缩。
- `tests/models/authChoices.test.ts`：Pi Provider OAuth/API-key 发现覆盖。
- `package.json` 与 `bun.lock`：本项目实际使用的上游精确版本。

## 9. 上游与产品参考

上游包中的精确实现是本项目认证和目录行为的第一事实来源。外部链接用于理解项目、社区和厂商政策；每次更新时应重核其有效性。

- Pi `pi-ai` Provider/OAuth 设计：<https://github.com/earendil-works/pi/blob/main/packages/ai/README.md#oauth-providers>
- Pi 内置 Provider 注册：<https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/all.ts>
- Pi Bun OAuth loader：<https://github.com/earendil-works/pi/blob/main/packages/ai/src/bun-oauth.ts>
- Pi Kimi Code Provider：<https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/kimi-coding.ts>
- Pi xAI Provider：<https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/xai.ts>
- Gemini CLI 认证说明：<https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx>
- Gemini CLI 第三方服务政策：<https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md>
- Google 2026 Gemini CLI 消费者订阅迁移公告：<https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/>
- Alibaba Qwen Code 计划/认证：<https://help.aliyun.com/zh/model-studio/qwen-code>
- Alibaba Token Plan endpoint/key：<https://help.aliyun.com/zh/model-studio/token-plan-team-quickstart>
- Alibaba Coding Plan 用途与 API key：<https://help.aliyun.com/zh/model-studio/coding-plan-faq>
- Anthropic Claude Pro/Max 与 Claude Code：<https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan>
- OpenAI Codex CLI 与 ChatGPT 计划：<https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt>
