#!/usr/bin/env node

import OpenAI from "openai";
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
        const client = createClientFromEnv(config.env, config.model);

        currentPlanner = new Planner(client, config, {
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
// Multi-Model Client Routing
// ============================================================

/**
 * Create an OpenAI client based on model name prefix.
 * - grok-* → GROK_API_KEY + GROK_BASE_URL
 * - * (default) → OPENAI_API_KEY + OPENAI_BASE_URL
 */
function createClientFromEnv(env: Record<string, string>, model: string): OpenAI {
    const isGrok = model.startsWith("grok");
    const apiKey = isGrok ? env.GROK_API_KEY : env.OPENAI_API_KEY;
    const baseURL = isGrok ? env.GROK_BASE_URL : env.OPENAI_BASE_URL;

    if (!apiKey) {
        const keyName = isGrok ? "GROK_API_KEY" : "OPENAI_API_KEY";
        throw new Error(`${keyName} is not set for model: ${model}`);
    }

    return new OpenAI({apiKey, ...(baseURL && {baseURL}), maxRetries: 3});
}
