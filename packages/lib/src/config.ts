import {readFileSync, existsSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";

// ============================================================
// Config Interfaces
// ============================================================

/**
 * Base configuration shared by all API providers.
 * Extend this interface to add provider-specific fields.
 */
export interface BaseProviderConfig {
    /** API key for authentication */
    apiKey: string;
    /** Base URL for the API endpoint */
    baseUrl: string;
    /** Default model identifier */
    defaultModel: string;
    /** Request timeout in milliseconds */
    timeout: number;
    /** Max retries for transient errors */
    maxRetries: number;
}

/** OpenAI / Codex provider configuration */
export interface CodexProviderConfig extends BaseProviderConfig {}

/** Grok / xAI provider configuration */
export interface GrokProviderConfig extends BaseProviderConfig {}

/**
 * Agent behavior configuration (not an API provider).
 */
export interface AgentBehaviorConfig {
    defaultModel: string;
    maxIterations: number;
    maxTimeMs: number;
    singleCallTimeout: number;
    /** Enable auto iteration control (L1+L2). Default: true. */
    autoMode: boolean;
    /** Maximum cumulative token budget for autoMode. Default: 100000. 0 = unlimited. */
    maxTokenBudget: number;
    /** List of enabled tool names. If omitted, all built-in tools are enabled. */
    enabledTools?: string[];
}

// ============================================================
// Config Templates (generated on first run)
// ============================================================

export const TEMPLATES: Record<string, unknown> = {
    "codex.agent.json": {
        apiKey: "YOUR_API_KEY_HERE",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
        timeout: 60000,
        maxRetries: 3,
    },
    "grok.agent.json": {
        apiKey: "YOUR_API_KEY_HERE",
        baseUrl: "https://api.x.ai/v1",
        defaultModel: "grok-4",
        timeout: 60000,
        maxRetries: 3,
    },
    "tavily.agent.json": {
        apiKey: "YOUR_API_KEY_HERE",
        maxResults: 5,
    },
    "agent.json": {
        defaultModel: "gpt-4o",
        maxIterations: 20,
        maxTimeMs: 300000,
        singleCallTimeout: 120000,
        autoMode: true,
        maxTokenBudget: 100000,
    },
};

export const PLACEHOLDER_KEY = "YOUR_API_KEY_HERE";

// ============================================================
// Agent Model Route Table
// ============================================================

/**
 * Maps model name prefixes to their config file and env var names.
 * Used by Agent's collectEnv() and Worker's createClientFromEnv().
 *
 * Matching order: first match wins (longest prefix should come first if ambiguous).
 * The "default" entry (empty prefix) is the fallback for unmatched models.
 */
export interface ModelRoute {
    /** Model name prefix to match (e.g. "grok"). Empty string = default fallback. */
    prefix: string;
    /** Config filename in .versatile/ (e.g. "grok.agent.json"). */
    configFile: string;
    /** Env var name for API key (e.g. "GROK_API_KEY"). */
    apiKeyEnv: string;
    /** Env var name for base URL (e.g. "GROK_BASE_URL"). */
    baseUrlEnv: string;
    /** Whether the model supports OpenAI function calling (tools param). Default: true. */
    supportsFunctionCalling?: boolean;
}

export const MODEL_ROUTES: ModelRoute[] = [
    {prefix: "grok",     configFile: "grok.agent.json",  apiKeyEnv: "GROK_API_KEY",    baseUrlEnv: "GROK_BASE_URL",  supportsFunctionCalling: false},
    // Add new providers here:
    // {prefix: "deepseek", configFile: "deepseek.agent.json", apiKeyEnv: "DEEPSEEK_API_KEY", baseUrlEnv: "DEEPSEEK_BASE_URL"},
    // Default fallback (OpenAI) — must be last
    {prefix: "",         configFile: "codex.agent.json", apiKeyEnv: "OPENAI_API_KEY",  baseUrlEnv: "OPENAI_BASE_URL"},
];

/** Find the matching route for a model name. Returns the default route if no prefix matches. */
export function resolveModelRoute(model: string): ModelRoute {
    for (const route of MODEL_ROUTES) {
        if (route.prefix && model.startsWith(route.prefix)) return route;
    }
    // Return default (last entry with empty prefix)
    return MODEL_ROUTES[MODEL_ROUTES.length - 1];
}

// ============================================================
// Config Loader
// ============================================================

let versatileDir: string | null = null;

/**
 * Resolve the .versatile/ directory path.
 * Priority: VERSATILE_ROOT env var > walk up from current file to find project root.
 * Creates the directory with template files if it doesn't exist.
 */
function resolveVersatileDir(): string | null {
    if (versatileDir !== null) return versatileDir;

    // 1. Explicit env var
    const envRoot = process.env.VERSATILE_ROOT;
    if (envRoot) {
        const dir = path.join(envRoot, ".versatile");
        versatileDir = ensureDir(dir);
        return versatileDir;
    }

    // 2. Walk up from this file's directory to find monorepo root.
    //    In a monorepo, sub-packages also have package.json, so we can't
    //    stop at the first one. Walk all the way up, collect candidates, pick best:
    //      Priority 1: package.json with "workspaces" field (monorepo root)
    //      Priority 2: first package.json found (fallback for non-monorepo)
    let current = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === "win32" && current.startsWith("/")) {
        current = current.slice(1);
    }

    let firstPkgDir: string | null = null;
    let workspaceRoot: string | null = null;

    for (let i = 0; i < 10; i++) {
        if (existsSync(path.join(current, "package.json"))) {
            if (!firstPkgDir) firstPkgDir = current;

            // Check for workspaces field (monorepo root indicator)
            if (!workspaceRoot) {
                try {
                    const pkg = JSON.parse(readFileSync(path.join(current, "package.json"), "utf-8"));
                    if (pkg.workspaces) workspaceRoot = current;
                } catch { /* ignore parse errors */ }
            }
        }

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    // Use best candidate: workspace root > first package.json
    const root = workspaceRoot ?? firstPkgDir;
    if (root) {
        const dir = path.join(root, ".versatile");
        versatileDir = ensureDir(dir);
        return versatileDir;
    }

    versatileDir = ""; // empty string = not found, cached
    return null;
}

/** Ensure .versatile/ directory exists, create with templates if missing. */
function ensureDir(dir: string): string {
    if (!existsSync(dir)) {
        try {
            mkdirSync(dir, {recursive: true});
            console.error(`[config] Created ${dir}/`);
            // Generate all template files
            for (const [filename, template] of Object.entries(TEMPLATES)) {
                const filePath = path.join(dir, filename);
                writeFileSync(filePath, JSON.stringify(template, null, 2) + "\n", "utf-8");
                console.error(`[config] Generated template: ${filename}`);
            }
        } catch (err) {
            console.error(`[config] Failed to create ${dir}:`, err);
        }
    }
    return dir;
}

/**
 * Load a JSON config file from .versatile/ directory.
 * Returns Partial<T> — missing file gets auto-generated from template.
 * Config values take priority; caller should fallback to process.env.
 */
export function loadConfig<T>(filename: string): Partial<T> {
    const dir = resolveVersatileDir();
    if (!dir) return {};

    const filePath = path.join(dir, filename);

    // Auto-generate missing file from template
    if (!existsSync(filePath)) {
        const template = TEMPLATES[filename];
        if (template) {
            try {
                writeFileSync(filePath, JSON.stringify(template, null, 2) + "\n", "utf-8");
                console.error(`[config] Generated template: ${filename} — please edit with your settings.`);
            } catch { /* ignore write errors */ }
        }
        return {};
    }

    try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<T>;

        // Warn if placeholder API key detected
        const obj = parsed as Record<string, unknown>;
        if (obj.apiKey === PLACEHOLDER_KEY) {
            console.error(`[config] WARNING: ${filename} still has placeholder API key. Please edit .versatile/${filename} with your real key.`);
            delete obj.apiKey; // Don't use placeholder as actual key
        }

        return parsed;
    } catch (err) {
        console.error(`[config] Failed to parse ${filePath}:`, err);
        return {};
    }
}

/**
 * Helper: get a config value with env fallback.
 * Priority: config file value > env var > defaultValue.
 */
export function configValue<T>(configVal: T | undefined, envName: string, defaultVal: T): T {
    if (configVal !== undefined) return configVal;
    const envVal = process.env[envName];
    if (envVal !== undefined) {
        // Coerce env string to target type based on defaultVal type
        if (typeof defaultVal === "number") return Number(envVal) as T;
        if (typeof defaultVal === "boolean") return (envVal === "true") as T;
        return envVal as T;
    }
    return defaultVal;
}

/**
 * Helper: get a required config value (apiKey, etc). Throws if missing.
 */
export function configRequired(configVal: string | undefined, envName: string, label: string): string {
    if (configVal) return configVal;
    const envVal = process.env[envName];
    if (envVal) return envVal;
    throw new Error(`${label} is not configured. Set it in .versatile/ config or ${envName} env var.`);
}
