#!/usr/bin/env node

import {z} from "zod";
import {createClientFactory} from "@claude-versatile/lib/client.js";
import {executeCompletion, formatUsageLine} from "@claude-versatile/lib/completion.js";
import {mapErrorToResponse} from "@claude-versatile/lib/errors.js";
import {createServer, startServer, runServer} from "@claude-versatile/lib/bootstrap.js";
import {loadConfig, configValue, type GrokProviderConfig} from "@claude-versatile/lib/config.js";

const cfg = loadConfig<GrokProviderConfig>("grok.agent.json");

// Inject config values into process.env so createClientFactory can read them
if (cfg.apiKey && !process.env.GROK_API_KEY) process.env.GROK_API_KEY = cfg.apiKey;
if (cfg.baseUrl && !process.env.GROK_BASE_URL) process.env.GROK_BASE_URL = cfg.baseUrl;

const getClient = createClientFactory({
    apiKeyEnv: "GROK_API_KEY",
    baseUrlEnv: "GROK_BASE_URL",
    defaultBaseUrl: "https://api.x.ai/v1",
    maxRetries: cfg.maxRetries,
});

const DEFAULT_MODEL = configValue(cfg.defaultModel, "GROK_DEFAULT_MODEL", "grok-3");
const REQUEST_TIMEOUT = configValue(cfg.timeout, "GROK_REQUEST_TIMEOUT", 60_000);
const DEFAULT_SYSTEM_PROMPT =
    "You are a web search assistant. Search the web and provide accurate, up-to-date information with source citations. Be concise and factual. Always include relevant URLs when available.";

const server = createServer({name: "claude-versatile-grok", version: "0.1.0"});

server.tool(
    "grok_search",
    "Search the web using Grok's built-in search capability. Use this tool when the user needs current information, real-time data, latest news, or any query that requires up-to-date web results. Grok automatically decides when to invoke web search based on the query. Returns search results with source citations.",
    {
        query: z.string().min(1).max(10_000).describe("The search query or question to look up on the web"),
        system_prompt: z.string().max(5_000).optional().describe("Optional system prompt to guide search behavior"),
        model: z.string().min(1).max(100).default(DEFAULT_MODEL).describe(`Grok model to use (default: ${DEFAULT_MODEL})`),
    },
    async ({query, system_prompt, model}) => {
        try {
            const messages = [
                {role: "system" as const, content: system_prompt || DEFAULT_SYSTEM_PROMPT},
                {role: "user" as const, content: query},
            ];
            const result = await executeCompletion(getClient(), {model, messages}, REQUEST_TIMEOUT);

            return {content: [{type: "text" as const, text: result.content + formatUsageLine(result)}]};
        } catch (error) {
            return mapErrorToResponse(error, {serviceName: "Grok", model});
        }
    },
);

runServer(() => startServer(server, "Grok Search MCP Server"));
