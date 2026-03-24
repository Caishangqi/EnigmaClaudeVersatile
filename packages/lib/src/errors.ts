import OpenAI from "openai";
import type {ToolResponse, ErrorContext} from "./types.js";
import {NoChoicesError} from "./completion.js";

/**
 * Maps any error from executeCompletion into an MCP ToolResponse.
 */
export function mapErrorToResponse(error: unknown, ctx: ErrorContext): ToolResponse {
    if (error instanceof NoChoicesError) {
        return errorResponse(`Error: ${ctx.serviceName} returned no choices.`);
    }

    if (error instanceof Error && error.name === "AbortError") {
        return errorResponse(`Error: ${ctx.serviceName} request timed out.`);
    }

    if (error instanceof Error && error.message.includes("is not set")) {
        return errorResponse(`Error: Invalid or missing ${ctx.serviceName} API key.`);
    }

    if (error instanceof OpenAI.APIError) {
        return errorResponse(mapApiStatus(error, ctx));
    }

    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected ${ctx.serviceName} error:`, error);
    return errorResponse(`Unexpected error: ${msg}`);
}

function mapApiStatus(error: InstanceType<typeof OpenAI.APIError>, ctx: ErrorContext): string {
    const s = ctx.serviceName;
    switch (error.status) {
        case 400:
            return `Error: Invalid request: ${error.message}`;
        case 401:
            return `Error: Invalid or missing ${s} API key.`;
        case 403:
            return `Error: ${s} request forbidden.`;
        case 404:
            return `Error: Model not found${ctx.model ? `: ${ctx.model}` : ""}.`;
        case 408:
            return `Error: ${s} API request timed out.`;
        case 429:
            return `Error: ${s} rate limit exceeded. Please wait and retry.`;
        default:
            if (error.status !== undefined && error.status >= 500) {
                return `Error: ${s} service is temporarily unavailable.`;
            }
            return `${s} API Error (${error.status}): ${error.message}`;
    }
}

function errorResponse(text: string): ToolResponse {
    return {content: [{type: "text", text}], isError: true};
}
