import {describe, it, expect, vi, beforeEach} from "vitest";

// Mock bootstrap module before importing provider
vi.mock("../packages/lib/src/bootstrap.js", () => ({
    createServer: vi.fn(() => ({tool: vi.fn()})),
    startServer: vi.fn(async () => {}),
    runServer: vi.fn((fn: () => Promise<void>) => fn()),
}));

// Mock client module
vi.mock("../packages/lib/src/client.js", () => ({
    createClientFactory: vi.fn(() => vi.fn(() => ({}))),
}));

// Mock completion module
vi.mock("../packages/lib/src/completion.js", () => ({
    executeCompletion: vi.fn(async () => ({
        content: "mock response",
        model: "test-model",
        usage: {promptTokens: 10, completionTokens: 5, totalTokens: 15},
    })),
    formatUsageLine: vi.fn(() => "\n\n[test-model · 10 in + 5 out = 15 tokens]"),
}));

// Mock errors module
vi.mock("../packages/lib/src/errors.js", () => ({
    mapErrorToResponse: vi.fn((_err: unknown, ctx: {serviceName: string}) => ({
        content: [{type: "text", text: `${ctx.serviceName} error`}],
        isError: true,
    })),
}));

// Mock config module
vi.mock("../packages/lib/src/config.js", () => ({
    loadConfig: vi.fn(() => ({apiKey: "test-key", baseUrl: "https://test.api/v1", defaultModel: "test-model", timeout: 30000, maxRetries: 2})),
    configValue: vi.fn((_cfgVal: unknown, _envName: string, defaultVal: unknown) => defaultVal),
    configRequired: vi.fn((val: string | undefined, _envName: string, label: string) => {
        if (val) return val;
        throw new Error(`${label} is not configured`);
    }),
}));

import {defineProvider} from "../packages/lib/src/provider.js";
import type {OpenAIProviderDescriptor, NativeProviderDescriptor} from "../packages/lib/src/provider.js";
import {createServer, startServer, runServer} from "../packages/lib/src/bootstrap.js";
import {createClientFactory} from "../packages/lib/src/client.js";
import {loadConfig, configValue} from "../packages/lib/src/config.js";
import {executeCompletion} from "../packages/lib/src/completion.js";

// ============================================================
// OpenAI-compatible provider lifecycle
// ============================================================

