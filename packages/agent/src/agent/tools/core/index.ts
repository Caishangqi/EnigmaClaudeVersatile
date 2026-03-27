import type {ToolRegistry} from "../registry.js";
import {planTool} from "./plan.js";
import {doneTool} from "./done.js";

export {planTool} from "./plan.js";
export {doneTool} from "./done.js";

/** Register core Agent control-flow tools (plan, done). Always available. */
export function registerCoreTools(registry: ToolRegistry): void {
    registry.register(planTool);
    registry.register(doneTool);
}
