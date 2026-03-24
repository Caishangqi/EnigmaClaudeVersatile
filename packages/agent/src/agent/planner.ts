import type {AgentConfig, AgentResult, AgentToolName, PlannerDecision, PlannerAction} from "./types.js";
import type {CompletionProvider, CompletionRequest} from "@claude-versatile/lib/types.js";
import {ContextManager} from "./context-manager.js";
import {getToolDefs} from "./tools.js";

const MAX_PARSE_FAILURES = 3;
const SUMMARIZE_TIMEOUT = 30_000;

export interface PlannerCallbacks {
    onIteration: (step: string, iteration: number, filesRead: string[], tokensUsed: number) => void;
}

/**
 * ReAct loop planner. Drives the Agent's think-act-observe cycle
 * using function calling for reliable tool invocation.
 * Accepts any CompletionProvider — decoupled from specific LLM SDKs.
 */
export class Planner {
    private provider: CompletionProvider;
    private config: AgentConfig;
    private callbacks: PlannerCallbacks;
    private contextManager: ContextManager;
    private tools: Map<AgentToolName, import("./types.js").AgentToolDef>;
    private openaiTools: Array<{type: "function"; function: {name: string; description: string; parameters: Record<string, unknown>}}>;
    private abortController = new AbortController();
    private filesRead = new Set<string>();
    private totalTokensUsed = 0;
    private iterationCount = 0;

    constructor(provider: CompletionProvider, config: AgentConfig, callbacks: PlannerCallbacks) {
        this.provider = provider;
        this.config = config;
        this.callbacks = callbacks;
        this.contextManager = new ContextManager();
        this.tools = getToolDefs(config.enabledTools);
        this.openaiTools = buildOpenAITools(this.tools);
    }

    /** Run the full ReAct loop until done or limits reached. */
    async run(): Promise<AgentResult> {
        const startTime = Date.now();

        // Initialize context with system prompt and goal
        this.contextManager.addEntry("system", this.buildSystemPrompt(), false);
        const userMsg = this.config.context
            ? `## Goal\n${this.config.goal}\n\n## Context\n${this.config.context}`
            : `## Goal\n${this.config.goal}`;
        this.contextManager.addEntry("user", userMsg, false);

        let consecutiveParseFailures = 0;

        while (this.iterationCount < this.config.maxIterations) {
            // Check time limit
            const elapsed = Date.now() - startTime;
            if (elapsed >= this.config.maxTimeMs) {
                return this.buildForcedResult(startTime, "Time limit reached.");
            }

            // Check abort
            if (this.abortController.signal.aborted) {
                return this.buildForcedResult(startTime, "Task cancelled.");
            }

            // Summarize if context is getting large
            if (this.contextManager.needsSummarization()) {
                await this.summarizeContext();
            }

            // Call LLM with function calling
            const completion = await this.provider.complete({
                model: this.config.model,
                messages: this.contextManager.getMessages(),
                signal: this.abortController.signal,
                timeoutMs: this.config.singleCallTimeout,
                extra: { tools: this.openaiTools },
            });

            this.totalTokensUsed += completion.usage?.totalTokens ?? 0;

            // Parse decision from tool_calls or content
            const decision = parseDecision(completion);
            if (!decision) {
                console.error(`[Agent] Parse failure #${consecutiveParseFailures + 1}. content: ${completion.content.slice(0, 300)}, toolCalls: ${JSON.stringify(completion.toolCalls)?.slice(0, 300)}`);
                consecutiveParseFailures++;
                if (consecutiveParseFailures >= MAX_PARSE_FAILURES) {
                    return this.buildForcedResult(startTime, "Failed to parse LLM response after multiple attempts.");
                }
                this.contextManager.addEntry("assistant", completion.content !== "(empty response)" ? completion.content : "I need to use a tool to proceed.");
                this.contextManager.addEntry("user", "You MUST call a tool. Use read_file to read code, or done to return your answer.");
                this.iterationCount++;
                continue;
            }
            consecutiveParseFailures = 0;

            // Handle done action
            if (decision.action.type === "done") {
                return {
                    summary: decision.action.summary,
                    answer: decision.action.answer,
                    filesRead: [...this.filesRead],
                    tokensUsed: this.totalTokensUsed,
                    iterationCount: this.iterationCount + 1,
                    elapsedMs: Date.now() - startTime,
                };
            }

            // Execute tool
            const {tool, args} = decision.action;
            const toolDef = this.tools.get(tool);
            if (!toolDef) {
                // Add assistant message with tool_call, then tool error response
                this.addToolCallToContext(decision.toolCallId!, tool, JSON.stringify(args));
                this.contextManager.addEntry("tool", `Error: Unknown tool "${tool}". Available: ${[...this.tools.keys()].join(", ")}`, true, decision.toolCallId);
                this.iterationCount++;
                continue;
            }

            const result = await toolDef.execute(args, this.config.workingDir);

            // Track files read
            if (tool === "read_file" && args.path) {
                this.filesRead.add(String(args.path));
            }

            // Add assistant tool_call + tool result to context (OpenAI function calling protocol)
            this.addToolCallToContext(decision.toolCallId!, tool, JSON.stringify(args));
            const toolOutput = result.success ? result.output : `[ERROR] ${result.output}`;
            this.contextManager.addEntry("tool", toolOutput, true, decision.toolCallId);

            this.iterationCount++;
            this.callbacks.onIteration(
                decision.thought?.slice(0, 100) || `Called ${tool}`,
                this.iterationCount,
                [...this.filesRead],
                this.totalTokensUsed,
            );
        }

        // Max iterations reached
        return this.buildForcedResult(startTime, "Maximum iterations reached.");
    }