describe("defineProvider (openai type)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clean env vars that may be injected
        delete process.env.TEST_API_KEY;
        delete process.env.TEST_BASE_URL;
    });

    function makeOpenAIDescriptor(overrides?: Partial<OpenAIProviderDescriptor>): OpenAIProviderDescriptor {
        return {
            type: "openai",
            name: "test-provider",
            version: "0.1.0",
            serverLabel: "Test MCP Server",
            configFile: "test.agent.json",
            envPrefix: "TEST",
            modelEnv: "TEST_DEFAULT_MODEL",
            timeoutEnv: "TEST_REQUEST_TIMEOUT",
            defaults: {model: "test-model", timeout: 60_000},
            serviceName: "TestService",
            hooks: {
                onRegisterTools: vi.fn(),
            },
            ...overrides,
        };
    }

    it("executes lifecycle in order: loadConfig → createClient → registerTools → serverReady", () => {
        const desc = makeOpenAIDescriptor();
        defineProvider(desc);

        expect(loadConfig).toHaveBeenCalledWith("test.agent.json");
        expect(createClientFactory).toHaveBeenCalled();
        expect(desc.hooks.onRegisterTools).toHaveBeenCalled();
        expect(runServer).toHaveBeenCalled();
    });

    it("creates server with correct name and version", () => {
        defineProvider(makeOpenAIDescriptor());

        expect(createServer).toHaveBeenCalledWith({
            name: "claude-versatile-test-provider",
            version: "0.1.0",
        });
    });

    it("passes McpServer and OpenAIProviderContext to onRegisterTools", () => {
        const onRegisterTools = vi.fn();
        defineProvider(makeOpenAIDescriptor({hooks: {onRegisterTools}}));

        expect(onRegisterTools).toHaveBeenCalledTimes(1);
        const [server, ctx] = onRegisterTools.mock.calls[0];
        expect(server).toBeDefined();
        expect(server.tool).toBeDefined();
        expect(ctx.defaultModel).toBe("test-model");
        expect(ctx.requestTimeout).toBe(60_000);
        expect(ctx.serviceName).toBe("TestService");
        expect(typeof ctx.complete).toBe("function");
        expect(typeof ctx.getClient).toBe("function");
    });

    it("injects config apiKey and baseUrl into process.env", () => {
        defineProvider(makeOpenAIDescriptor());

        // loadConfig mock returns apiKey: "test-key", baseUrl: "https://test.api/v1"
        expect(process.env.TEST_API_KEY).toBe("test-key");
        expect(process.env.TEST_BASE_URL).toBe("https://test.api/v1");
    });

    it("does not overwrite existing env vars", () => {
        process.env.TEST_API_KEY = "existing-key";
        process.env.TEST_BASE_URL = "https://existing.api/v1";

        defineProvider(makeOpenAIDescriptor());

        expect(process.env.TEST_API_KEY).toBe("existing-key");
        expect(process.env.TEST_BASE_URL).toBe("https://existing.api/v1");
    });

    it("passes defaultBaseUrl to createClientFactory", () => {
        defineProvider(makeOpenAIDescriptor({defaultBaseUrl: "https://custom.api/v1"}));

        expect(createClientFactory).toHaveBeenCalledWith(
            expect.objectContaining({defaultBaseUrl: "https://custom.api/v1"}),
        );
    });

    it("uses custom onLoadConfig hook when provided", () => {
        const customConfig = {apiKey: "custom", defaultModel: "custom-model"};
        const onLoadConfig = vi.fn(() => customConfig);

        defineProvider(makeOpenAIDescriptor({hooks: {onLoadConfig, onRegisterTools: vi.fn()}}));

        expect(onLoadConfig).toHaveBeenCalledWith("test.agent.json");
        expect(loadConfig).not.toHaveBeenCalled();
    });

    it("uses custom onServerReady hook when provided", () => {
        const onServerReady = vi.fn();

        defineProvider(makeOpenAIDescriptor({hooks: {onRegisterTools: vi.fn(), onServerReady}}));

        expect(onServerReady).toHaveBeenCalled();
        expect(runServer).not.toHaveBeenCalled();
    });
});

// ============================================================
// ctx.complete() convenience method
// ============================================================

describe("OpenAIProviderContext.complete()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.CTX_API_KEY;
        delete process.env.CTX_BASE_URL;
    });

    it("returns formatted response on success", async () => {
        let capturedCtx: any;
        defineProvider({
            type: "openai",
            name: "ctx-test",
            version: "0.1.0",
            serverLabel: "Ctx Test",
            configFile: "ctx.agent.json",
            envPrefix: "CTX",
            modelEnv: "CTX_MODEL",
            timeoutEnv: "CTX_TIMEOUT",
            defaults: {model: "m", timeout: 5000},
            serviceName: "CtxService",
            hooks: {
                onRegisterTools(_server, ctx) {
                    capturedCtx = ctx;
                },
            },
        });

        const result = await capturedCtx.complete({model: "m", prompt: "hello"});

        expect(executeCompletion).toHaveBeenCalled();
        expect(result.content[0].text).toContain("mock response");
        expect(result.isError).toBeUndefined();
    });

    it("builds system message when system_prompt provided", async () => {
        let capturedCtx: any;
        defineProvider({
            type: "openai",
            name: "ctx-sys",
            version: "0.1.0",
            serverLabel: "Ctx Sys",
            configFile: "ctx.agent.json",
            envPrefix: "CTX",
            modelEnv: "CTX_MODEL",
            timeoutEnv: "CTX_TIMEOUT",
            defaults: {model: "m", timeout: 5000},
            serviceName: "CtxService",
            hooks: {
                onRegisterTools(_server, ctx) {
                    capturedCtx = ctx;
                },
            },
        });

        await capturedCtx.complete({model: "m", prompt: "hello", system_prompt: "be helpful"});

        const callArgs = (executeCompletion as any).mock.calls[0];
        const request = callArgs[1];
        expect(request.messages).toHaveLength(2);
        expect(request.messages[0]).toEqual({role: "system", content: "be helpful"});
        expect(request.messages[1]).toEqual({role: "user", content: "hello"});
    });

    it("omits system message when system_prompt is undefined", async () => {
        let capturedCtx: any;
        defineProvider({
            type: "openai",
            name: "ctx-nosys",
            version: "0.1.0",
            serverLabel: "Ctx NoSys",
            configFile: "ctx.agent.json",
            envPrefix: "CTX",
            modelEnv: "CTX_MODEL",
            timeoutEnv: "CTX_TIMEOUT",
            defaults: {model: "m", timeout: 5000},
            serviceName: "CtxService",
            hooks: {
                onRegisterTools(_server, ctx) {
                    capturedCtx = ctx;
                },
            },
        });

        await capturedCtx.complete({model: "m", prompt: "hello"});

        const callArgs = (executeCompletion as any).mock.calls[0];
        const request = callArgs[1];
        expect(request.messages).toHaveLength(1);
        expect(request.messages[0]).toEqual({role: "user", content: "hello"});
    });

    it("returns error response when executeCompletion throws", async () => {
        (executeCompletion as any).mockRejectedValueOnce(new Error("API down"));

        let capturedCtx: any;
        defineProvider({
            type: "openai",
            name: "ctx-err",
            version: "0.1.0",
            serverLabel: "Ctx Err",
            configFile: "ctx.agent.json",
            envPrefix: "CTX",
            modelEnv: "CTX_MODEL",
            timeoutEnv: "CTX_TIMEOUT",
            defaults: {model: "m", timeout: 5000},
            serviceName: "ErrService",
            hooks: {
                onRegisterTools(_server, ctx) {
                    capturedCtx = ctx;
                },
            },
        });

        const result = await capturedCtx.complete({model: "m", prompt: "hello"});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("ErrService error");
    });
});

