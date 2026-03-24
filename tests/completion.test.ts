import {describe, it, expect} from "vitest";
import {formatTokens, formatDuration, formatUsageLine, OpenAICompletionProvider} from "../packages/lib/src/completion.js";
import type {CompletionResult, CompletionProvider} from "../packages/lib/src/types.js";

// ============================================================
// formatTokens
// ============================================================

describe("formatTokens", () => {
    it("returns raw number below 1000", () => {
        expect(formatTokens(0)).toBe("0");
        expect(formatTokens(999)).toBe("999");
    });

    it("formats thousands with k suffix", () => {
        expect(formatTokens(1000)).toBe("1.0k");
        expect(formatTokens(1500)).toBe("1.5k");
        expect(formatTokens(12345)).toBe("12.3k");
    });
});

// ============================================================
// formatDuration
// ============================================================

describe("formatDuration", () => {
    it("returns ms for sub-second durations", () => {
        expect(formatDuration(0)).toBe("0ms");
        expect(formatDuration(500)).toBe("500ms");
        expect(formatDuration(999)).toBe("999ms");
    });

    it("returns seconds for >= 1000ms", () => {
        expect(formatDuration(1000)).toBe("1.0s");
        expect(formatDuration(1500)).toBe("1.5s");
        expect(formatDuration(65000)).toBe("65.0s");
    });
});

// ============================================================
// formatUsageLine
// ============================================================

describe("formatUsageLine", () => {
    it("returns empty string when no usage", () => {
        const result: CompletionResult = {content: "hello", model: "gpt-4o"};
        expect(formatUsageLine(result)).toBe("");
    });

    it("formats usage with model and token counts", () => {
        const result: CompletionResult = {
            content: "hello",
            model: "gpt-5.4",
            usage: {promptTokens: 1200, completionTokens: 800, totalTokens: 2000},
        };
        const line = formatUsageLine(result);
        expect(line).toContain("gpt-5.4");
        expect(line).toContain("1.2k in");
        expect(line).toContain("800 out");
        expect(line).toContain("2.0k tokens");
    });

    it("starts with double newline", () => {
        const result: CompletionResult = {
            content: "x",
            model: "m",
            usage: {promptTokens: 10, completionTokens: 5, totalTokens: 15},
        };
        expect(formatUsageLine(result)).toMatch(/^\n\n/);
    });
});

// ============================================================
// OpenAICompletionProvider
// ============================================================

describe("OpenAICompletionProvider", () => {
    it("implements CompletionProvider interface", () => {
        // Type-level check: OpenAICompletionProvider satisfies CompletionProvider
        const mockClient = {} as any;
        const provider: CompletionProvider = new OpenAICompletionProvider(mockClient);
        expect(typeof provider.complete).toBe("function");
    });
});

// ============================================================
// Custom CompletionProvider implementation
// ============================================================

describe("Custom CompletionProvider", () => {
    it("can implement CompletionProvider interface for custom providers", async () => {
        const customProvider: CompletionProvider = {
            async complete(request) {
                return {
                    content: `Echo: ${request.messages[0]?.content}`,
                    model: request.model,
                    usage: {promptTokens: 10, completionTokens: 5, totalTokens: 15},
                };
            },
        };

        const result = await customProvider.complete({
            model: "tavily-search",
            messages: [{role: "user", content: "test query"}],
        });
        expect(result.content).toBe("Echo: test query");
        expect(result.model).toBe("tavily-search");
        expect(result.usage?.totalTokens).toBe(15);
    });
});
