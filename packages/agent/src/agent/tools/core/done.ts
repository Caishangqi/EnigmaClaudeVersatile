import type {AgentToolDef, AgentToolResult} from "../../types.js";

export const doneTool: AgentToolDef = {
    name: "done",
    description: "Signal task completion. Call this when you have enough information to answer.",
    parameters: {
        summary: {type: "string", description: "Brief summary of findings", required: true},
        answer: {type: "string", description: "Detailed answer/analysis", required: true},
    },
    metadata: {category: "core", skipRepetitionCheck: true},
    execute: async (args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> => {
        const summary = String(args.summary ?? "");
        const answer = String(args.answer ?? "");
        const output = JSON.stringify({summary, answer});
        return {success: true, output, charCount: output.length};
    },
};