// ============================================================
// Native SDK provider lifecycle
// ============================================================

describe("defineProvider (native type)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("executes lifecycle: loadConfig → onCreateClient → onRegisterTools → serverReady", () => {
        const onCreateClient = vi.fn();
        const onRegisterTools = vi.fn();

        defineProvider({
            type: "native",
            name: "native-test",
            version: "0.1.0",
            serverLabel: "Native Test",
            configFile: "native.agent.json",
            hooks: {onCreateClient, onRegisterTools},
        });

        expect(loadConfig).toHaveBeenCalledWith("native.agent.json");
        expect(onCreateClient).toHaveBeenCalled();
        expect(onRegisterTools).toHaveBeenCalled();
        expect(runServer).toHaveBeenCalled();
    });

    it("does NOT call createClientFactory (no env injection)", () => {
        defineProvider({
            type: "native",
            name: "native-noenv",
            version: "0.1.0",
            serverLabel: "Native NoEnv",
            configFile: "native.agent.json",
            hooks: {
                onCreateClient: vi.fn(),
                onRegisterTools: vi.fn(),
            },
        });

        expect(createClientFactory).not.toHaveBeenCalled();
    });

    it("passes loaded config to onCreateClient", () => {
        const onCreateClient = vi.fn();

        defineProvider({
            type: "native",
            name: "native-cfg",
            version: "0.1.0",
            serverLabel: "Native Cfg",
            configFile: "native.agent.json",
            hooks: {onCreateClient, onRegisterTools: vi.fn()},
        });

        expect(onCreateClient).toHaveBeenCalledWith(
            expect.objectContaining({apiKey: "test-key"}),
        );
    });

    it("passes McpServer (without ctx) to onRegisterTools", () => {
        const onRegisterTools = vi.fn();

        defineProvider({
            type: "native",
            name: "native-tools",
            version: "0.1.0",
            serverLabel: "Native Tools",
            configFile: "native.agent.json",
            hooks: {onCreateClient: vi.fn(), onRegisterTools},
        });

        expect(onRegisterTools).toHaveBeenCalledTimes(1);
        const [server] = onRegisterTools.mock.calls[0];
        expect(server.tool).toBeDefined();
    });

    it("creates server with correct name", () => {
        defineProvider({
            type: "native",
            name: "my-native",
            version: "0.2.0",
            serverLabel: "My Native",
            configFile: "my.agent.json",
            hooks: {onCreateClient: vi.fn(), onRegisterTools: vi.fn()},
        });

        expect(createServer).toHaveBeenCalledWith({
            name: "claude-versatile-my-native",
            version: "0.2.0",
        });
    });
});
