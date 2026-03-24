import type OpenAI from "openai";
import type {CompletionRequest, CompletionResult, CompletionProvider} from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

// ============================================================
// OpenAICompletionProvider — implements CompletionProvider
// ============================================================

/**
 * CompletionProvider implementation for OpenAI-compatible APIs.
 * Covers OpenAI, Grok (xAI), DeepSeek, and any provider using the OpenAI protocol.
 *
 * Usage:
 *   const provider = new OpenAICompletionProvider(client, { defaultTimeoutMs: 60000 });
 *   const result = await provider.complete(request);
 *
 * For custom providers (Gemini, Tavily, etc.), implement CompletionProvider directly.
 */
export class OpenAICompletionProvider implements CompletionProvider {
    constructor(
        private readonly client: OpenAI,
        private readonly options: { defaultTimeoutMs?: number } = {},
    ) {}

    async complete(request: CompletionRequest): Promise<CompletionResult> {
        const completion = await this.client.chat.completions.create(
            {
                model: request.model,
                messages: request.messages,
                stream: false,
                ...request.extra,
            },
            {
                timeout: request.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
                signal: request.signal ?? undefined,
            },
        );
        return extractResult(completion);
    }
}

// ============================================================
// Legacy convenience function (delegates to provider internally)
// ============================================================

/**
 * Executes a chat completion request.
 * @deprecated Prefer `new OpenAICompletionProvider(client).complete(request)` for new code.
 * Kept for backward compatibility with existing MCP server entry points.
 */
export async function executeCompletion(
    client: OpenAI,
    request: CompletionRequest,
    defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CompletionResult> {
    const provider = new OpenAICompletionProvider(client, {defaultTimeoutMs});
    return provider.complete(request);
}

// ============================================================
// Result Extraction (shared by provider)
// ============================================================

/**
 * Extracts normalized result from raw completion.
 * Throws NoChoicesError if no choices returned.
 */
function extractResult(completion: OpenAI.ChatCompletion): CompletionResult {
    const choice = completion.choices?.[0];
    if (!choice) {
        throw new NoChoicesError();
    }

    const content =
        typeof choice.message?.content === "string" && choice.message.content.length > 0
            ? choice.message.content
            : extractReasoningContent(choice) ?? "(empty response)";

    // Extract tool_calls if present (for function calling mode)
    const toolCalls = choice.message?.tool_calls?.map(tc => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    const usage = completion.usage;
    return {
        content,
        model: completion.model,
        ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
        usage: usage
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
            }
            : undefined,
    };
}

/** Sentinel error for "no choices" — distinct from API errors */
export class NoChoicesError extends Error {
    constructor() {
        super("Model returned no choices");
        this.name = "NoChoicesError";
    }
}

/**
 * Fallback for reasoning models (e.g. gpt-5.4, o1, o3) that put content
 * in a non-standard `reasoning_content` field instead of `content`.
 */
function extractReasoningContent(choice: OpenAI.ChatCompletion.Choice): string | null {
    const msg = choice.message as unknown as Record<string, unknown>;
    if (typeof msg?.reasoning_content === "string" && msg.reasoning_content.length > 0) {
        return msg.reasoning_content;
    }
    return null;
}

// ============================================================
// Shared Formatting Utilities
// ============================================================

/** Format token count: 1234 → "1.2k", 800 → "800" */
export function formatTokens(n: number): string {
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1)}k`;
}

/** Format duration in ms: 1500 → "1.5s", 500 → "500ms" */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a one-line usage/metadata footer for MCP tool output. */
export function formatUsageLine(result: CompletionResult): string {
    if (!result.usage) return "";
    const { promptTokens, completionTokens, totalTokens } = result.usage;
    return `\n\n[${result.model} · ${formatTokens(promptTokens)} in + ${formatTokens(completionTokens)} out = ${formatTokens(totalTokens)} tokens]`;
}
