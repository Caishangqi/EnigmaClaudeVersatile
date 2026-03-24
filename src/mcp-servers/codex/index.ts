#!/usr/bin/env node

import {z} from "zod";
import {createClientFactory} from "../../lib/client.js";
import {executeCompletion, formatUsageLine} from "../../lib/completion.js";
import {mapErrorToResponse} from "../../lib/errors.js";
import {createServer, startServer, runServer} from "../../lib/bootstrap.js";
import {loadConfig, configValue, type CodexProviderConfig} from "../../lib/config.js";

const cfg = loadConfig<CodexProviderConfig>("codex.agent.json");

// Inject config values into process.env so createClientFactory can read them
if (cfg.apiKey && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = cfg.apiKey;
if (cfg.baseUrl && !process.env.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = cfg.baseUrl;

const getClient = createClientFactory({
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    maxRetries: cfg.maxRetries,
});

const DEFAULT_MODEL = configValue(cfg.defaultModel, "CODEX_DEFAULT_MODEL", "gpt-4o");
const REQUEST_TIMEOUT = configValue(cfg.timeout, "CODEX_REQUEST_TIMEOUT", 60_000);

const server = createServer({name: "claude-versatile-codex", version: "0.1.0"});

server.tool(
    "codex_chat",
    "Send a prompt to OpenAI API and get a response. Use this tool when the user says 'use codex', 'ask codex', 'codex explore', 'let codex do', or wants to delegate analysis/generation/review tasks to an external OpenAI model. The external model is read-only and must NOT be used to modify files directly.",
    {
        prompt: z.string().min(1).max(100_000).describe("The user prompt to send to the model"),
        system_prompt: z.string().max(20_000).optional().describe("Optional system prompt to set model behavior"),
        model: z.string().min(1).max(100).default(DEFAULT_MODEL).describe(`OpenAI model to use (default: ${DEFAULT_MODEL})`),
        temperature: z.number().min(0).max(2).optional().describe("Sampling temperature (0-2)"),
        max_tokens: z.number().int().positive().max(16_384).optional().describe("Maximum tokens in response"),
    },
    async ({prompt, system_prompt, model, temperature, max_tokens}) => {
        try {
            const messages = [
                ...(system_prompt ? [{role: "system" as const, content: system_prompt}] : []),
                {role: "user" as const, content: prompt},
            ];
            const result = await executeCompletion(getClient(), {
                model,
                messages,
                extra: {
                    ...(temperature !== undefined && {temperature}),
                    ...(max_tokens !== undefined && {max_tokens}),
                },
            }, REQUEST_TIMEOUT);

            return {content: [{type: "text", text: result.content + formatUsageLine(result)}]};
        } catch (error) {
            return mapErrorToResponse(error, {serviceName: "OpenAI", model});
        }
    },
);

runServer(() => startServer(server, "Codex MCP Server"));
