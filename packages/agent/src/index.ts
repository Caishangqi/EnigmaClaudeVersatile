#!/usr/bin/env node

import {z} from "zod";
import {fork} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {createServer, startServer, runServer} from "@claude-versatile/lib/bootstrap.js";
import {formatTokens, formatDuration} from "@claude-versatile/lib/completion.js";
import {TaskStore} from "./agent/task-store.js";
import {loadConfig, configValue, type BaseProviderConfig, type AgentBehaviorConfig, MODEL_ROUTES} from "@claude-versatile/lib/config.js";
import type {ParentToWorkerMessage, WorkerToParentMessage, AgentResult, TaskState} from "./agent/types.js";

const store = new TaskStore();

// Worker script path: dist/agent/worker.js
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.resolve(__dirname, "./agent/worker.js");

// Load configs
const agentCfg = loadConfig<AgentBehaviorConfig>("agent.json");

const DEFAULT_MODEL = configValue(agentCfg.defaultModel, "AGENT_DEFAULT_MODEL", "gpt-4o");
const DEFAULT_MAX_ITERATIONS = configValue(agentCfg.maxIterations, "AGENT_MAX_ITERATIONS", 20);
const DEFAULT_MAX_TIME_MS = configValue(agentCfg.maxTimeMs, "AGENT_MAX_TIME_MS", 300_000);
const SINGLE_CALL_TIMEOUT = configValue(agentCfg.singleCallTimeout, "AGENT_SINGLE_CALL_TIMEOUT", 120_000);
const DEFAULT_AUTO_MODE = configValue(agentCfg.autoMode, "AGENT_AUTO_MODE", true);
const DEFAULT_MAX_TOKEN_BUDGET = configValue(agentCfg.maxTokenBudget, "AGENT_MAX_TOKEN_BUDGET", 100_000);

/** Collect API keys from all provider config files + env to pass to Worker. */
function collectEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    // Deduplicate config files (multiple routes may share the same file)
    const seen = new Set<string>();
    for (const route of MODEL_ROUTES) {
        if (seen.has(route.configFile)) continue;
        seen.add(route.configFile);
        const cfg = loadConfig<BaseProviderConfig>(route.configFile);
        const key = cfg.apiKey || process.env[route.apiKeyEnv];
        const url = cfg.baseUrl || process.env[route.baseUrlEnv];
        if (key) env[route.apiKeyEnv] = key;
        if (url) env[route.baseUrlEnv] = url;
    }
    return env;
}

// ============================================================
// Output Formatting
// ============================================================

function formatStatus(task: TaskState): string {
    const elapsed = formatDuration(Date.now() - task.startedAt);
    const lines = [
        `Status: ${task.status.toUpperCase()}`,
        `Elapsed: ${elapsed} | Iterations: ${task.iterationCount} | Files read: ${task.filesRead.length} | Tokens: ${formatTokens(task.tokensUsed)}`,
    ];
    if (task.currentStep && task.currentStep !== "Initializing...") {
        lines.push(`Current: ${task.currentStep}`);
    }
    if (task.filesRead.length > 0) {
        lines.push(`Files: ${task.filesRead.join(", ")}`);
    }
    if (task.error) {
        lines.push(`Error: ${task.error}`);
    }
    return lines.join("\n");
}

function formatResult(result: AgentResult): string {
    const lines = [
        `Agent completed in ${formatDuration(result.elapsedMs)} (${result.iterationCount} iterations, ${formatTokens(result.tokensUsed)} tokens)`,
    ];
    if (result.effectiveMaxIterations) {
        lines.push(`Effective iteration limit: ${result.effectiveMaxIterations} (auto-estimated)`);
    }
    if (result.terminationReason) {
        lines.push(`Termination: ${result.terminationReason}`);
    }
    lines.push("", "--- Summary ---", result.summary);
    if (result.filesRead.length > 0) {
        lines.push("", `Files read (${result.filesRead.length}): ${result.filesRead.join(", ")}`);
    }
    if (result.answer && result.answer !== result.summary) {
        lines.push("", "--- Answer ---", result.answer);
    }
    return lines.join("\n");
}

const text = (s: string) => ({content: [{type: "text" as const, text: s}]});
const textErr = (s: string) => ({content: [{type: "text" as const, text: s}], isError: true});

// ============================================================
// Task Lifecycle Helpers
// ============================================================

