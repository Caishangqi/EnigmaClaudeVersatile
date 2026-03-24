#!/usr/bin/env node

import {z} from "zod";
import {executeCompletion, formatUsageLine} from "@claude-versatile/lib/completion.js";
import {mapErrorToResponse} from "@claude-versatile/lib/errors.js";
import {defineProvider} from "@claude-versatile/lib/provider.js";

const DEFAULT_SYSTEM_PROMPT =
    "You are a web search assistant. Search the web and provide accurate, up-to-date information with source citations. Be concise and factual. Always include relevant URLs when available.";

defineProvider({
    type: "openai",
    name: "grok",
    version: "0.1.0",
    serverLabel: "Grok Search MCP Server",
    configFile: "grok.agent.json",
    envPrefix: "GROK",
    defaultBaseUrl: "https://api.x.ai/v1",
    modelEnv: "GROK_DEFAULT_MODEL",
    timeoutEnv: "GROK_REQUEST_TIMEOUT",
    defaults: {model: "grok-3", timeout: 60_000},
    serviceName: "Grok",

    hooks: {
        onRegisterTools(server, ctx) {
            server.tool(
                "grok_search",
                "Search the web using Grok's built-in search capability. Use this tool when the user needs current information, real-time data, latest news, or any query that requires up-to-date web results. Grok automatically decides when to invoke web search based on the query. Returns search results with source citations.",
                {
                    query: z.string().min(1).max(10_000).describe("The search query or question to look up on the web"),
                    system_prompt: z.string().max(5_000).optional().describe("Optional system prompt to guide search behavior"),
                    model: z.string().min(1).max(100).default(ctx.defaultModel).describe(`Grok model to use (default: ${ctx.defaultModel})`),
                },
                async ({query, system_prompt, model}) => {
                    try {
                        const messages = [
                            {role: "system" as const, content: system_prompt || DEFAULT_SYSTEM_PROMPT},
                            {role: "user" as const, content: query},
                        ];
                        const result = await executeCompletion(
                            ctx.getClient(),
                            {model, messages},
                            ctx.requestTimeout,
                        );
                        return {content: [{type: "text" as const, text: result.content + formatUsageLine(result)}]};
                    } catch (error) {
                        return mapErrorToResponse(error, {serviceName: "Grok", model});
                    }
                },
            );
        },
    },
});
