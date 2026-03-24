import {readFileSync, existsSync, mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";

// ============================================================
// Config Interfaces
// ============================================================

export interface CodexProviderConfig {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    timeout: number;
    maxRetries: number;
}

export interface GrokProviderConfig {
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
    timeout: number;
    maxRetries: number;
}

export interface TavilyProviderConfig {
    apiKey: string;
    maxResults: number;
    searchDepth: string;
}

export interface AgentBehaviorConfig {
    defaultModel: string;
    maxIterations: number;
    maxTimeMs: number;
    singleCallTimeout: number;
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
        maxResults: 10,
        searchDepth: "advanced",
    },
    "agent.json": {
        defaultModel: "gpt-4o",
        maxIterations: 20,
        maxTimeMs: 300000,
        singleCallTimeout: 120000,
    },
};

export const PLACEHOLDER_KEY = "YOUR_API_KEY_HERE";

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

    // 2. Walk up from this file's directory to find project root (where package.json lives)
    let current = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === "win32" && current.startsWith("/")) {
        current = current.slice(1);
    }

    for (let i = 0; i < 5; i++) {
        // Found project root if package.json exists here
        if (existsSync(path.join(current, "package.json"))) {
            const dir = path.join(current, ".versatile");
            versatileDir = ensureDir(dir);
            return versatileDir;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
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
