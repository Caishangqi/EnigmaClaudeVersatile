# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClaudeTrinityForce 是一个让 Claude Code 作为主控编排器，通过 Skill + MCP 将外部 AI 模型（Codex、Gemini）降级为可调度工具的系统。Claude 保持主控权和上下文理解，按需将子任务委派给外部模型执行。

**MVP 阶段：Claude + Codex（OpenAI API）+ Grok（xAI API，搜索引擎）— 已完成基础链路验证**
**Agent 阶段：Layer 2 只读 Agent — 解决 prompt 过长和超时问题**

## Codex MCP Server (MVP)

已实现的最小可用 MCP Server，通过 `codex_chat` 工具让 Claude Code 调用 OpenAI 兼容 API。

- 入口文件：`packages/codex/src/index.ts`（使用 `defineProvider({type: "openai"})` 声明式注册）
- 编译输出：`dist/mcp-servers/codex/index.js`
- 服务器名：`claude-versatile-codex`
- 传输方式：stdio
- 工具：`codex_chat` — 参数：prompt, system_prompt, model(默认gpt-5.4), temperature, max_tokens
- 配置：从 `.versatile/codex.agent.json` 读取（apiKey, baseUrl, defaultModel, timeout），fallback 到环境变量 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `CODEX_DEFAULT_MODEL`
- OpenAI 客户端延迟初始化，服务器启动不依赖 API key
- 触发关键词：用户说"use codex"、"ask codex"、"codex explore"、"let codex do"等时应调用此工具

## Grok Search MCP Server

用 Grok 模型的内置 web search 能力替代 Claude 原版网页搜索，通过 realseek 代理调用 xAI API。

- 入口文件：`packages/grok/src/index.ts`（使用 `defineProvider({type: "openai"})` 声明式注册）
- 编译输出：`dist/mcp-servers/grok/index.js`
- 服务器名：`claude-versatile-grok`
- 传输方式：stdio
- 工具：`grok_search` — 参数：query, system_prompt(可选), model(默认 grok-4)
- 配置：从 `.versatile/grok.agent.json` 读取（apiKey, baseUrl, defaultModel, timeout），fallback 到环境变量 `GROK_API_KEY` / `GROK_BASE_URL` / `GROK_DEFAULT_MODEL`
- Grok 的 web search 是模型内置能力，模型自动判断何时搜索，无需客户端额外处理
- 默认 system prompt 引导 Grok 作为搜索助手，返回带来源引用的结果
- 复用 `openai` npm 包（xAI API 兼容 OpenAI 协议）

## Agent MCP Server (Layer 2)

自建只读 Agent，通过独立子进程运行 LLM 驱动的 ReAct 循环，解决 Layer 1 的 prompt 过长和单次超时问题。

- 入口文件：`packages/agent/src/index.ts`
- 编译输出：`dist/mcp-servers/agent/index.js`
- 服务器名：`claude-versatile-agent`
- Agent 核心：`packages/agent/src/agent/`（worker、tools、context-manager、planner、task-store）
- 传输方式：stdio
- 配置：从 `.versatile/agent.json` 读取（defaultModel, maxIterations, maxTimeMs, singleCallTimeout, autoMode, maxTokenBudget），通过 `MODEL_ROUTES` 路由表动态加载所有 provider 的 API Key 传给 Worker
- 工具（5个）：
  - `agent_execute(goal, context?, model?, maxIterations?, maxTimeMs?, wait?, autoMode?, maxTokenBudget?)` — 提交任务。`wait=true`（默认）阻塞等待完成并直接返回格式化结果；`wait=false` 立即返回 taskId
  - `agent_wait(taskId, timeoutMs?)` — 阻塞等待异步任务完成
  - `agent_status(taskId)` — 查询进度（status, currentStep, progress, iterationCount）
  - `agent_result(taskId)` — 获取最终结果（result, summary, filesRead, tokensUsed）
  - `agent_cancel(taskId)` — 取消运行中的任务
