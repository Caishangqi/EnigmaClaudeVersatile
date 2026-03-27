import OpenAI from "openai";
import {OpenAICompletionProvider} from "@claude-versatile/lib/completion.js";
import type {AgentToolDef, AgentToolResult} from "../../types.js";

const MAX_SEARCH_OUTPUT = 8000;
const SEARCH_TIMEOUT_MS = 60_000;
const SEARCH_SYSTEM_PROMPT =
    "You are a web search assistant. Search the web and provide accurate, up-to-date information with source citations. " +
    "Be concise and factual. Always include relevant URLs when available.";

/**
 * Create a web_search tool powered by Grok's built-in web search.
 * Returns null if GROK_API_KEY is not available in env.
 */
export function createWebSearchTool(env: Record<string, string>): AgentToolDef | null {
    const apiKey = env["GROK_API_KEY"];
    if (!apiKey) return null;

    const baseURL = env["GROK_BASE_URL"];
    const client = new OpenAI({apiKey, ...(baseURL && {baseURL}), maxRetries: 3});
    const provider = new OpenAICompletionProvider(client, {defaultTimeoutMs: SEARCH_TIMEOUT_MS});
    const searchModel = env["GROK_DEFAULT_MODEL"] || "grok-4";

    return {
        name: "web_search",
        description: "Search the web for current information, documentation, news, or facts. Returns search results as text. You can search multiple times to refine results.",
        parameters: {
            query: {type: "string", description: "Search query — describe what you're looking for", required: true},
        },
        metadata: {
            category: "external",
            systemPromptHint: "You have web search capability via the web_search tool. Use it to find current information, documentation, or facts not available locally. You can search multiple times to refine results.",
        },
        execute: async (args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> => {
            const query = String(args.query ?? "");
            if (!query) return {success: false, output: "Error: 'query' parameter is required.", charCount: 0};

            try {
                const result = await provider.complete({
                    model: searchModel,
                    messages: [
                        {role: "system", content: SEARCH_SYSTEM_PROMPT},
                        {role: "user", content: query},
                    ],
                });
                const output = result.content.length > MAX_SEARCH_OUTPUT
                    ? result.content.slice(0, MAX_SEARCH_OUTPUT) + "\n[truncated]"
                    : result.content;
                return {success: true, output, charCount: output.length};
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {success: false, output: `Search failed: ${msg}`, charCount: 0};
            }
        },
    };
}
