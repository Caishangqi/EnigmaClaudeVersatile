<p align="center"><img src="https://github.com/user-attachments/assets/12663581-fb81-4364-96d6-36e57d6cfd4f" alt="Logo" width="300"></p>

<h1 align="center"> Claude Versatile </h1>
<h4 align="center">通过 MCP 协议将外部 AI 模型编排为 Claude Code 的可调度工具</h4>
<p align="center">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178c6">
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-ES2022-339933">
<img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-f5a623">
<img alt="License" src="https://img.shields.io/badge/License-MIT-green">
</p>

<p align="center"><a href="README.md">English</a></p>

## 概述

Claude Versatile 让 Claude Code 作为主控编排器，通过 MCP（Model Context Protocol）将子任务委派给外部 AI 模型（OpenAI、Grok、Gemini）。Claude 保持完整的控制权和上下文理解，按需将工作分配给最适合的模型。

系统分为两层：

- **Layer 1：轻量 API 调用**：单次任务（代码审查、搜索、生成），通过 MCP Server 封装 API 调用
- **Layer 2：Agent 委派**：自主只读 Agent，在独立子进程中运行 ReAct 推理循环，适用于复杂的多步骤代码分析

## MCP 服务器

### claude-versatile-codex

通过 `codex_chat` 调用 OpenAI 兼容 API，支持任何 OpenAI 兼容端点背后的模型。

- 工具：`codex_chat(prompt, system_prompt?, model?, temperature?, max_tokens?)`
- 默认模型：`gpt-5.4`（可配置）

### claude-versatile-grok

利用 Grok 模型内置的 web search 能力，通过 xAI API 进行网络搜索。

- 工具：`grok_search(query, system_prompt?, model?)`
- 默认模型：`grok-4`（可配置）

### claude-versatile-agent

自主只读代码分析 Agent。在子进程中运行 LLM 驱动的 ReAct 循环，读取文件、搜索模式、推理分析，返回结构化结果。

- 工具：`agent_execute(goal, context?, model?, maxIterations?, maxTimeMs?, wait?)`
- 默认阻塞等待完成（`wait=true`），返回格式化纯文本结果
- 辅助工具：`agent_wait`、`agent_status`、`agent_result`、`agent_cancel`
- 严格只读：所有修改以文本建议返回，由 Claude 审查后执行

## Skills

MCP 工具之上的可选行为编排层。非必需（工具本身已足够自解释），但提供增强的上下文收集和结果呈现。

- **codex-task**：自动收集代码上下文，组装结构化 prompt，委派给 `codex_chat`
- **grok-search**：分析搜索意图，优化查询，选择 system prompt，委派给 `grok_search`

## 快速开始

### 方式 A：通过 npm 安装（推荐）

```bash
npm install -g claude-versatile
```

在你的项目目录中：

```bash
claude-versatile init
```

在 `.mcp.json` 中注册 MCP 服务器：

```json
{
  "mcpServers": {
    "codex": {
      "type": "stdio",
      "command": "claude-versatile-codex",
      "args": [],
      "env": {}
    },
    "grok": {
      "type": "stdio",
      "command": "claude-versatile-grok",
      "args": [],
      "env": {}
    },
    "agent": {
      "type": "stdio",
      "command": "claude-versatile-agent",
      "args": [],
      "env": {}
    }
  }
}
```

### 方式 B：从源码安装

```bash
git clone https://github.com/Caishangqi/EnigmaClaudeVersatile.git
cd EnigmaClaudeVersatile
npm install
npm run build
```

使用本地路径在 `.mcp.json` 中注册 MCP 服务器：

```json
{
  "mcpServers": {
    "codex": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-repo>/dist/mcp-servers/codex/index.js"],
      "env": {}
    },
    "grok": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-repo>/dist/mcp-servers/grok/index.js"],
      "env": {}
    },
    "agent": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-repo>/dist/mcp-servers/agent/index.js"],
      "env": {}
    }
  }
}
```

### 配置 API Key

