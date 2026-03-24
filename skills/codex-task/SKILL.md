---
name: codex-task
description: >
  Delegate a task to Codex (OpenAI) with automatically assembled code context.
  Use when the user says "use codex", "ask codex", "codex review", "codex explore",
  "codex analyze", "let codex do", or wants to delegate analysis/generation/review
  tasks to an external OpenAI model.
---

# Codex Task Delegation Protocol

When this skill is invoked, follow the protocol below to collect context and delegate the task to Codex via `codex_chat`.

## Step 1: Determine Task Scope

Analyze the user's request (`$ARGUMENTS`) to classify the scope:

- **Single-file**: user specifies a file path (e.g., "review src/index.ts")
- **Multi-file**: user specifies a directory or feature area (e.g., "analyze src/mcp-servers/")
- **Project-wide**: user says "explore", "analyze the project", "overview", etc.

Also classify the task type:
- **review**: code review, bug finding, security audit → use review system prompt
- **explore**: project overview, architecture analysis → use architect system prompt
- **general**: anything else (generate, suggest, explain, refactor) → use general system prompt

## Step 2: Collect Context

### For single-file tasks:
1. Read the target file in full
2. Read CLAUDE.md (project conventions — keep only Overview, Architecture, Conventions sections if over 100 lines)
3. Scan the target file's imports/requires — read up to 3 local dependency files
4. Look for a corresponding test file (e.g., `foo.test.ts` for `foo.ts`) and read it if found

### For multi-file tasks:
1. Read CLAUDE.md
2. List the target directory structure (2 levels deep, exclude node_modules/dist/.git)
3. Read package.json and tsconfig.json
4. Read up to 5 most relevant files (entry points, index files, type definitions)

### For project-wide tasks:
1. Read CLAUDE.md
2. Read package.json, tsconfig.json
3. List project root directory tree (2 levels deep, exclude node_modules/dist/.git/.idea/.claude)
4. Read up to 3 key source files (main entry points)

### Truncation rules:
- If a file exceeds 300 lines AND is not the primary review target: keep first 50 lines + last 20 lines, insert `[... N lines truncated ...]` in between
- If CLAUDE.md exceeds 100 lines: keep only Overview, Architecture, and Conventions sections
- If directory tree exceeds 50 lines: reduce recursion depth

## Step 3: Assemble Prompt

Build the `prompt` parameter using this structure:

```
## Task
{user's request, rephrased as a clear instruction to the external model}

## Project Context
{relevant content from CLAUDE.md}

## Project Structure
{directory tree listing, if collected}

## File: {relative/path}
```{ext}
{file content}
```

## File: {relative/path2}
```{ext}
{file content}
```

(repeat for each collected file)

## Instructions
- Reference specific line numbers and function/variable names
- If suggesting code changes, provide the exact code
- Focus on: {task-specific focus areas derived from user's request}
```

## Step 4: Select System Prompt

Set the `system_prompt` parameter based on task type:

**For review tasks:**
```
You are a senior code reviewer. Review the provided code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and maintainability
Rate each finding as Critical / Important / Minor. Reference specific line numbers.
```

**For explore tasks:**
```
You are a software architect analyzing a codebase. Provide a clear, structured overview covering: purpose, architecture, key components, tech stack, and notable patterns. Be concise but thorough.
```

**For general tasks:**
```
You are a senior software engineer. Analyze the provided code context and complete the requested task. Be specific — reference line numbers and symbol names. If suggesting code changes, show the exact code.
```

## Step 5: Call codex_chat

Call the `codex_chat` MCP tool with:
- `prompt`: the assembled prompt from Step 3
- `system_prompt`: selected in Step 4
- `model`: leave as default (configured via CODEX_DEFAULT_MODEL env var) unless user specifies otherwise
- Do NOT set `max_tokens` unless the user explicitly requests a short response

## Step 6: Present Results

After receiving Codex's response:
1. Present it with clear attribution: **"Codex 的分析结果："**
2. If Codex suggests code changes, ask the user: "需要我来应用这些修改吗？"
3. **Never auto-apply** Codex's suggestions — all code edits must be confirmed by the user and executed by Claude
4. If the response is very long, summarize key findings first, then show details
