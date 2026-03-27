import type {AgentToolDef, AgentToolResult} from "../../types.js";

export const planTool: AgentToolDef = {
    name: "plan",
    description: "Output your execution plan before starting work. Call this FIRST before any other tool. Estimate how many steps you'll need and describe your approach.",
    parameters: {
        estimated_steps: {type: "number", description: "Estimated number of tool calls needed to complete the task", required: true},
        plan: {type: "string", description: "Brief description of your planned approach", required: true},
    },
    metadata: {category: "core", skipRepetitionCheck: true},
    execute: async (args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> => {
        const estimatedSteps = Number(args.estimated_steps ?? 10);
        const planText = String(args.plan ?? "");
        const output = JSON.stringify({estimated_steps: estimatedSteps, plan: planText});
        return {success: true, output, charCount: output.length};
    },
};
