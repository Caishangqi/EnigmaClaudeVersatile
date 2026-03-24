import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {configValue, configRequired, TEMPLATES, PLACEHOLDER_KEY} from "../packages/lib/src/config.js";
import type {BaseProviderConfig, CodexProviderConfig, GrokProviderConfig} from "../packages/lib/src/config.js";

// ============================================================
// configValue
// ============================================================

describe("configValue", () => {
    const ENV_KEY = "__TEST_CONFIG_VALUE__";

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it("returns config value when present", () => {
        expect(configValue("from-config", ENV_KEY, "default")).toBe("from-config");
    });

    it("falls back to env when config is undefined", () => {
        process.env[ENV_KEY] = "from-env";
        expect(configValue(undefined, ENV_KEY, "default")).toBe("from-env");
    });

    it("falls back to default when both config and env are undefined", () => {
        expect(configValue(undefined, ENV_KEY, "default")).toBe("default");
    });

    it("coerces env string to number when default is number", () => {
        process.env[ENV_KEY] = "42";
        expect(configValue(undefined, ENV_KEY, 0)).toBe(42);
    });

    it("coerces env string to boolean when default is boolean", () => {
        process.env[ENV_KEY] = "true";
        expect(configValue(undefined, ENV_KEY, false)).toBe(true);
    });

    it("prefers config over env even when env is set", () => {
        process.env[ENV_KEY] = "from-env";
        expect(configValue("from-config", ENV_KEY, "default")).toBe("from-config");
    });
});

// ============================================================
// configRequired
// ============================================================

describe("configRequired", () => {
    const ENV_KEY = "__TEST_CONFIG_REQUIRED__";

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it("returns config value when present", () => {
        expect(configRequired("my-key", ENV_KEY, "API Key")).toBe("my-key");
    });

    it("falls back to env when config is undefined", () => {
        process.env[ENV_KEY] = "env-key";
        expect(configRequired(undefined, ENV_KEY, "API Key")).toBe("env-key");
    });

    it("throws when both config and env are missing", () => {
        expect(() => configRequired(undefined, ENV_KEY, "API Key")).toThrow("API Key is not configured");
    });

    it("throws when config is empty string", () => {
        expect(() => configRequired("", ENV_KEY, "API Key")).toThrow("API Key is not configured");
    });
});

// ============================================================
// TEMPLATES
// ============================================================

describe("TEMPLATES", () => {
    it("contains all expected config files", () => {
        expect(Object.keys(TEMPLATES)).toContain("codex.agent.json");
        expect(Object.keys(TEMPLATES)).toContain("grok.agent.json");
        expect(Object.keys(TEMPLATES)).toContain("agent.json");
    });

    it("codex template has required fields", () => {
        const t = TEMPLATES["codex.agent.json"] as Record<string, unknown>;
        expect(t.apiKey).toBe(PLACEHOLDER_KEY);
        expect(t.baseUrl).toBeDefined();
        expect(t.defaultModel).toBeDefined();
        expect(t.timeout).toBeTypeOf("number");
    });

    it("agent template has required fields", () => {
        const t = TEMPLATES["agent.json"] as Record<string, unknown>;
        expect(t.defaultModel).toBeDefined();
        expect(t.maxIterations).toBeTypeOf("number");
        expect(t.maxTimeMs).toBeTypeOf("number");
        expect(t.singleCallTimeout).toBeTypeOf("number");
    });
});

// ============================================================
// BaseProviderConfig inheritance
// ============================================================

describe("BaseProviderConfig", () => {
    it("CodexProviderConfig extends BaseProviderConfig", () => {
        // Type-level check: CodexProviderConfig is assignable to BaseProviderConfig
        const codex: CodexProviderConfig = {
            apiKey: "key", baseUrl: "url", defaultModel: "gpt-4o", timeout: 60000, maxRetries: 3,
        };
        const base: BaseProviderConfig = codex;
        expect(base.apiKey).toBe("key");
    });

    it("GrokProviderConfig extends BaseProviderConfig", () => {
        const grok: GrokProviderConfig = {
            apiKey: "key", baseUrl: "url", defaultModel: "grok-4", timeout: 60000, maxRetries: 3,
        };
        const base: BaseProviderConfig = grok;
        expect(base.defaultModel).toBe("grok-4");
    });

    it("custom provider can extend BaseProviderConfig with extra fields", () => {
        interface TavilyProviderConfig extends BaseProviderConfig {
            maxResults?: number;
            searchDepth?: string;
        }
        const tavily: TavilyProviderConfig = {
            apiKey: "key", baseUrl: "url", defaultModel: "tavily", timeout: 30000, maxRetries: 2,
            maxResults: 10, searchDepth: "advanced",
        };
        const base: BaseProviderConfig = tavily;
        expect(base.apiKey).toBe("key");
        expect(tavily.maxResults).toBe(10);
    });
});
