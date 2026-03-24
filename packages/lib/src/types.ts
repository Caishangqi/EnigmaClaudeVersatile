import type OpenAI from "openai";

/**
 * Configuration for creating a lazy-initialized OpenAI-compatible client.
 */
export interface ClientConfig {
    /** Environment variable name for the API key */
    apiKeyEnv: string;
    /** Environment variable name for the base URL */
    baseUrlEnv: string;
    /** Fallback base URL if env var is not set. undefined = use SDK default */
    defaultBaseUrl?: string;
    /** Max retries for transient errors (SDK built-in: 408/429/500+, exponential backoff). Default 3. */
    maxRetries?: number;
}

/**
 * Parameters for a single chat completion request.
 */
export interface CompletionRequest {
    model: string;
    messages: OpenAI.ChatCompletionMessageParam[];
    /** Per-call timeout in ms. Overrides server-level default. */
    timeoutMs?: number;
    /** Optional AbortSignal for external cancellation (Layer 2 Agent prep) */
    signal?: AbortSignal;
    /** Pass-through params (temperature, max_tokens, etc.) */
    extra?: Record<string, unknown>;
}

/**
 * Normalized result from a chat completion.
 */
export interface CompletionResult {
    content: string;
    model: string;
    toolCalls?: Array<{
        id: string;
        function: { name: string; arguments: string };
    }>;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * MCP tool response shape.
 */
export interface ToolResponse {
    [x: string]: unknown;
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

/**
 * Error context for user-facing error messages.
 */
export interface ErrorContext {
    serviceName: string;
    model?: string;
}

/**
 * Configuration for the MCP server bootstrap.
 */
export interface ServerConfig {
    name: string;
    version: string;
}
