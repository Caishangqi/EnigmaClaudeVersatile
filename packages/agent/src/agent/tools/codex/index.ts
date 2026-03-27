import type {ToolRegistry} from "../registry.js";

/** Register Codex/OpenAI-powered tools. Requires OPENAI_API_KEY in env. Reserved for future tools. */
export function registerCodexTools(_registry: ToolRegistry, _env: Record<string, string>): void {
    // Future: register codex-specific tools here (e.g., analyze_image)
}
