#!/usr/bin/env node

import {z} from "zod";
import {tavily, TavilyClient} from "@tavily/core";
import {configRequired, configValue, loadConfig, type BaseProviderConfig} from "@claude-versatile/lib/config.js";
import {defineProvider} from "@claude-versatile/lib/provider.js";

let client: TavilyClient;

defineProvider({
    type: "native",
    name: "tavily",
    version: "0.1.0",
    serverLabel: "Tavily Search MCP Server",
    configFile: "tavily.agent.json",

    hooks: {
        onCreateClient(cfg) {
            const apiKey = configRequired(cfg.apiKey, "TAVILY_API_KEY", "Tavily API key");
            client = tavily({apiKey});
        },

        onRegisterTools(server) {
            const cfg = loadConfig<BaseProviderConfig>("tavily.agent.json");
            const maxResultsDefault = configValue(
                (cfg as Record<string, unknown>).maxResults as number | undefined,
                "TAVILY_MAX_RESULTS",
                5,
            );

            server.tool(
                "tavily_search",
                "Search the web using Tavily's search API, optimized for LLM consumption. Returns relevant web results with content snippets and optional AI-generated answer. Use for real-time information, current events, technical research, or any query requiring up-to-date web data.",
                {
                    query: z.string().min(1).max(400).describe("The search query (keep under 400 characters for best results)"),
                    search_depth: z.enum(["basic", "advanced"]).default("basic").describe("Search depth: 'basic' (fast, 1 credit) or 'advanced' (thorough, 2 credits)"),
                    max_results: z.number().int().min(1).max(20).default(maxResultsDefault).describe(`Maximum number of results to return (default: ${maxResultsDefault})`),
                    include_answer: z.boolean().default(true).describe("Include an AI-generated summary answer"),
                    topic: z.enum(["general", "news", "finance"]).default("general").describe("Search topic category"),
                },
                async ({query, search_depth, max_results, include_answer, topic}) => {
                    try {
                        const response = await client.search(query, {
                            searchDepth: search_depth,
                            maxResults: max_results,
                            includeAnswer: include_answer,
                            topic,
                        });

                        const parts: string[] = [];

                        // Include AI-generated answer if available
                        if (response.answer) {
                            parts.push(`## Answer\n${response.answer}\n`);
                        }

                        // Format search results
                        if (response.results && response.results.length > 0) {
                            parts.push("## Sources\n");
                            for (const result of response.results) {
                                parts.push(`### ${result.title}`);
                                parts.push(`URL: ${result.url}`);
                                if (result.content) {
                                    parts.push(result.content);
                                }
                                parts.push(`Relevance: ${result.score?.toFixed(3) ?? "N/A"}\n`);
                            }
                        }

                        if (parts.length === 0) {
                            parts.push("No results found.");
                        }

                        return {content: [{type: "text" as const, text: parts.join("\n")}]};
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return {
                            content: [{type: "text" as const, text: `Tavily search error: ${message}`}],
                            isError: true,
                        };
                    }
                },
            );

            server.tool(
                "tavily_extract",
                "Extract content from specific URLs using Tavily's extraction API. Useful for getting full page content from known URLs. Returns cleaned, LLM-ready text.",
                {
                    urls: z.array(z.string().url()).min(1).max(20).describe("URLs to extract content from (max 20)"),
                    query: z.string().max(400).optional().describe("Optional query to rerank extracted chunks by relevance"),
                },
                async ({urls, query}) => {
                    try {
                        const response = await client.extract(urls, {
                            ...(query && {query}),
                        });

                        const parts: string[] = [];

                        if (response.results && response.results.length > 0) {
                            for (const result of response.results) {
                                parts.push(`### ${result.url}`);
                                if (result.rawContent) {
                                    parts.push(result.rawContent);
                                }
                                parts.push("");
                            }
                        }

                        if (response.failedResults && response.failedResults.length > 0) {
                            parts.push("## Failed extractions");
                            for (const failed of response.failedResults) {
                                parts.push(`- ${failed.url}: ${failed.error ?? "unknown error"}`);
                            }
                        }

                        if (parts.length === 0) {
                            parts.push("No content extracted.");
                        }

                        return {content: [{type: "text" as const, text: parts.join("\n")}]};
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return {
                            content: [{type: "text" as const, text: `Tavily extract error: ${message}`}],
                            isError: true,
                        };
                    }
                },
            );
        },
    },
});
