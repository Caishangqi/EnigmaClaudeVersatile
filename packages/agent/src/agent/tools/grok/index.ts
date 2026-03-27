import type {ToolRegistry} from "../registry.js";
import {createWebSearchTool} from "./web-search.js";

export {createWebSearchTool} from "./web-search.js";

/** Register Grok-powered tools (web_search). Requires GROK_API_KEY in env. */
export function registerGrokTools(registry: ToolRegistry, env: Record<string, string>): void {
    const webSearch = createWebSearchTool(env);
    if (webSearch) registry.register(webSearch);
}
