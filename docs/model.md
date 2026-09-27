# 更新 pi-ai 模型目录

Microcode 使用 `@earendil-works/pi-ai` 的 `builtinModels()` 注册内置模型和供应商。内置模型的上下文窗口值来自该模型目录中的 `contextWindow` 字段；Microcode 不单独维护一份内置模型上下文窗口表。因此，更新 pi-ai 依赖及锁文件中的版本，才能把上游目录变化带入应用。

模型目录会随 Microcode 一起打包。上游发布新模型或修改模型信息后，已经安装的 Microcode 不会自动获得这些变化；需要更新依赖、重新构建并发布新版。

## 供应商更新模型信息后如何同步

1. 查看 pi-ai 和 pi-agent-core 的最新兼容版本，并检查发布说明或包内容中是否包含相关模型目录变更：

   ```sh
   npm view @earendil-works/pi-ai version
   npm view @earendil-works/pi-agent-core version
   ```

2. 将 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core` 更新到兼容版本。本仓库目前让两个包保持相同版本；除非上游另有说明，否则继续保持一致：

   ```sh
   bun add --exact @earendil-works/pi-ai@<版本号> @earendil-works/pi-agent-core@<版本号>
   ```

   该命令会更新 `package.json` 和 `bun.lock`。应同时提交这两个文件，确保本地、CI 和发布构建使用相同的模型目录与压缩默认值。

3. 检查发生变化的供应商和模型元数据，尤其是 `provider`、`id`、`api`、`contextWindow`、`maxTokens`、支持的输入模态和价格字段。价格字段是上游模型元数据，不代表用户实际使用的是 API 计费，也不代表订阅账户的账单。

4. 重新构建并打包 Microcode，然后发布新版。例如：

   ```sh
   bun run build
   bun run package:cli
   ```

   用户安装该版本后才能获得更新后的模型目录。

## 自定义模型

通过 `~/.microcode/config.json` 或项目目录下的 `.microcode/config.json` 添加的模型，不属于 pi-ai 内置目录。自定义模型定义必须填写 `contextWindow`；Microcode 会将该值放入模型对象，并用于上下文统计和自动压缩。程序不会根据 API 地址或密钥推断自定义模型的上下文窗口。

## 上下文窗口值从哪里来

### 内置模型

`src/models/registry.ts` 使用 `builtinModels()` 创建共享模型集合。选中的内置模型对象携带 pi-ai 模型目录中的 `contextWindow` 值。切换模型时，Agent 和它的 `CompactionManager` 会更新为新模型，因此后续压缩检查使用当前所选模型的上下文窗口。

环境变量（例如 `BASE_URL`）可以覆盖内置模型的 API 地址，但不会覆盖模型目录中的 `contextWindow`。

### 自定义模型

`src/models/custom.ts` 从用户级或项目级配置读取自定义模型。`contextWindow` 是必填数值，会原样复制到模型对象。若供应商更改了自定义模型的窗口，需要在对应配置中自行更新。

## 自动压缩如何触发

仓库中实现了自动压缩。`src/agent/MicrocodeAgent.ts` 将 `transformContext` 回调交给 pi-agent-core。在每次模型请求前，回调会调用 `prepareModelContext()`，再运行 `compactIfNeeded()` 检查和处理上下文。

压缩检查分两步：

1. 先对符合条件的旧工具结果进行轻量压缩：清除较早的工具输出内容，同时保留每类工具最近的三个结果。这一步不调用模型。
2. `CompactionManager.isCompactionNeeded()` 使用当前模型的 `contextWindow` 判断是否需要自动压缩。它把系统提示词和对话消息的本地 token 估算相加，再与 pi-agent-core 提供的默认压缩设置比较。

当前锁定的 `@earendil-works/pi-agent-core` 版本中，默认设置为：

- 自动压缩已启用；
- `reserveTokens` 为 16,384；
- 当估算用量**大于** `contextWindow - reserveTokens` 时触发压缩。

Microcode 的消息估算大致按每四个字符一个 token 计算，并对图片使用固定估值。因此这只是本地保护性估算，并非供应商返回的精确 token 数。界面展示的上下文用量也基于估算。

触发后，Microcode 使用当前模型概括较早的对话，并保留一段最近的对话内容。用户也可以通过 `/compact` 手动压缩。如果自动概括失败，`compactIfNeeded()` 会保留轻量压缩后的消息并继续发起请求；实际上下文仍可能超过供应商限制，导致请求被拒绝。

## 排查时检查哪些代码

- `src/models/registry.ts`：内置 pi-ai 模型目录及模型选择。
- `src/models/custom.ts`：自定义模型配置和 `contextWindow` 转换。
- `src/agent/MicrocodeAgent.ts`：模型请求前的上下文转换和自动压缩入口。
- `src/session/CompactionManager.ts`：压缩阈值判断、轻量压缩和摘要压缩流程。
- 锁文件解析出的 `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` 版本：确认实际使用的上游模型目录和默认压缩设置。

排查模型目录过期或压缩阈值变化时，先核实锁定的包版本及对应包源码，再判断是否需要修改 Microcode 逻辑。
