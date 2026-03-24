import type OpenAI from "openai";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {ToolResponse} from "./types.js";
import {createClientFactory} from "./client.js";
import {executeCompletion, formatUsageLine} from "./completion.js";
import {mapErrorToResponse} from "./errors.js";
import {createServer, startServer, runServer} from "./bootstrap.js";
import {loadConfig, configValue, type BaseProviderConfig} from "./config.js";

// ============================================================
// Provider Lifecycle Hooks
// ============================================================

/**
 * Context object passed to OpenAI-compatible provider hooks.
 * Provides convenience methods that encapsulate the full
 * executeCompletion → format → error-handling pipeline.
 */
export interface OpenAIProviderContext {
    /** Resolved default model name */
    readonly defaultModel: string;
    /** Resolved request timeout in ms */
    readonly requestTimeout: number;
    /** Service name for error messages */
    readonly serviceName: string;
    /**
     * Convenience: build messages, call executeCompletion, format result, handle errors.
     * Covers ~80% of OpenAI-compatible tool handlers in a single call.
     */
    complete(opts: {
        model: string;
        prompt: string;
        system_prompt?: string;
        extra?: Record<string, unknown>;
    }): Promise<ToolResponse>;
    /** Direct access to the lazy-initialized OpenAI client. */
    getClient(): OpenAI;
}

/** Hooks for the OpenAI-compatible provider lifecycle. */
export interface OpenAIProviderHooks {
    /** Override config loading. Default: loadConfig + env injection. */
    onLoadConfig?: (configFile: string) => Partial<BaseProviderConfig>;
    /** Override client creation. Default: createClientFactory. */
    onCreateClient?: (cfg: Partial<BaseProviderConfig>) => () => OpenAI;
    /** Register MCP tools on the server. REQUIRED. */
    onRegisterTools: (server: McpServer, ctx: OpenAIProviderContext) => void;
    /** Override server startup. Default: runServer + startServer. */
    onServerReady?: (server: McpServer, label: string) => void;
}

/** Hooks for the native SDK provider lifecycle. */
export interface NativeProviderHooks {
    /** Override config loading. Default: loadConfig (no env injection). */
    onLoadConfig?: (configFile: string) => Partial<BaseProviderConfig>;
    /** Initialize your SDK client. REQUIRED for native providers. */
    onCreateClient: (cfg: Partial<BaseProviderConfig>) => void;
    /** Register MCP tools on the server. REQUIRED. */
    onRegisterTools: (server: McpServer) => void;
    /** Override server startup. Default: runServer + startServer. */
    onServerReady?: (server: McpServer, label: string) => void;
}

// ============================================================
// Provider Descriptors
// ============================================================

interface BaseDescriptor {
    /** Short name, e.g. "codex". Server name becomes "claude-versatile-{name}". */
    name: string;
    /** Semver version string. */
    version: string;
    /** Human-readable label for startup log, e.g. "Codex MCP Server". */
    serverLabel: string;
    /** Config filename in .versatile/, e.g. "codex.agent.json". */
    configFile: string;
}

/** Descriptor for OpenAI-compatible providers (codex, grok, deepseek, etc.). */
export interface OpenAIProviderDescriptor extends BaseDescriptor {
    type: "openai";
    /** Env var prefix, e.g. "OPENAI" → OPENAI_API_KEY, OPENAI_BASE_URL. */
    envPrefix: string;
    /** Env var name for model override, e.g. "CODEX_DEFAULT_MODEL". */
    modelEnv: string;
    /** Env var name for timeout override, e.g. "CODEX_REQUEST_TIMEOUT". */
    timeoutEnv: string;
    /** Default base URL if env var is not set. undefined = use SDK default. */
    defaultBaseUrl?: string;
    /** Hardcoded fallback defaults. */
    defaults: { model: string; timeout: number };
    /** Service name for error messages, e.g. "OpenAI", "Grok". */
    serviceName: string;
    hooks: OpenAIProviderHooks;
}

/** Descriptor for native SDK providers (tavily, gemini, etc.). */
export interface NativeProviderDescriptor extends BaseDescriptor {
    type: "native";
    hooks: NativeProviderHooks;
}

export type ProviderDescriptor = OpenAIProviderDescriptor | NativeProviderDescriptor;

// ============================================================
// defineProvider — unified entry point
// ============================================================

