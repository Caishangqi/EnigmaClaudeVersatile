#!/usr/bin/env node

import {z} from "zod";
import {defineProvider} from "@claude-versatile/lib/provider.js";

defineProvider({
    type: "openai",
    name: "codex",
    version: "0.1.0",
    serverLabel: "Codex MCP Server",
    configFile: "codex.agent.json",
    envPrefix: "OPENAI",
    modelEnv: "CODEX_DEFAULT_MODEL",
    timeoutEnv: "CODEX_REQUEST_TIMEOUT",
    defaults: {model: "gpt-4o", timeout: 60_000},
    serviceName: "OpenAI",

    hooks: {
        onRegisterTools(server, ctx) {
            server.tool(
                "codex_chat",
                "Send a prompt to OpenAI API and get a response. Use this tool when the user says 'use codex', 'ask codex', 'codex explore', 'let codex do', or wants to delegate analysis/generation/review tasks to an external OpenAI model. The external model is read-only and must NOT be used to modify files directly.",
                {
                    prompt: z.string().min(1).max(100_000).describe("The user prompt to send to the model"),
                    system_prompt: z.string().max(20_000).optional().describe("Optional system prompt to set model behavior"),
                    model: z.string().min(1).max(100).default(ctx.defaultModel).describe(`OpenAI model to use (default: ${ctx.defaultModel})`),
                    temperature: z.number().min(0).max(2).optional().describe("Sampling temperature (0-2)"),
                    max_tokens: z.number().int().positive().max(16_384).optional().describe("Maximum tokens in response"),
                },
                async ({prompt, system_prompt, model, temperature, max_tokens}) => {
                    return ctx.complete({
                        model,
                        prompt,
                        system_prompt,
                        extra: {
                            ...(temperature !== undefined && {temperature}),
                            ...(max_tokens !== undefined && {max_tokens}),
                        },
                    });
                },
            );
        },
    },
});