/** Launch a worker process for a task. Returns the task. */
function launchTask(goal: string, context: string | undefined, workingDir: string, model: string, maxIterations: number, maxTimeMs: number, autoMode: boolean, maxTokenBudget: number): TaskState {
    // When autoMode, ensure hardCap is at least 50
    const effectiveMaxIterations = autoMode ? Math.max(maxIterations, 50) : maxIterations;
    const enabledTools: import("./agent/types.js").AgentToolName[] = autoMode
        ? ["plan", "read_file", "list_dir", "search_pattern", "done"]
        : ["read_file", "list_dir", "search_pattern", "done"];

    const config = {
        goal, context,
        workingDir: workingDir || process.cwd(),
        model,
        maxIterations: effectiveMaxIterations,
        maxTimeMs,
        enabledTools,
        singleCallTimeout: SINGLE_CALL_TIMEOUT,
        autoMode,
        maxTokenBudget,
        env: collectEnv(),
    };

    const task = store.createTask(config);

    const child = fork(WORKER_PATH, [], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    task.workerProcess = child;

    child.on("message", (msg: WorkerToParentMessage) => {
        switch (msg.type) {
            case "status":
                store.updateProgress(task.taskId, msg.currentStep, msg.iterationCount, msg.filesRead, msg.tokensUsed);
                break;
            case "complete":
                store.completeTask(task.taskId, msg.result);
                break;
            case "error":
                store.failTask(task.taskId, msg.error);
                break;
        }
    });

    child.on("exit", (code) => {
        const t = store.getTask(task.taskId);
        if (t && t.status === "running") {
            store.failTask(task.taskId, `Worker exited unexpectedly (code: ${code})`);
        }
    });

    child.send({type: "start", taskId: task.taskId, config: task.config} satisfies ParentToWorkerMessage);
    return task;
}

/** Wait for a task to finish. Returns the final task state. */
function waitForTask(taskId: string, timeoutMs: number): Promise<TaskState> {
    return new Promise((resolve) => {
        const check = () => {
            const task = store.getTask(taskId);
            if (!task || task.status !== "running") {
                resolve(task!);
                return;
            }
            setTimeout(check, 500);
        };
        // Safety timeout: resolve with current state if exceeded
        setTimeout(() => {
            const task = store.getTask(taskId);
            if (task) resolve(task);
        }, timeoutMs + 5000);
        check();
    });
}

/** Format the final response for a completed/failed/cancelled task. */
function formatFinalResponse(task: TaskState) {
    if (task.status === "failed") {
        return textErr(`Agent failed: ${task.error}\n${formatStatus(task)}`);
    }
    if (task.status === "cancelled") {
        return text(`Agent cancelled.\n${formatStatus(task)}`);
    }
    if (task.result) {
        return text(formatResult(task.result));
    }
    return textErr("Agent completed but no result available.");
}

// ============================================================
// MCP Server
// ============================================================

const server = createServer({name: "claude-versatile-agent", version: "0.1.0"});

// ============================================================
// agent_execute — Submit (and optionally wait for) a task
// ============================================================

server.tool(
    "agent_execute",
    "Start an autonomous read-only agent that analyzes code by incrementally reading files and searching patterns. " +
    "The agent runs as an independent process with its own LLM reasoning loop (ReAct). " +
    "By default (wait=true), blocks until the agent finishes and returns the result directly. " +
    "Set wait=false to get a taskId immediately for async polling with agent_status/agent_result. " +
    "The agent CANNOT modify files — it only reads and analyzes.\n\n" +
    "TRIGGER KEYWORDS: 'codex agent', 'grok agent', 'use agent', 'agent analyze', 'agent explore', " +
    "'let agent do', 'deep analysis', 'autonomous analysis'.\n" +
    "MODEL SELECTION: When user says 'codex agent' or 'openai agent', pass model='gpt-5.4' (or the configured OpenAI model). " +
    "When user says 'grok agent', pass model='grok-4' (or the configured Grok model). " +
    "Otherwise use the default model.\n" +
    "WHEN TO USE: Prefer this over codex_chat/grok_search when the task requires multi-step reasoning, " +
    "reading multiple files, or exploring a codebase autonomously. " +
    "Use codex_chat for simple single-prompt tasks; use agent_execute for complex analysis that needs iteration.",
    {
        goal: z.string().min(1).max(10_000).describe("The task goal for the agent"),
        context: z.string().max(50_000).optional().describe("Additional context from Claude"),
        workingDir: z.string().optional().describe("Working directory path (default: project root)"),
        model: z.string().max(100).default(DEFAULT_MODEL).describe(`LLM model for agent reasoning (default: ${DEFAULT_MODEL})`),
        maxIterations: z.number().int().min(1).max(100).default(DEFAULT_MAX_ITERATIONS).describe("Max reasoning iterations. When autoMode=true, serves as hard safety cap (system sets effective limit dynamically)."),
        maxTimeMs: z.number().int().min(10_000).max(1_800_000).default(DEFAULT_MAX_TIME_MS).describe("Total time limit in ms"),
        wait: z.boolean().default(true).describe("If true (default), block until agent completes and return result. If false, return taskId immediately for async polling."),
        autoMode: z.boolean().default(DEFAULT_AUTO_MODE).describe("When true, system auto-controls iteration count via complexity estimation and repetition detection. maxIterations becomes a hard safety cap."),
        maxTokenBudget: z.number().int().min(0).max(500_000).default(DEFAULT_MAX_TOKEN_BUDGET).describe("Maximum cumulative token budget. 0 = unlimited. Only enforced when autoMode=true."),
    },
    async ({goal, context, workingDir, model, maxIterations, maxTimeMs, wait, autoMode, maxTokenBudget}) => {
        const task = launchTask(goal, context, workingDir ?? "", model, maxIterations, maxTimeMs, autoMode, maxTokenBudget);

        if (!wait) {
            const modeLabel = autoMode ? "auto" : `max ${maxIterations}`;
            return text(`Agent started [${task.taskId}]\nModel: ${model} | Iterations: ${modeLabel} | Timeout: ${formatDuration(maxTimeMs)}\nGoal: ${goal.slice(0, 200)}${goal.length > 200 ? "..." : ""}`);
        }

        // Blocking mode: wait for completion
        const final = await waitForTask(task.taskId, maxTimeMs);
        return formatFinalResponse(final);
    },
);

// ============================================================
// agent_wait — Block until a task completes
// ============================================================

server.tool(
    "agent_wait",
    "Wait for a running agent task to complete and return the result. " +
    "Use this after agent_execute(wait=false) to block until the agent finishes.",
    {
        taskId: z.string().min(1).describe("Task ID returned by agent_execute"),
        timeoutMs: z.number().int().min(5_000).max(1_800_000).default(DEFAULT_MAX_TIME_MS).describe("Max wait time in ms (default: 5min)"),
    },
    async ({taskId, timeoutMs}) => {
        const task = store.getTask(taskId);
        if (!task) {
            return textErr(`Task not found: ${taskId}`);
        }
        if (task.status !== "running") {
            return formatFinalResponse(task);
        }
        const final = await waitForTask(taskId, timeoutMs);
        return formatFinalResponse(final);
    },
);

// ============================================================
// agent_status — Check progress (non-blocking)
// ============================================================

server.tool(
    "agent_status",
    "Check the progress of a running agent task without blocking.",
    {
        taskId: z.string().min(1).describe("Task ID returned by agent_execute"),
    },
    async ({taskId}) => {
        const task = store.getTask(taskId);
        if (!task) {
            return textErr(`Task not found: ${taskId}`);
        }
        return text(formatStatus(task));
    },
);

// ============================================================
// agent_result — Get final output (non-blocking)
// ============================================================

server.tool(
    "agent_result",
    "Get the final result of a completed agent task without blocking.",
    {
        taskId: z.string().min(1).describe("Task ID returned by agent_execute"),
    },
    async ({taskId}) => {
        const task = store.getTask(taskId);
        if (!task) {
            return textErr(`Task not found: ${taskId}`);
        }
        if (task.status === "running") {
            return text(`Task still running.\n${formatStatus(task)}`);
        }
        return formatFinalResponse(task);
    },
);

// ============================================================
// agent_cancel — Cancel a running task
// ============================================================

server.tool(
    "agent_cancel",
    "Cancel a running agent task.",
    {
        taskId: z.string().min(1).describe("Task ID returned by agent_execute"),
    },
    async ({taskId}) => {
        const task = store.getTask(taskId);
        if (!task) {
            return textErr(`Task not found: ${taskId}`);
        }
        if (task.status !== "running") {
            return text(`Task is not running (status: ${task.status})`);
        }

        task.workerProcess?.send({type: "cancel"} satisfies ParentToWorkerMessage);
        const proc = task.workerProcess;
        setTimeout(() => {
            try { proc?.kill("SIGTERM"); } catch { /* already exited */ }
        }, 3000);
        store.cancelTask(taskId);

        return text(`Task cancelled [${taskId}]`);
    },
);

runServer(() => startServer(server, "Agent MCP Server"));