- 触发关键词："codex agent"、"grok agent"、"use agent"、"agent analyze"、"agent explore"、"let agent do"、"deep analysis"、"autonomous analysis"
- 模型选择：用户说"codex agent"/"openai agent"时传 `model='gpt-5.4'`（OpenAI 模型）；说"grok agent"时传 `model='grok-4'`（Grok 模型）；否则用默认模型
- 使用场景：需要多步推理、读取多文件、自主探索代码库时用 Agent；简单单次提问用 `codex_chat`/`grok_search`
- 支持多模型：通过 `model` 参数选择 Agent 内部推理用的 LLM（gpt-5.4、grok-4 等）
- Agent Worker 以独立子进程运行，崩溃不影响 MCP Server
- Agent 内置只读工具集：`read_file`、`list_dir`、`search_pattern`、`done`、`plan`（autoMode 专用）
- **严格只读**：Agent 不可写文件、不可执行命令、不可操作 git。所有修改建议以文本返回，由 Claude 审查后执行
- 上下文管理：滑动窗口 + 自动摘要，按需加载文件，避免 token 爆炸
- **自适应迭代控制（autoMode）**：默认开启。L1 复杂度预估（plan 工具捕获 estimated_steps，动态设置 effectiveMax = estimated×1.5）+ L2 重复检测（连续相同 tool call 注入 redirect，2 次后强制终止）+ L2 token 预算（maxTokenBudget 默认 100k，超限终止）。autoMode=false 时回退到固定 maxIterations 行为
- **工具调用方式：使用 OpenAI function calling（`tools` 参数 + `tool_calls` 响应），而非让模型手写 XML/JSON 格式。推理模型（gpt-5.4、o1、o3）的 `content` 字段不可靠（经常为 null），但 `tool_calls` 始终正确返回。保留 XML 解析作为非推理模型的 fallback**
- 超时策略：单次 LLM 调用超时（复用 `executeCompletion`）≠ 总任务超时（`maxTimeMs`，默认 5 分钟）
- 任务状态存内存，进程重启后丢失

## Skills

### codex-task — 通用 Codex 委派
- 定义文件：`.claude/skills/codex-task/SKILL.md`
- 触发方式：`/codex-task <描述>` 或自然语言 "use codex"、"ask codex"、"codex review/explore/analyze"
- 行为：自动收集代码上下文（文件内容、项目结构、依赖关系），组装结构化 prompt，调用 codex_chat
- 上下文策略：根据任务范围（单文件/多文件/项目级）自动调整收集深度和 token 预算
- 结果呈现：以"Codex 的分析结果"归属，代码变更建议需用户确认后由 Claude 执行

### grok-search — 通用 Grok 搜索
- 定义文件：`.claude/skills/grok-search/SKILL.md`
- 触发方式：`/grok-search <查询>` 或自然语言 "search"、"look up"、"find out"、"what's the latest"、"use grok"
- 行为：分析搜索意图（factual/news/technical/comparative/exploratory），优化 query，选择对应 system prompt，调用 grok_search
- 结果呈现：以"Grok 搜索结果"归属，保留所有来源 URL 和引用

## Architecture

系统分两层：

### Layer 1: 轻量 API 调用层
直接调用外部模型 API，用于明确的单次任务（如"用 Gemini 百万上下文分析大文件"）。通过 MCP Server 封装 API 调用，Claude Code 通过 MCP 协议按需激活。

### Layer 2: Agent 委派层（Phase 1 — 自建只读 Agent）
通过 MCP 提交任务给独立 Agent Worker 进程。Agent 内部运行 LLM 驱动的 ReAct 循环（思考→行动→观察→判断），自主规划执行，最终返回文本结果。适用于大项目分析（prompt 过长）和复杂任务（单次超时不够）。Agent 严格只读，所有修改由 Claude 执行。

