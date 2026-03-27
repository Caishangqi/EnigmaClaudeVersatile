import type {AgentToolDef} from "../types.js";

/**
 * Registry for Agent tools. Supports registration, lookup, and filtering.
 * Tools are stored by name; re-registering overwrites the previous definition.
 */
export class ToolRegistry {
    private tools = new Map<string, AgentToolDef>();

    /** Register a single tool. Overwrites if name already exists. */
    register(tool: AgentToolDef): this {
        this.tools.set(tool.name, tool);
        return this;
    }

    /** Register multiple tools. */
    registerAll(tools: AgentToolDef[]): this {
        for (const t of tools) this.register(t);
        return this;
    }

    /** Get a tool by name. */
    get(name: string): AgentToolDef | undefined {
        return this.tools.get(name);
    }

    /** Check if a tool exists. */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /** Get a filtered Map of enabled tools. If enabledNames is omitted, returns all. */
    getEnabled(enabledNames?: string[]): Map<string, AgentToolDef> {
        if (!enabledNames) return new Map(this.tools);
        const map = new Map<string, AgentToolDef>();
        for (const name of enabledNames) {
            const tool = this.tools.get(name);
            if (tool) map.set(name, tool);
        }
        return map;
    }

    /** All registered tool names. */
    names(): string[] {
        return [...this.tools.keys()];
    }

    /** Iterate all tools. */
    values(): IterableIterator<AgentToolDef> {
        return this.tools.values();
    }
}
