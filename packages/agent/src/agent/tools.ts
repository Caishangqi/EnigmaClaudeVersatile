import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {AgentToolDef, AgentToolName, AgentToolResult, AgentToolParamDef} from "./types.js";

const MAX_FILE_SIZE = 100 * 1024; // 100 KB
const MAX_DIR_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 20;
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".idea", ".vscode", "__pycache__"]);

// ============================================================
// Path Safety
// ============================================================

/** Resolve a user-provided path within workingDir, preventing directory traversal. */
function resolveSafePath(workingDir: string, userPath: string): string {
    const resolved = path.resolve(workingDir, userPath);
    const normalizedBase = path.resolve(workingDir);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
        throw new Error(`Path escapes working directory: ${userPath}`);
    }
    return resolved;
}

// ============================================================
// Tool Implementations
// ============================================================

async function readFile(args: Record<string, unknown>, workingDir: string): Promise<AgentToolResult> {
    const filePath = String(args.path ?? "");
    if (!filePath) return {success: false, output: "Error: 'path' parameter is required.", charCount: 0};

    try {
        const resolved = resolveSafePath(workingDir, filePath);
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) return {success: false, output: `Error: Not a file: ${filePath}`, charCount: 0};
        if (stat.size > MAX_FILE_SIZE) {
            // Read partial if too large
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
            // Fall back to literal substring match
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
                    await searchFile(fullPath, dir);
                }
            }
        }

        async function searchFile(filePath: string, _dir: string): Promise<void> {
            try {
                // Skip binary files by checking first 512 bytes
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
            await searchFile(resolved, path.dirname(resolved));
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

async function plan(args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> {
    const estimatedSteps = Number(args.estimated_steps ?? 10);
    const planText = String(args.plan ?? "");
    const output = JSON.stringify({estimated_steps: estimatedSteps, plan: planText});
    return {success: true, output, charCount: output.length};
}

async function done(args: Record<string, unknown>, _workingDir: string): Promise<AgentToolResult> {
    const summary = String(args.summary ?? "");
    const answer = String(args.answer ?? "");
    const output = JSON.stringify({summary, answer});
    return {success: true, output, charCount: output.length};
}

// ============================================================
// Tool Registry
// ============================================================

const TOOL_DEFS: AgentToolDef[] = [
    {
        name: "read_file",
        description: "Read a file's content. Returns numbered lines.",
        parameters: {
            path: {type: "string", description: "File path relative to working directory", required: true},
            startLine: {type: "number", description: "Start line (1-based, optional)", required: false},
            endLine: {type: "number", description: "End line (inclusive, optional)", required: false},
        },
        execute: readFile,
    },
    {
        name: "list_dir",
        description: "List directory contents.",
        parameters: {
            path: {type: "string", description: "Directory path relative to working directory", required: true},
            recursive: {type: "boolean", description: "Recurse into subdirectories (default: false)", required: false},
            maxDepth: {type: "number", description: "Max recursion depth (default: 3)", required: false},
        },
        execute: listDir,
    },
    {
        name: "search_pattern",
        description: "Search for a regex pattern in files. Returns matching lines with file paths.",
        parameters: {
            pattern: {type: "string", description: "Regex pattern to search for", required: true},
            path: {type: "string", description: "Directory or file to search in (default: '.')", required: false},
            maxResults: {type: "number", description: "Max results to return (default: 20)", required: false},
        },
        execute: searchPattern,
    },
    {
        name: "plan",
        description: "Output your execution plan before starting work. Call this FIRST before any other tool. Estimate how many steps you'll need and describe your approach.",
        parameters: {
            estimated_steps: {type: "number", description: "Estimated number of tool calls needed to complete the task", required: true},
            plan: {type: "string", description: "Brief description of your planned approach", required: true},
        },
        execute: plan,
    },
    {
        name: "done",
        description: "Signal task completion. Call this when you have enough information to answer.",
        parameters: {
            summary: {type: "string", description: "Brief summary of findings", required: true},
            answer: {type: "string", description: "Detailed answer/analysis", required: true},
        },
        execute: done,
    },
];

/** Get tool definitions as a Map, filtered by enabled tools. */
export function getToolDefs(enabledTools?: AgentToolName[]): Map<AgentToolName, AgentToolDef> {
    const map = new Map<AgentToolName, AgentToolDef>();
    for (const def of TOOL_DEFS) {
        if (!enabledTools || enabledTools.includes(def.name)) {
            map.set(def.name, def);
        }
    }
    return map;
}

/** Generate tool descriptions for the LLM system prompt. */
export function getToolDescriptions(enabledTools: AgentToolName[]): string {
    const defs = getToolDefs(enabledTools);
    const parts: string[] = [];
    for (const def of defs.values()) {
        const params = Object.entries(def.parameters)
            .map(([name, p]) => `  - ${name} (${p.type}${p.required ? ", required" : ", optional"}): ${p.description}`)
            .join("\n");
        parts.push(`### ${def.name}\n${def.description}\nParameters:\n${params}`);
    }
    return parts.join("\n\n");
}