### Layer 2: Agent 委派层（Phase 2 — Codex CLI 沙箱 Agent，未来）
接入 Codex CLI 的原生 Agent 能力，在隔离沙箱中执行代码、运行测试、验证重构方案。写操作限制在沙箱内，Claude 审查沙箱产出后再 apply 到真实项目。当出现"需要 Agent 在沙箱里跑代码验证"的具体场景时启动此阶段。

### 与 Claude Code Background Agent 的关系
Claude Code 内置 Background Agent（`run_in_background: true`），可在后台运行独立子代理，拥有 200K token 上下文窗口和 Claude Code 全套工具。两者解决不同问题，互补而非替代：

- **Background Agent**：Claude 调 Claude，LLM 固定为 Claude，适合需要 Claude 自身能力的后台任务（代码重构、测试生成等）。零代码，内置功能
- **我们的 Agent MCP**：Claude 调外部模型（GPT、Grok、未来 Gemini），核心价值是多模型编排。适合需要特定模型能力的场景（gpt-5.4 推理、Gemini 百万上下文、Grok 实时搜索等）

选择依据：需要外部模型能力 → Agent MCP；需要 Claude 后台执行 → Background Agent

### Key Design Decisions
- **Claude 保持主控**：不替换 Claude 的 tool use 格式，避免 diff 格式和兼容性问题
- **外部模型只读**：Codex/Gemini 等外部模型严禁直接修改文件、执行写操作或运行 shell 命令。所有代码编辑必须由 Claude 执行，外部模型仅返回文本结果（分析、建议、生成的代码片段），由 Claude 审查后决定是否应用。这确保 Claude Code 的 rewind 机制能完整回滚所有变更
- **动态工具发现**：MCP 按需激活，不是所有对话都挂着外部模型的工具描述，避免 token 浪费
- **Skill 封装**：可复用、可版本管理，比 shell 函数更优雅
- **MCP 与 Skill 职责分离**：MCP Server 负责工具能力（API 调用），Skill 负责行为编排（上下文收集、prompt 组装、结果呈现）。MCP Prompts 无法编排 Claude 的多步行为流程，因此 Skill 不可替代。分发时 MCP Server 可独立安装，Skill 文件需用户手动复制到 `.claude/skills/`
- **场景判断**：Skill 内做好判断，简单任务不走外部模型链路，避免延迟叠加
- **代码组织**：MCP Server 共享库位于 `packages/lib/src/`，包含客户端工厂（`client.ts`）、请求执行与响应提取（`completion.ts`）、统一错误映射（`errors.ts`）、服务器启动引导（`bootstrap.ts`）、核心类型（`types.ts`）和 Provider 生命周期框架（`provider.ts`）。新增 MCP Server 使用 `defineProvider()` 声明式注册，只需实现 `onRegisterTools` 钩子。Layer 2 Agent 委派通过 `CompletionRequest.timeoutMs`（per-call 超时）和 `CompletionRequest.signal`（外部取消）预留扩展点
- **Provider 生命周期框架**：`packages/lib/src/provider.ts` 提供 `defineProvider()` 函数，支持两种类型：`type: "openai"`（OpenAI 兼容，框架自动处理 config loading、env injection、client creation、error mapping）和 `type: "native"`（Native SDK，用户实现 `onCreateClient` 和 `onRegisterTools`）。生命周期：`onLoadConfig → onCreateClient → onRegisterTools → onServerReady`，每个阶段有默认实现，可选择性覆写。OpenAI 类型的 `onRegisterTools(server, ctx)` 提供 `ctx.complete()` 便捷方法，封装完整的 completion + format + error handling 管线
- **Agent 架构**：Agent 核心代码位于 `packages/agent/src/agent/`，与 MCP Server 分离。Agent Worker 以独立子进程运行（隔离性 + 可靠超时），内部通过 ReAct 循环自主规划执行。Planner 依赖 `CompletionProvider` 接口而非特定 SDK，未来非 OpenAI 适配器可直接插入。多模型支持通过数据驱动的路由表（`MODEL_ROUTES`）实现，添加新模型只需在路由表加一行。上下文管理采用滑动窗口 + 自动摘要策略。Phase 1 严格只读，Phase 2 预留沙箱写入能力
- **自适应迭代控制（autoMode）**：默认开启，通过三层机制自动管理 Agent 迭代次数。L1 复杂度预估：Agent 首轮调用 `plan` 工具输出 `estimated_steps`，Planner 据此设置 `effectiveMaxIterations = min(ceil(estimated * 1.5), hardCap)`，未调用 plan 时 fallback 到 hardCap。L2 重复检测：`ContextManager` 维护滑动窗口（大小 5）追踪最近工具调用，连续 2 次相同 tool+args 触发 redirect 消息，2 次 redirect 后强制终止。L2 token 预算：`maxTokenBudget`（默认 100k）限制累计 token 消耗，超限终止。三层终止条件同时生效（迭代/token/重复/时间/abort/done），任一触发即停。`autoMode=false` 时回退到固定 `maxIterations` 行为，plan 工具不对 LLM 可见
- **数据驱动的模型路由**：`lib/config.ts` 中的 `MODEL_ROUTES` 路由表将模型名前缀解析为 API 凭证（config 文件 + 环境变量名）。Agent 的 `collectEnv()` 遍历路由表动态加载所有 provider 配置，Worker 的 `createProviderFromEnv()` 使用 `resolveModelRoute()` 创建对应的 `CompletionProvider`。添加新模型 provider 只需在路由表加一条记录，无需修改 Agent 代码
- **多模型工具调用适配**：当前通过 OpenAI function calling 统一工具调用，`CompletionResult.toolCalls` 是归一化的抽象层。Planner 和 ContextManager 只依赖此接口，不关心底层 API 格式差异。各厂商 function calling 格式不同（OpenAI: `tools` + `tool_calls`，Gemini: `functionDeclarations` + `functionCall`，Claude: `tools` + `tool_use`），未来接入非 OpenAI 兼容 API 时，在 `lib/adapters/` 中实现适配器，将厂商响应转换为 `CompletionResult` 即可，Planner 层无需修改
- **统一配置系统**：`.versatile/` 目录存放所有配置（API Key、模型默认值、超时等），gitignored。每个厂商/模块一个 JSON 文件（`codex.agent.json`、`grok.agent.json`、`agent.json`）。MCP Server 启动时通过 `lib/config.ts` 的 `loadConfig()` 自读配置，`.mcp.json` 的 `env` 字段清空。向后兼容：config 文件不存在时 fallback 到 `process.env`
- **服务器命名**：统一为 `claude-versatile-*` 前缀（`claude-versatile-codex`、`claude-versatile-grok`、`claude-versatile-agent`）
- **分发策略**：MCP Server 通过 npm 安装，全局可用。Skill 为可选增强 — 工具描述本身足够自解释，不装 Skill 也能正常使用。提供 `npx claude-versatile init` CLI 命令一键初始化：复制 Skills 到项目 `.claude/skills/` + 生成 `.versatile/` 配置模板。用户主动触发，不侵入项目

