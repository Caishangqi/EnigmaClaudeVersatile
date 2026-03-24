import OpenAI from "openai";
import type {ClientConfig} from "./types.js";

/** Default retry count for OpenAI SDK built-in retry (exponential backoff, Retry-After support). */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Creates a lazy-initialized OpenAI client getter.
 * Each MCP server calls this once at module level with its own config.
 * Retry is handled by the SDK: 408/429/500+ with exponential backoff (0.5s*2^n, max 8s, 25% jitter).
 */
export function createClientFactory(config: ClientConfig): () => OpenAI {
    let client: OpenAI | null = null;

    return (): OpenAI => {
        if (!client) {
            const apiKey = process.env[config.apiKeyEnv];
            if (!apiKey) {
                throw new Error(`${config.apiKeyEnv} is not set`);
            }
            const baseURL = process.env[config.baseUrlEnv] || config.defaultBaseUrl;
            client = new OpenAI({
                apiKey,
                ...(baseURL && {baseURL}),
                maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
            });
        }
        return client;
    };
}
