<p align="center"><img src="https://github.com/user-attachments/assets/12663581-fb81-4364-96d6-36e57d6cfd4f" alt="Logo" width="300"></p>

<h1 align="center"> Claude Versatile </h1>
<h4 align="center">Claude Code orchestrator with external AI model delegation via MCP</h4>
<p align="center">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178c6">
<img alt="Node.js" src="https://img.shields.io/badge/Node.js-ES2022-339933">
<img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-f5a623">
<img alt="License" src="https://img.shields.io/badge/License-MIT-green">
</p>

<p align="center"><a href="README_ZH.md">中文文档</a></p>

## Overview

Claude Versatile lets Claude Code act as the primary orchestrator, delegating sub-tasks to external AI models (OpenAI, Grok, Gemini) through MCP (Model Context Protocol). Claude retains full control and context awareness while dispatching work to the best-fit model for each task.

The system is split into two layers:

- **Layer 1: Direct API calls**: lightweight, single-shot tasks (code review, search, generation) routed through MCP Server wrappers
- **Layer 2: Agent delegation**: an autonomous read-only Agent with its own ReAct reasoning loop, running in a separate process for complex multi-step analysis

## MCP Servers

### claude-versatile-codex

Calls OpenAI-compatible APIs via `codex_chat`. Supports any model behind an OpenAI-compatible endpoint.

- Tool: `codex_chat(prompt, system_prompt?, model?, temperature?, max_tokens?)`
- Default model: `gpt-5.4` (configurable)

### claude-versatile-grok

Web search powered by Grok's built-in search capability via xAI API.

- Tool: `grok_search(query, system_prompt?, model?)`
- Default model: `grok-4` (configurable)

### claude-versatile-agent

Autonomous read-only code analysis agent. Runs an LLM-driven ReAct loop in a child process, reads files, searches patterns, reasons about code, and returns structured results.

- Tool: `agent_execute(goal, context?, model?, maxIterations?, maxTimeMs?, wait?)`
- Default: blocks until completion (`wait=true`), returns formatted plain-text result
- Additional tools: `agent_wait`, `agent_status`, `agent_result`, `agent_cancel`
- Strictly read-only: all modifications are suggested as text, executed by Claude after review

## Skills

Optional behavior orchestration layers on top of MCP tools. Not required (tools are self-describing), but provide enhanced context assembly and result presentation.

- **codex-task**: auto-collects code context, assembles structured prompts, delegates to `codex_chat`
- **grok-search**: analyzes search intent, optimizes queries, selects system prompts, delegates to `grok_search`

## Quick Start

### Option A: Install via npm (recommended)

```bash
npm install -g claude-versatile
```

Then in your project directory:

```bash
claude-versatile init
```

Register MCP Servers in `.mcp.json`:

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

### Option B: Install from source

```bash
git clone https://github.com/Caishangqi/EnigmaClaudeVersatile.git
cd EnigmaClaudeVersatile
npm install
npm run build
```

Then register MCP Servers using local paths in `.mcp.json`:

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

### Configure API keys

Edit the generated config files in `.versatile/`:

```bash
# OpenAI / Codex
.versatile/codex.agent.json    # apiKey, baseUrl, defaultModel, timeout

# Grok / xAI
.versatile/grok.agent.json     # apiKey, baseUrl, defaultModel, timeout

# Agent behavior
.versatile/agent.json           # defaultModel, maxIterations, maxTimeMs, singleCallTimeout
```

### Initialize Skills and config (optional)

```bash
npx claude-versatile init
```

This creates:
- `.claude/skills/`: Skill definition files
- `.versatile/`: Configuration templates (gitignored)

### Restart Claude Code

Reload to pick up the new MCP servers. You should see `codex_chat`, `grok_search`, and `agent_execute` in the available tools.

## Configuration

All configuration lives in `.versatile/` (gitignored). Each provider gets its own JSON file:

```
.versatile/
  codex.agent.json    # OpenAI: apiKey, baseUrl, defaultModel, timeout
  grok.agent.json     # Grok:   apiKey, baseUrl, defaultModel, timeout
  agent.json          # Agent:  defaultModel, maxIterations, maxTimeMs, singleCallTimeout
```

Priority chain: `.versatile/*.json` > `process.env` > hardcoded defaults.

Missing files are auto-generated from templates on first run. Placeholder API keys (`YOUR_API_KEY_HERE`) are detected and ignored with a warning.

## Project Structure

```
ClaudeVersatile/
  .claude/skills/           Skill definitions (codex-task, grok-search)
  .versatile/               Config files (gitignored)
  skills/                   Skill files for npm distribution
  src/
    lib/                    Shared library (client, completion, errors, config, bootstrap)
    agent/                  Agent core (worker, planner, tools, context-manager, task-store)
    mcp-servers/
      codex/index.ts        Codex MCP Server
      grok/index.ts         Grok MCP Server
      agent/index.ts        Agent MCP Server
    cli/
      init.ts               CLI init command
  dist/                     Compiled output (gitignored)
```

## Tech Stack

- TypeScript (Node.js, ES2022)
- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `openai`: OpenAI-compatible API client (also used for Grok/xAI)
- `zod`: Runtime schema validation

## Development

```bash
npm run build       # Compile TypeScript
npm test            # Run tests (vitest)
```

## Architecture

Claude Versatile follows a "Claude stays in control" principle:

- External models are strictly read-only: they cannot modify files, run commands, or access git
- All code edits are executed by Claude after reviewing external model suggestions
- This ensures Claude Code's rewind mechanism can fully roll back any changes
- MCP servers self-read configuration from `.versatile/`, no env var injection needed
- The Agent runs in a child process: crashes don't affect the MCP server
- Tool invocation uses OpenAI function calling (`tool_calls`), not hand-written XML/JSON

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
<h4 align="center">Find out more about Claude Versatile on <a href="https://github.com/Caishangqi">GitHub</a></h4>
<h4 align="center">Looking for custom support? <a href="https://github.com/Caishangqi">Find it here</a></h4>