### Critical Challenges to Address
1. **上下文传递**：委派任务时需高效传递代码上下文、文件树、对话摘要；传太少结果无意义，传太多 token 爆炸
2. **格式转换**：OpenAI API 的上下文格式与 Claude 不同，需要适配层
3. **延迟控制**：Claude 推理 → MCP → 外部模型 → 返回 → Claude 综合，链路需优化
4. **响应格式差异**：不同模型的工具调用机制不同。推理模型（gpt-5.4 等）的 `content` 字段不可靠，已通过 OpenAI function calling 解决（`tool_calls` 始终正确返回）。`CompletionResult` 作为归一化抽象层，包含 `content`、`toolCalls`、`usage` 三个标准字段。未来接入 Gemini 等非 OpenAI 兼容 API 时，在 `lib/adapters/` 中实现适配器，将厂商特定响应转换为 `CompletionResult` 格式，上层（Planner、MCP Server）无需修改

## Project Structure

```
ClaudeVersatile/
├── packages/
│   ├── lib/                      # 共享库 (@claude-versatile/lib)
│   │   └── src/                  # types, config, client, completion, errors, bootstrap, provider
│   ├── codex/                    # Codex MCP Server (claude-versatile-codex)
│   │   └── src/index.ts
│   ├── grok/                     # Grok MCP Server (claude-versatile-grok)
│   │   └── src/index.ts
│   ├── agent/                    # Agent MCP Server (claude-versatile-agent)
│   │   └── src/
│   │       ├── index.ts          # MCP Server 入口
│   │       └── agent/            # Agent 核心 (worker, planner, tools, context-manager, task-store)
│   └── cli/                      # CLI init 命令 (claude-versatile)
│       ├── src/init.ts
│       └── skills/               # npm 分发用 Skill 文件
├── .claude/skills/               # 本项目自用 Skill 定义
├── .versatile/                   # 配置目录 (gitignored，含 API Key)
├── skills/                       # 源码安装用 Skill 文件
├── tests/                        # 单元测试
├── tsconfig.base.json            # 共享编译选项
└── tsconfig.json                 # Project references
```

