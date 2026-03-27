import type {ChildProcess} from "node:child_process";

// ============================================================
// IPC Messages (Agent MCP Server <-> Worker)
// ============================================================

/** Parent sends to Worker to start a task. */
export interface WorkerStartMessage {
    type: "start";
    taskId: string;
    config: AgentConfig;
}

/** Parent sends to Worker to cancel. */
export interface WorkerCancelMessage {
    type: "cancel";
}

export type ParentToWorkerMessage = WorkerStartMessage | WorkerCancelMessage;

/** Worker reports progress to Parent. */
export interface WorkerStatusMessage {
    type: "status";
    currentStep: string;
    iterationCount: number;
    filesRead: string[];
    tokensUsed: number;
}

/** Worker reports completion to Parent. */
export interface WorkerCompleteMessage {
    type: "complete";
    result: AgentResult;
}

/** Worker reports failure to Parent. */
export interface WorkerErrorMessage {
    type: "error";
    error: string;
}

export type WorkerToParentMessage =
    | WorkerStatusMessage
    | WorkerCompleteMessage
    | WorkerErrorMessage;

// ============================================================
// Agent Configuration
// ============================================================

export interface AgentConfig {
    goal: string;
    context?: string;
    workingDir: string;
    model: string;
    maxIterations: number;
    maxTimeMs: number;
    /** Per-LLM-call timeout in ms. */
    singleCallTimeout: number;
    enabledTools: AgentToolName[];
    /** When true, system auto-controls iteration count via L1+L2. maxIterations becomes hard cap. */
    autoMode: boolean;
    /** Maximum cumulative token budget. 0 = unlimited. Only enforced when autoMode=true. */
    maxTokenBudget: number;
    /** Whether the model supports OpenAI function calling. When false, uses prompt-based XML format. */
    supportsFunctionCalling: boolean;
    /** Environment variables passed to Worker (API keys, base URLs). */
    env: Record<string, string>;
}

// ============================================================
// Agent Tool System
// ============================================================

/** Built-in tool names with type safety and IDE auto-completion. */
export type BuiltinToolName = "read_file" | "list_dir" | "search_pattern" | "done" | "plan" | "web_search";

/** Tool name: built-in names are type-checked, custom tools use plain string. */
export type AgentToolName = BuiltinToolName | (string & {});

/** Optional metadata for Planner behavior driven by tool properties. */
export interface AgentToolMetadata {
    /** Tool category for documentation/filtering. */
    category?: "core" | "filesystem" | "external" | "custom";
    /** If true, Planner tracks the 'path' arg in filesRead. */
    tracksFileRead?: boolean;
    /** If true, Planner skips repetition detection for this tool. */
    skipRepetitionCheck?: boolean;
    /** Hint text to append to system prompt when this tool is available. */
    systemPromptHint?: string;
}

export interface AgentToolDef {
    name: AgentToolName;
    description: string;
    parameters: Record<string, AgentToolParamDef>;
    execute: (args: Record<string, unknown>, workingDir: string) => Promise<AgentToolResult>;
    /** Optional metadata for Planner special handling. */
    metadata?: AgentToolMetadata;
}

export interface AgentToolParamDef {
    type: "string" | "number" | "boolean";
    description: string;
    required: boolean;
}

export interface AgentToolResult {
    success: boolean;
    output: string;
    /** Character count for rough token estimation. */
    charCount: number;
}

// ============================================================
// Planner Types
// ============================================================

/** A single LLM decision in the ReAct loop. */
export interface PlannerDecision {
    thought: string;
    action: PlannerAction;
}

export type PlannerAction =
    | {type: "tool_call"; tool: AgentToolName; args: Record<string, unknown>}
    | {type: "done"; summary: string; answer: string};

// ============================================================
// Task Lifecycle
// ============================================================

export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface TaskState {
    taskId: string;
    status: TaskStatus;
    config: AgentConfig;
    currentStep: string;
    iterationCount: number;
    filesRead: string[];
    tokensUsed: number;
    startedAt: number;
    completedAt?: number;
    result?: AgentResult;
    error?: string;
    /** Worker child process reference for cancellation. */
    workerProcess?: ChildProcess;
}

export interface AgentResult {
    summary: string;
    answer: string;
    filesRead: string[];
    tokensUsed: number;
    iterationCount: number;
    elapsedMs: number;
    /** If autoMode was active, the effective iteration limit set by L1. */
    effectiveMaxIterations?: number;
    /** Termination reason when forced by L2 controls. */
    terminationReason?: string;
}

// ============================================================
// Context Manager Types
// ============================================================

export interface ContextEntry {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    /** Estimated token count. */
    estimatedTokens: number;
    /** Whether this entry can be summarized/compressed. */
    compressible: boolean;
    /** For tool response messages: the tool_call_id this responds to. */
    toolCallId?: string;
    /** For assistant messages with a tool_call. */
    toolCall?: { id: string; name: string; arguments: string };
}

export interface ContextManagerConfig {
    /** Maximum tokens for the context window. */
    maxContextTokens: number;
    /** Trigger summarization when usage exceeds this ratio (e.g. 0.8). */
    summarizeThreshold: number;
    /** Target usage ratio after summarization (e.g. 0.5). */
    summarizeTarget: number;
}
