#!/usr/bin/env node

import {z} from "zod";
import {tavily} from "@tavily/core";
import {createServer, startServer, runServer} from "../../lib/bootstrap.js";
import {loadConfig, configValue, configRequired, type TavilyProviderConfig} from "../../lib/config.js";

const cfg = loadConfig<TavilyProviderConfig>("tavily.agent.json");

const apiKey = configRequired(cfg.apiKey, "TAVILY_API_KEY", "Tavily API key");
const client = tavily({apiKey});

const DEFAULT_MAX_RESULTS = configValue(cfg.maxResults, "TAVILY_MAX_RESULTS", 10);
const DEFAULT_SEARCH_DEPTH = configValue(cfg.searchDepth, "TAVILY_SEARCH_DEPTH", "advanced");

const server = createServer({name: "claude-versatile-tavily", version: "0.1.0"});

server.tool(
    "tavily_search",
    "Search the web using Tavily for current information, real-time data, latest news, or any query that requires up-to-date web results. Returns search results with source citations and relevance scores.",
    {
        query: z.string().min(1).max(400).describe("The search query (keep under 400 characters for best results)"),
        max_results: z.number().min(1).max(20).default(DEFAULT_MAX_RESULTS).describe(`Maximum number of results (default: ${DEFAULT_MAX_RESULTS})`),
        search_depth: z.enum(["basic", "advanced"]).default(DEFAULT_SEARCH_DEPTH as "basic" | "advanced").describe(`Search depth (default: ${DEFAULT_SEARCH_DEPTH})`),
        topic: z.enum(["general", "news", "finance"]).default("general").describe("Search topic category"),
        include_answer: z.boolean().default(true).describe("Include an AI-generated answer summary"),
        time_range: z.enum(["day", "week", "month", "year"]).optional().describe("Filter results by time range"),
    },
    async ({query, max_results, search_depth, topic, include_answer, time_range}) => {
        try {
            const response = await client.search(query, {
                maxResults: max_results,
                searchDepth: search_depth,
                topic,
                includeAnswer: include_answer,
                ...(time_range ? {timeRange: time_range} : {}),
            });

            const parts: string[] = [];

            if (response.answer) {
                parts.push(`**Answer:** ${response.answer}\n`);
            }

            if (response.results && response.results.length > 0) {
                parts.push("**Sources:**\n");
                for (const result of response.results) {
                    parts.push(`- **[${result.title}](${result.url})** (score: ${result.score.toFixed(2)})`);
                    if (result.content) {
                        parts.push(`  ${result.content}\n`);
                    }
                }
            } else {
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

runServer(() => startServer(server, "Tavily Search MCP Server"));