> **注意**：项目使用 npm workspaces monorepo 结构，每个 MCP Server 是独立 npm 包。

## Tech Stack

- **MCP Server**: TypeScript (Node.js), 使用 `@modelcontextprotocol/sdk`
- **Skills**: YAML/Markdown 定义 + 可选的 shell/TypeScript 脚本
- **External APIs**: OpenAI API (Codex MVP), xAI/Grok API (搜索引擎), Google Gemini API (Phase 2)

## Development Commands

```bash
# 安装依赖
npm install

# 构建 MCP Server
npm run build

# 运行测试
npm test

# 运行单个测试文件
npx vitest run <test-file>

# 本地调试 MCP Server
npx @modelcontextprotocol/inspector node dist/mcp-servers/codex/index.js
```

## Configuration System

所有 MCP Server 的配置统一存放在 `.versatile/` 目录（已 gitignore），每个厂商/模块一个 JSON 文件：

```
.versatile/
├── codex.agent.json    # Codex/OpenAI: apiKey, baseUrl, defaultModel, timeout
├── grok.agent.json     # Grok/xAI:     apiKey, baseUrl, defaultModel, timeout
└── agent.json          # Agent 行为:   defaultModel, maxIterations, maxTimeMs, singleCallTimeout, autoMode, maxTokenBudget
```

### 配置加载器 (`src/lib/config.ts`)

- `loadConfig<T>(filename)` — 从 `.versatile/` 读取 JSON，返回 `Partial<T>`
- `configValue(configVal, envName, defaultVal)` — 优先级：config 文件 > `process.env` > 默认值
- `configRequired(configVal, envName, label)` — 必填项，缺失则抛错

### 优先级链

```
.versatile/*.json  →  process.env  →  硬编码默认值
```

### 自动生成

- 首次运行时自动创建 `.versatile/` 目录和所有模板文件
- 单个配置文件被删除时自动从模板重新生成
- 模板中的 API Key 为 `YOUR_API_KEY_HERE` 占位符，检测到时会警告并忽略

### `.mcp.json` 的 `env` 字段

已清空为 `{}`。Server 启动时自读 `.versatile/` 配置，不再依赖 `.mcp.json` 传入环境变量。

## Conventions

