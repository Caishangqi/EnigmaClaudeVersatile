import type OpenAI from "openai";
import type {ContextEntry, ContextManagerConfig} from "./types.js";

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxContextTokens: 80_000,
    summarizeThreshold: 0.8,
    summarizeTarget: 0.5,
};

/** Rough token estimation: ~4 chars per token (conservative). */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Manages the LLM conversation context window.
 * Supports OpenAI function calling protocol (assistant tool_calls + tool responses).
 */
export class ContextManager {
    private entries: ContextEntry[] = [];
    private config: ContextManagerConfig;
    private totalTokens = 0;

    constructor(config?: Partial<ContextManagerConfig>) {
        this.config = {...DEFAULT_CONFIG, ...config};
    }

    /** Add a text message to the context. */
    addEntry(role: "system" | "user" | "assistant" | "tool", content: string, compressible = true, toolCallId?: string): void {
        const estimatedTokens = estimateTokens(content);
        this.entries.push({role, content, estimatedTokens, compressible, toolCallId});
        this.totalTokens += estimatedTokens;
    }

    /** Add an assistant message with a tool_call (OpenAI function calling protocol). */
    addToolCallEntry(toolCallId: string, toolName: string, argsJson: string): void {
        const estimatedTokens = estimateTokens(argsJson) + 20;
        this.entries.push({
            role: "assistant",
            content: "",
            estimatedTokens,
            compressible: true,
            toolCall: {id: toolCallId, name: toolName, arguments: argsJson},
        });
        this.totalTokens += estimatedTokens;
    }

    /** Convert entries to OpenAI message format, including function calling messages. */
    getMessages(): OpenAI.ChatCompletionMessageParam[] {
        return this.entries.map((e): OpenAI.ChatCompletionMessageParam => {
            // Assistant message with tool_call
            if (e.role === "assistant" && e.toolCall) {
                return {
                    role: "assistant",
                    content: null,
                    tool_calls: [{
                        id: e.toolCall.id,
                        type: "function" as const,
                        function: {name: e.toolCall.name, arguments: e.toolCall.arguments},
                    }],
                };
            }
            // Tool response message
            if (e.role === "tool" && e.toolCallId) {
                return {
                    role: "tool",
                    content: e.content,
                    tool_call_id: e.toolCallId,
                };
            }
            // Regular message
            return {role: e.role as "system" | "user" | "assistant", content: e.content};
        });
    }

    /** Current estimated token count. */
    getEstimatedTokens(): number {
        return this.totalTokens;
    }

    /** Check if summarization should be triggered. */
    needsSummarization(): boolean {
        return this.totalTokens > this.config.maxContextTokens * this.config.summarizeThreshold;
    }

    /**
     * Get the content of compressible entries for summarization.
     * Preserves the first entry (system prompt) and last 2 entries.
     */
    getCompressibleContent(): string {
        if (this.entries.length <= 3) return "";
        const compressible = this.entries.slice(1, -2).filter((e) => e.compressible);
        return compressible
            .map((e) => {
                if (e.toolCall) return `[assistant tool_call]: ${e.toolCall.name}(${e.toolCall.arguments})`;
                return `[${e.role}]: ${e.content}`;
            })
            .join("\n\n---\n\n");
    }

    /** Replace compressible middle entries with a single summary. */
    applySummarization(summaryContent: string): void {
        if (this.entries.length <= 3) return;
        const first = this.entries[0];
        const lastTwo = this.entries.slice(-2);
        const summaryEntry: ContextEntry = {
            role: "system",
            content: `[Previous interaction summary]\n${summaryContent}`,
            estimatedTokens: estimateTokens(summaryContent),
            compressible: true,
        };
        this.entries = [first, summaryEntry, ...lastTwo];
        this.totalTokens = this.entries.reduce((sum, e) => sum + e.estimatedTokens, 0);
    }

    /** Number of entries in the context. */
    get length(): number {
        return this.entries.length;
    }
}