/**
 * Define and immediately run an MCP server from a provider descriptor.
 * Executes the lifecycle: onLoadConfig → onCreateClient → onRegisterTools → onServerReady.
 */
export function defineProvider(desc: ProviderDescriptor): void {
    if (desc.type === "openai") {
        runOpenAIProvider(desc);
    } else {
        runNativeProvider(desc);
    }
}

// ============================================================
// OpenAI-compatible lifecycle
// ============================================================

function runOpenAIProvider(desc: OpenAIProviderDescriptor): void {
    // Phase 1: Load config
    const cfg = desc.hooks.onLoadConfig
        ? desc.hooks.onLoadConfig(desc.configFile)
        : defaultOpenAILoadConfig(desc);

    // Phase 2: Create client
    const getClient = desc.hooks.onCreateClient
        ? desc.hooks.onCreateClient(cfg)
        : defaultOpenAICreateClient(desc, cfg);

    // Resolve defaults
    const defaultModel = configValue(cfg.defaultModel, desc.modelEnv, desc.defaults.model);
    const requestTimeout = configValue(cfg.timeout, desc.timeoutEnv, desc.defaults.timeout);

    // Build context
    const ctx: OpenAIProviderContext = {
        defaultModel,
        requestTimeout,
        serviceName: desc.serviceName,
        getClient,
        async complete(opts) {
            try {
                const messages: OpenAI.ChatCompletionMessageParam[] = [
                    ...(opts.system_prompt ? [{role: "system" as const, content: opts.system_prompt}] : []),
                    {role: "user" as const, content: opts.prompt},
                ];
                const result = await executeCompletion(
                    getClient(),
                    {model: opts.model, messages, ...(opts.extra && {extra: opts.extra})},
                    requestTimeout,
                );
                return {content: [{type: "text" as const, text: result.content + formatUsageLine(result)}]};
            } catch (error) {
                return mapErrorToResponse(error, {serviceName: desc.serviceName, model: opts.model});
            }
        },
    };

    // Phase 3: Create server + register tools
    const server = createServer({name: `claude-versatile-${desc.name}`, version: desc.version});
    desc.hooks.onRegisterTools(server, ctx);

    // Phase 4: Start
    if (desc.hooks.onServerReady) {
        desc.hooks.onServerReady(server, desc.serverLabel);
    } else {
        runServer(() => startServer(server, desc.serverLabel));
    }
}

function defaultOpenAILoadConfig(desc: OpenAIProviderDescriptor): Partial<BaseProviderConfig> {
    const cfg = loadConfig<BaseProviderConfig>(desc.configFile);
    const apiKeyEnv = `${desc.envPrefix}_API_KEY`;
    const baseUrlEnv = `${desc.envPrefix}_BASE_URL`;
    if (cfg.apiKey && !process.env[apiKeyEnv]) process.env[apiKeyEnv] = cfg.apiKey;
    if (cfg.baseUrl && !process.env[baseUrlEnv]) process.env[baseUrlEnv] = cfg.baseUrl;
    return cfg;
}

function defaultOpenAICreateClient(desc: OpenAIProviderDescriptor, cfg: Partial<BaseProviderConfig>): () => OpenAI {
    return createClientFactory({
        apiKeyEnv: `${desc.envPrefix}_API_KEY`,
        baseUrlEnv: `${desc.envPrefix}_BASE_URL`,
        defaultBaseUrl: desc.defaultBaseUrl,
        maxRetries: cfg.maxRetries,
    });
}

// ============================================================
// Native SDK lifecycle
// ============================================================

function runNativeProvider(desc: NativeProviderDescriptor): void {
    // Phase 1: Load config
    const cfg = desc.hooks.onLoadConfig
        ? desc.hooks.onLoadConfig(desc.configFile)
        : loadConfig<BaseProviderConfig>(desc.configFile);

    // Phase 2: Create client (user-provided)
    desc.hooks.onCreateClient(cfg);

    // Phase 3: Create server + register tools
    const server = createServer({name: `claude-versatile-${desc.name}`, version: desc.version});
    desc.hooks.onRegisterTools(server);

    // Phase 4: Start
    if (desc.hooks.onServerReady) {
        desc.hooks.onServerReady(server, desc.serverLabel);
    } else {
        runServer(() => startServer(server, desc.serverLabel));
    }
}
