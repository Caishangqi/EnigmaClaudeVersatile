import {describe, it, expect} from "vitest";
import {mapErrorToResponse, OpenAIErrorMapper} from "../packages/lib/src/errors.js";
import {NoChoicesError} from "../packages/lib/src/completion.js";
import OpenAI from "openai";

const ctx = {serviceName: "TestService", model: "test-model"};

describe("mapErrorToResponse", () => {
    it("handles NoChoicesError", () => {
        const res = mapErrorToResponse(new NoChoicesError(), ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("no choices");
    });

    it("handles AbortError (timeout)", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("timed out");
    });

    it("handles missing API key error", () => {
        const err = new Error("API key is not set");
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("missing TestService API key");
    });

    it("handles 401 API error", () => {
        const err = new OpenAI.APIError(401, {message: "Unauthorized"}, "Unauthorized", {});
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("Invalid or missing TestService API key");
    });

    it("handles 404 API error with model name", () => {
        const err = new OpenAI.APIError(404, {message: "Not found"}, "Not found", {});
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("Model not found");
        expect(res.content[0].text).toContain("test-model");
    });

    it("handles 429 rate limit", () => {
        const err = new OpenAI.APIError(429, {message: "Rate limited"}, "Rate limited", {});
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("rate limit");
    });

    it("handles 500+ server errors", () => {
        const err = new OpenAI.APIError(502, {message: "Bad gateway"}, "Bad gateway", {});
        const res = mapErrorToResponse(err, ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("temporarily unavailable");
    });

    it("handles unknown errors", () => {
        const res = mapErrorToResponse("something broke", ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("something broke");
    });
});

// ============================================================
// OpenAIErrorMapper (class-based)
// ============================================================

describe("OpenAIErrorMapper", () => {
    const mapper = new OpenAIErrorMapper();

    it("implements ErrorMapper interface", () => {
        expect(typeof mapper.mapError).toBe("function");
    });

    it("produces same results as legacy mapErrorToResponse", () => {
        const err = new OpenAI.APIError(429, {message: "Rate limited"}, "Rate limited", {});
        const legacy = mapErrorToResponse(err, ctx);
        const classed = mapper.mapError(err, ctx);
        expect(classed).toEqual(legacy);
    });

    it("handles NoChoicesError", () => {
        const res = mapper.mapError(new NoChoicesError(), ctx);
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain("no choices");
    });
});

// ============================================================
// Custom ErrorMapper implementation
// ============================================================

describe("Custom ErrorMapper", () => {
    it("can implement ErrorMapper interface for custom providers", () => {
        const customMapper = {
            mapError(error: unknown, ctx: {serviceName: string}) {
                const msg = error instanceof Error ? error.message : String(error);
                return {content: [{type: "text" as const, text: `[${ctx.serviceName}] ${msg}`}], isError: true};
            },
        };

        const res = customMapper.mapError(new Error("custom error"), {serviceName: "Tavily"});
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toBe("[Tavily] custom error");
    });
});
