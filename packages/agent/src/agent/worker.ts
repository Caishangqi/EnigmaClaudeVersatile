#!/usr/bin/env node

import OpenAI from "openai";
import {OpenAICompletionProvider} from "@claude-versatile/lib/completion.js";
import {resolveModelRoute} from "@claude-versatile/lib/config.js";
import type {CompletionProvider} from "@claude-versatile/lib/types.js";
import {Planner} from "./planner.js";
import type {ParentToWorkerMessage, WorkerToParentMessage, AgentConfig} from "./types.js";

let currentPlanner: Planner | null = null;

// ============================================================
// IPC Communication
// ============================================================

function send(msg: WorkerToParentMessage): void {
    process.send?.(msg);
}

process.on("message", (msg: ParentToWorkerMessage) => {
    if (msg.type === "start") {
        runAgent(msg.config).catch((err) => {
            send({type: "error", error: err instanceof Error ? err.message : String(err)});
            process.exit(1);
        });
    } else if (msg.type === "cancel") {
        currentPlanner?.cancel();
    }
});

// ============================================================
// Agent Execution
// ============================================================

async function runAgent(config: AgentConfig): Promise<void> {
    try {
        const provider = createProviderFromEnv(config.env, config.model);

        currentPlanner = new Planner(provider, config, {
            onIteration: (step, iteration, filesRead, tokensUsed) => {
                send({type: "status", currentStep: step, iterationCount: iteration, filesRead, tokensUsed});
            },
        });

        const result = await currentPlanner.run();
        send({type: "complete", result});
    } catch (error) {
        send({type: "error", error: error instanceof Error ? error.message : String(error)});
    } finally {
        currentPlanner = null;
        process.exit(0);
    }
}

// ============================================================
// Multi-Model Provider Routing (data-driven)
// ============================================================

/**
 * Create a CompletionProvider based on model name prefix.
 * Uses MODEL_ROUTES from config to resolve the correct API key and base URL.
 *
 * Currently all routes produce OpenAICompletionProvider (OpenAI-compatible APIs).
 * Future non-OpenAI providers (Gemini, etc.) can return a different CompletionProvider
 * implementation here without changing Planner.
 */
function createProviderFromEnv(env: Record<string, string>, model: string): CompletionProvider {
    const route = resolveModelRoute(model);
    const apiKey = env[route.apiKeyEnv];

    if (!apiKey) {
        throw new Error(`${route.apiKeyEnv} is not set for model: ${model}`);
    }

    const baseURL = env[route.baseUrlEnv];
    const client = new OpenAI({apiKey, ...(baseURL && {baseURL}), maxRetries: 3});
    return new OpenAICompletionProvider(client);
}
