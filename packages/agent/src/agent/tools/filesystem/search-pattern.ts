import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {AgentToolDef, AgentToolResult} from "../../types.js";
import {resolveSafePath, MAX_SEARCH_RESULTS, IGNORED_DIRS} from "./_utils.js";

export const searchPatternTool: AgentToolDef = {
    name: "search_pattern",
    description: "Search for a regex pattern in files. Returns matching lines with file paths.",
    parameters: {
        pattern: {type: "string", description: "Regex pattern to search for", required: true},
        path: {type: "string", description: "Directory or file to search in (default: '.')", required: false},
        maxResults: {type: "number", description: "Max results to return (default: 20)", required: false},
    },
    metadata: {category: "filesystem"},
    execute: searchPattern,
};

async function searchPattern(args: Record<string, unknown>, workingDir: string): Promise<AgentToolResult> {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return {success: false, output: "Error: 'pattern' parameter is required.", charCount: 0};

    const searchPath = String(args.path ?? ".");
    const maxResults = Number(args.maxResults ?? MAX_SEARCH_RESULTS);

    try {
        const resolved = resolveSafePath(workingDir, searchPath);
        const matches: string[] = [];
        let regex: RegExp;
        try {
            regex = new RegExp(pattern, "i");
        } catch {
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }

        async function search(dir: string): Promise<void> {
            if (matches.length >= maxResults) return;
            const items = await fs.readdir(dir, {withFileTypes: true});

            for (const item of items) {
                if (matches.length >= maxResults) break;
                if (IGNORED_DIRS.has(item.name)) continue;
                const fullPath = path.join(dir, item.name);

                if (item.isDirectory()) {
                    await search(fullPath);
                } else if (item.isFile()) {
                    await searchFile(fullPath);
                }
            }
        }

        async function searchFile(filePath: string): Promise<void> {
            try {
                const handle = await fs.open(filePath, "r");
                const buf = Buffer.alloc(512);
                const {bytesRead} = await handle.read(buf, 0, 512, 0);
                await handle.close();
                if (buf.subarray(0, bytesRead).includes(0)) return;

                const content = await fs.readFile(filePath, "utf-8");
                const lines = content.split("\n");
                const relPath = path.relative(workingDir, filePath);

                for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                    if (regex.test(lines[i])) {
                        matches.push(`${relPath}:${i + 1}: ${lines[i].trimEnd()}`);
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }

        const stat = await fs.stat(resolved);
        if (stat.isFile()) {
            await searchFile(resolved);
        } else {
            await search(resolved);
        }

        const truncated = matches.length >= maxResults ? `\n[truncated at ${maxResults} results]` : "";
        const output = matches.length > 0
            ? matches.join("\n") + truncated
            : `No matches found for: ${pattern}`;
        return {success: true, output, charCount: output.length};
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {success: false, output: `Error searching: ${msg}`, charCount: 0};
    }
}