    /** Cancel the running loop. */
    cancel(): void {
        this.abortController.abort();
    }

    // ============================================================
    // Private helpers
    // ============================================================

    private buildSystemPrompt(): string {
        return "You are a code analysis agent. Read-only. You MUST read files with tools before answering. NEVER answer from memory. Use read_file, list_dir, or search_pattern to gather information, then call done with your findings.";
    }

    /** Add an assistant message with a tool_call to context. */
    private addToolCallToContext(toolCallId: string, toolName: string, argsJson: string): void {
        this.contextManager.addToolCallEntry(toolCallId, toolName, argsJson);
    }

    private async summarizeContext(): Promise<void> {
        const content = this.contextManager.getCompressibleContent();
        if (!content) return;

        const result = await this.provider.complete({
            model: this.config.model,
            messages: [
                {role: "system", content: "Summarize the following agent interaction history concisely. Preserve key findings, file paths, and important code snippets."},
                {role: "user", content},
            ],
            signal: this.abortController.signal,
            timeoutMs: SUMMARIZE_TIMEOUT,
        });

        this.totalTokensUsed += result.usage?.totalTokens ?? 0;
        this.contextManager.applySummarization(result.content);
    }

    private buildForcedResult(startTime: number, reason: string): AgentResult {
        return {
            summary: reason,
            answer: `Agent stopped: ${reason} Completed ${this.iterationCount} iterations.`,
            filesRead: [...this.filesRead],
            tokensUsed: this.totalTokensUsed,
            iterationCount: this.iterationCount,
            elapsedMs: Date.now() - startTime,
        };
    }
}

// ============================================================
// OpenAI Function Calling Tools Definition
// ============================================================

/** Convert Agent tool defs to OpenAI function calling format. */
function buildOpenAITools(tools: Map<AgentToolName, import("./types.js").AgentToolDef>): Array<{type: "function"; function: {name: string; description: string; parameters: Record<string, unknown>}}> {
    const result: Array<{type: "function"; function: {name: string; description: string; parameters: Record<string, unknown>}}> = [];
    for (const def of tools.values()) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [name, param] of Object.entries(def.parameters)) {
            properties[name] = { type: param.type, description: param.description };
            if (param.required) required.push(name);
        }
        result.push({
            type: "function",
            function: {
                name: def.name,
                description: def.description,
                parameters: {
                    type: "object",
                    properties,
                    required,
                },
            },
        });
    }
    return result;
}

// ============================================================
// Decision Parsing (from function calling response)
// ============================================================

interface ParsedDecision extends PlannerDecision {
    toolCallId?: string;
}

/** Parse LLM response into a PlannerDecision. Prefers tool_calls, falls back to content parsing. */
function parseDecision(completion: import("@claude-versatile/lib/types.js").CompletionResult): ParsedDecision | null {
    // Primary: OpenAI function calling tool_calls
    if (completion.toolCalls && completion.toolCalls.length > 0) {
        const tc = completion.toolCalls[0]; // Process one tool call at a time
        return parseToolCall(tc.id, tc.function.name, tc.function.arguments, completion.content);
    }

    // Fallback: parse content as XML (for non-reasoning models that might use content)
    if (completion.content && completion.content !== "(empty response)") {
        return parseLegacyContent(completion.content);
    }

    return null;
}

function parseToolCall(id: string, name: string, argsJson: string, content: string): ParsedDecision | null {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const thought = content !== "(empty response)" ? content : "";

        if (name === "done") {
            return {
                thought,
                action: { type: "done", summary: String(args.summary ?? ""), answer: String(args.answer ?? "") },
                toolCallId: id,
            };
        }

        return {
            thought,
            action: { type: "tool_call", tool: name as AgentToolName, args },
            toolCallId: id,
        };
    } catch {
        return null;
    }
}

/** Legacy XML parsing fallback for models that return structured content. */
function parseLegacyContent(content: string): ParsedDecision | null {
    const thoughtMatch = content.match(/<thought>([\s\S]*?)<\/thought>/);
    const thought = thoughtMatch?.[1]?.trim() ?? "";

    const actionMatch = content.match(/<action>([\s\S]*?)<\/action>/);
    if (!actionMatch) {
        const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) return parseLegacyJson(thought || content.slice(0, 200), jsonMatch[1].trim());
        return null;
    }
    return parseLegacyJson(thought, actionMatch[1].trim());
}

function parseLegacyJson(thought: string, jsonStr: string): ParsedDecision | null {
    try {
        const parsed = JSON.parse(jsonStr) as {tool?: string; args?: Record<string, unknown>};
        if (!parsed.tool) return null;
        const args = parsed.args ?? {};
        if (parsed.tool === "done") {
            return { thought, action: { type: "done", summary: String(args.summary ?? ""), answer: String(args.answer ?? "") } };
        }
        return { thought, action: { type: "tool_call", tool: parsed.tool as AgentToolName, args } };
    } catch {
        return null;
    }
}