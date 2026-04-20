import type {ToolRegistry} from "../registry.js";
import {createTavilyWebSearchTool} from "./web-search.js";

export {createTavilyWebSearchTool} from "./web-search.js";

/** Register Tavily-powered tools (web_search_tavily). Requires TAVILY_API_KEY in env. */
export function registerTavilyTools(registry: ToolRegistry, env: Record<string, string>): void {
    const webSearch = createTavilyWebSearchTool(env);
    if (webSearch) registry.register(webSearch);
}
