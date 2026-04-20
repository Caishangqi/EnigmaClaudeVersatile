import {tavily} from "@tavily/core";
import type {AgentToolDef, AgentToolResult} from "../../types.js";

const MAX_SEARCH_OUTPUT = 8000;

/**
 * Create a web_search_tavily tool powered by Tavily search API.
 * Returns null if TAVILY_API_KEY is not available in env.
 */
export function createTavilyWebSearchTool(env: Record<string, string>): AgentToolDef | null {
    const apiKey = env["TAVILY_API_KEY"];
    if (!apiKey) return null;

    const client = tavily({apiKey});

    return {
        name: "web_search_tavily",
        description: "Search the web using Tavily for current information, documentation, news, or facts. Returns structured search results with titles, URLs, and content snippets. Prefer this for factual queries and research.",
        parameters: {
            query: {type: "string", description: "Search query — describe what you're looking for (max 400 chars)", required: true},
        },
        metadata: {
            category: "external",
            systemPromptHint: "You have Tavily web search capability via the web_search_tavily tool. Use it to find current information, documentation, or facts not available locally.",
        },
        execute: async (args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> => {
            const query = String(args.query ?? "");
            if (!query) return {success: false, output: "Error: 'query' parameter is required.", charCount: 0};

            try {
                const response = await client.search(query, {
                    searchDepth: "advanced",
                    maxResults: 5,
                    includeAnswer: "basic",
                });

                const lines: string[] = [];
                if (response.answer) {
                    lines.push("Answer: " + response.answer, "");
                }
                for (const result of response.results) {
                    lines.push(`[${result.title}](${result.url})`);
                    if (result.content) {
                        lines.push(result.content);
                    }
                    lines.push("");
                }

                let output = lines.join("\n").trim();
                if (output.length > MAX_SEARCH_OUTPUT) {
                    output = output.slice(0, MAX_SEARCH_OUTPUT) + "\n[truncated]";
                }
                return {success: true, output, charCount: output.length};
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {success: false, output: `Tavily search failed: ${msg}`, charCount: 0};
            }
        },
    };
}