编辑 `.versatile/` 中的配置文件：

```bash
# OpenAI / Codex
.versatile/codex.agent.json    # apiKey, baseUrl, defaultModel, timeout

# Grok / xAI
.versatile/grok.agent.json     # apiKey, baseUrl, defaultModel, timeout

# Agent 行为
.versatile/agent.json           # defaultModel, maxIterations, maxTimeMs, singleCallTimeout
```

### 初始化 Skills 和配置（可选）

```bash
npx claude-versatile init
```

这会创建：
- `.claude/skills/`：Skill 定义文件
- `.versatile/`：配置模板（已 gitignore）

### 重启 Claude Code

重新加载以激活新的 MCP 服务器。你应该能在可用工具中看到 `codex_chat`、`grok_search` 和 `agent_execute`。

## 配置系统

所有配置存放在 `.versatile/` 目录（已 gitignore），每个厂商一个 JSON 文件：

```
.versatile/
  codex.agent.json    # OpenAI: apiKey, baseUrl, defaultModel, timeout
  grok.agent.json     # Grok:   apiKey, baseUrl, defaultModel, timeout
  agent.json          # Agent:  defaultModel, maxIterations, maxTimeMs, singleCallTimeout
```

优先级链：`.versatile/*.json` > `process.env` > 硬编码默认值。

缺失的文件在首次运行时自动从模板生成。占位符 API Key（`YOUR_API_KEY_HERE`）会被检测并忽略，同时输出警告。

## 项目结构

```
ClaudeVersatile/
  .claude/skills/           Skill 定义（codex-task, grok-search）
  .versatile/               配置文件（gitignored）
  skills/                   npm 分发用 Skill 文件
  src/
    lib/                    共享库（client, completion, errors, config, bootstrap）
    agent/                  Agent 核心（worker, planner, tools, context-manager, task-store）
    mcp-servers/
      codex/index.ts        Codex MCP Server
      grok/index.ts         Grok MCP Server
      agent/index.ts        Agent MCP Server
    cli/
      init.ts               CLI init 命令
  dist/                     编译输出（gitignored）
```

## 技术栈

- TypeScript (Node.js, ES2022)
- `@modelcontextprotocol/sdk`：MCP 协议实现
- `openai`：OpenAI 兼容 API 客户端（同时用于 Grok/xAI）
- `zod`：运行时 schema 校验

## 开发

```bash
npm run build       # 编译 TypeScript
npm test            # 运行测试 (vitest)
```

## 架构设计

Claude Versatile 遵循"Claude 保持主控"原则：

- 外部模型严格只读：不可修改文件、执行命令或操作 git
- 所有代码编辑由 Claude 审查外部模型建议后执行
- 确保 Claude Code 的 rewind 机制能完整回滚所有变更
- MCP Server 自读 `.versatile/` 配置，无需环境变量注入
- Agent 在子进程中运行：崩溃不影响 MCP Server
- 工具调用使用 OpenAI function calling（`tool_calls`），而非手写 XML/JSON

<h1></h1>

<p align="center">
<a href="https://github.com/Caishangqi/EnigmaEngine/issues">
<img src="https://i.imgur.com/qPmjSXy.png" width="160" />
</a>
<a href="https://github.com/Caishangqi/EnigmaEngine">
<img src="https://i.imgur.com/L1bU9mr.png" width="160" />
</a>
<a href="[https://discord.gg/3rPcYrPnAs](https://discord.gg/3rPcYrPnAs)">
<img src="https://i.imgur.com/uf6V9ZX.png" width="160" />
</a>
<a href="https://github.com/Caishangqi">
<img src="https://i.imgur.com/fHQ45KR.png" width="227" />
</a>
</p>

<h1></h1>
<h4 align="center">在 <a href="https://github.com/Caishangqi">GitHub</a> 了解更多关于 Claude Versatile 的信息</h4>
<h4 align="center">需要定制支持？<a href="https://github.com/Caishangqi">点击这里</a></h4>
