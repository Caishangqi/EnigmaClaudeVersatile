import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {AgentToolDef, AgentToolResult} from "../../types.js";
import {resolveSafePath, MAX_DIR_ENTRIES, IGNORED_DIRS} from "./_utils.js";

export const listDirTool: AgentToolDef = {
    name: "list_dir",
    description: "List directory contents.",
    parameters: {
        path: {type: "string", description: "Directory path relative to working directory", required: true},
        recursive: {type: "boolean", description: "Recurse into subdirectories (default: false)", required: false},
        maxDepth: {type: "number", description: "Max recursion depth (default: 3)", required: false},
    },
    metadata: {category: "filesystem"},
    execute: listDir,
};

async function listDir(args: Record<string, unknown>, workingDir: string): Promise<AgentToolResult> {
    const dirPath = String(args.path ?? ".");
    const recursive = Boolean(args.recursive ?? false);
    const maxDepth = Number(args.maxDepth ?? 3);

    try {
        const resolved = resolveSafePath(workingDir, dirPath);
        const entries: string[] = [];

        async function walk(dir: string, prefix: string, depth: number): Promise<void> {
            if (entries.length >= MAX_DIR_ENTRIES) return;
            const items = await fs.readdir(dir, {withFileTypes: true});
            items.sort((a, b) => a.name.localeCompare(b.name));

            for (const item of items) {
                if (entries.length >= MAX_DIR_ENTRIES) break;
                if (IGNORED_DIRS.has(item.name)) continue;

                const isDir = item.isDirectory();
                entries.push(`${prefix}${isDir ? item.name + "/" : item.name}`);

                if (isDir && recursive && depth < maxDepth) {
                    await walk(path.join(dir, item.name), prefix + "  ", depth + 1);
                }
            }
        }

        await walk(resolved, "", 0);
        const truncated = entries.length >= MAX_DIR_ENTRIES ? `\n[truncated at ${MAX_DIR_ENTRIES} entries]` : "";
        const output = entries.join("\n") + truncated;
        return {success: true, output: output || "(empty directory)", charCount: output.length};
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {success: false, output: `Error listing directory: ${msg}`, charCount: 0};
    }
}
