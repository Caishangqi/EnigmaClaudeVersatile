import * as fs from "node:fs/promises";
import type {AgentToolDef, AgentToolResult} from "../../types.js";
import {resolveSafePath, MAX_FILE_SIZE} from "./_utils.js";

export const readFileTool: AgentToolDef = {
    name: "read_file",
    description: "Read a file's content. Returns numbered lines.",
    parameters: {
        path: {type: "string", description: "File path relative to working directory", required: true},
        startLine: {type: "number", description: "Start line (1-based, optional)", required: false},
        endLine: {type: "number", description: "End line (inclusive, optional)", required: false},
    },
    metadata: {category: "filesystem", tracksFileRead: true},
    execute: readFile,
};

async function readFile(args: Record<string, unknown>, workingDir: string): Promise<AgentToolResult> {
    const filePath = String(args.path ?? "");
    if (!filePath) return {success: false, output: "Error: 'path' parameter is required.", charCount: 0};

    try {
        const resolved = resolveSafePath(workingDir, filePath);
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) return {success: false, output: `Error: Not a file: ${filePath}`, charCount: 0};
        if (stat.size > MAX_FILE_SIZE) {
            const content = await fs.readFile(resolved, "utf-8");
            const lines = content.split("\n");
            const startLine = Number(args.startLine ?? 1);
            const endLine = Number(args.endLine ?? Math.min(lines.length, startLine + 200));
            const slice = lines.slice(Math.max(0, startLine - 1), endLine);
            const output = `[File truncated: ${lines.length} lines total, showing ${startLine}-${endLine}]\n` +
                slice.map((l, i) => `${startLine + i}: ${l}`).join("\n");
            return {success: true, output, charCount: output.length};
        }
        const content = await fs.readFile(resolved, "utf-8");
        const lines = content.split("\n");

        if (args.startLine !== undefined || args.endLine !== undefined) {
            const startLine = Number(args.startLine ?? 1);
            const endLine = Number(args.endLine ?? lines.length);
            const slice = lines.slice(Math.max(0, startLine - 1), endLine);
            const output = slice.map((l, i) => `${startLine + i}: ${l}`).join("\n");
            return {success: true, output, charCount: output.length};
        }

        const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
        return {success: true, output: numbered, charCount: numbered.length};
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {success: false, output: `Error reading file: ${msg}`, charCount: 0};
    }
}
