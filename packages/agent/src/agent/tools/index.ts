export {ToolRegistry} from "./registry.js";
export {registerCoreTools, planTool, doneTool} from "./core/index.js";
export {registerFilesystemTools, readFileTool, listDirTool, searchPatternTool} from "./filesystem/index.js";
export {registerGrokTools, createWebSearchTool} from "./grok/index.js";
export {registerCodexTools} from "./codex/index.js";

import {ToolRegistry} from "./registry.js";
import {registerCoreTools} from "./core/index.js";
import {registerFilesystemTools} from "./filesystem/index.js";
import {registerGrokTools} from "./grok/index.js";
import {registerCodexTools} from "./codex/index.js";

/**
 * Create a ToolRegistry with all built-in tools + conditional provider tools.
 * This is the primary entry point for Worker to get a ready-to-use registry.
 *
 * - Core tools (plan, done): always registered
 * - Filesystem tools (read_file, list_dir, search_pattern): always registered
 * - Grok tools (web_search): registered if GROK_API_KEY is available
 * - Codex tools: registered if OPENAI_API_KEY is available (reserved for future)
 */
export function createBuiltinRegistry(env: Record<string, string>): ToolRegistry {
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    registerFilesystemTools(registry);
    registerGrokTools(registry, env);
    registerCodexTools(registry, env);
    return registry;
}