- 所有代码和注释使用英文，文档和用户交互使用中文
- MCP Server 遵循 MCP 协议规范，工具描述清晰准确
- Skill 定义需包含明确的触发条件和场景判断逻辑
- 上下文传递使用统一的压缩/摘要策略，控制 token 用量
- 错误处理需区分：API 限流、模型超时、格式不兼容等场景
- 新增功能或架构变更时，必须同步更新 `README.md`、`README_ZH.md` 和 [GitHub Wiki](https://github.com/Caishangqi/EnigmaClaudeVersatile/wiki) 三处文档
- Wiki 页面位于本地 `wiki/` 目录（gitignored），修改后需手动推送到 wiki 仓库（`EnigmaClaudeVersatile.wiki.git`）
- Wiki 包含四个核心页面：Architecture、Getting Started、Configuration、Provider Development Guide
- 新特性和重大改动完成后必须运行 `npm test`，确保所有测试通过
- 新增核心模块时应编写对应的单元测试（`tests/*.test.ts`）
- 项目使用 npm workspaces monorepo，每个 MCP Server 是独立 npm 包（`packages/*`）
- 所有包版本号保持同步，使用 `npm version --workspaces` 统一升版

### 版本管理规范

采用 semver + prerelease 标签，CI 根据 git tag 自动选择 npm dist-tag：

| 阶段 | 版本格式 | git tag | npm dist-tag | 说明 |
|------|----------|---------|-------------|------|
| 开发 | `X.Y.Z-alpha.N` | `vX.Y.Z-alpha.N` | `alpha` | 新功能试验，可能不稳定 |
| 测试 | `X.Y.Z-beta.N` | `vX.Y.Z-beta.N` | `beta` | 功能冻结，修 bug |
| 候选 | `X.Y.Z-rc.N` | `vX.Y.Z-rc.N` | `next` | 候选发布，最终验证 |
| 正式 | `X.Y.Z` | `vX.Y.Z` | `latest` | 稳定版，用户默认安装 |

发版流程：
```bash
# 1. 升版（所有包同步）
npm version X.Y.Z-alpha.0 --workspaces --no-git-tag-version
npm version X.Y.Z-alpha.0 --no-git-tag-version
# 2. 提交 + 打 tag + 推送
git add -A && git commit -m "vX.Y.Z-alpha.0"
git tag vX.Y.Z-alpha.0 && git push && git push --tags
```

## Pre-release Checklist

### 必须完成
- [x] **README.md** — 安装指南、配置说明、使用示例、架构概览（EN + ZH 双版本）
- [x] **LICENSE** — MIT 协议
- [x] **测试覆盖** — 核心路径单元测试：config loader、completion、error mapping（28 tests）

### 功能完善
- [x] **Agent 容错** — 使用 OpenAI SDK 内置重试机制（`maxRetries: 3`，指数退避 0.5s*2^n，上限 8s，25% jitter，支持 Retry-After header）。覆盖 408/429/500+ 瞬态错误，所有 client（Codex、Grok、Agent Worker）统一生效
- [ ] **Grok 通道恢复** — realseek 的 grok-4 持续 502/401，需要备用方案或等通道恢复
- [ ] **多代理商支持** — 支持直连官方 API（OpenAI、xAI），不绑死单一代理商。配置中 `baseUrl` 已预留，需验证官方端点兼容性

### 锦上添花
- [ ] **Gemini 适配器** — Phase 2，`lib/adapters/` 实现 Gemini function calling → CompletionResult 转换
- [x] **GitHub Actions CI/CD** — push/PR 自动 build + test，push `v*` tag 自动 npm publish，支持 alpha/beta/rc/latest dist-tag
- [ ] **MCP Inspector 集成测试** — 端到端验证 MCP 协议交互
- [ ] **`npx claude-versatile doctor`** — 诊断命令：检查配置完整性、API 连通性、模型可用性

## Reference

`reference/` 目录存放供学习和借鉴的外部项目源码（gitignored，不纳入版本管理）。

| 项目 | 路径 | 说明 | 借鉴点 |
|------|------|------|--------|
| [OpenDev](https://github.com/opendev-to/opendev) | `reference/opendev/` | Rust 实现的终端 AI 编码 Agent，支持多模型 per-workflow 绑定 | Adaptive Context Compaction（5 级压缩策略）、per-workflow 模型路由、event-driven system reminders 对抗指令遗忘、复杂度预估与动态迭代预算 |
