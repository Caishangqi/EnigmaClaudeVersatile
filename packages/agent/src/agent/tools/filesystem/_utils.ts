import * as path from "node:path";

export const MAX_FILE_SIZE = 100 * 1024; // 100 KB
export const MAX_DIR_ENTRIES = 200;
export const MAX_SEARCH_RESULTS = 20;
export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".idea", ".vscode", "__pycache__"]);

/** Resolve a user-provided path within workingDir, preventing directory traversal. */
export function resolveSafePath(workingDir: string, userPath: string): string {
    const resolved = path.resolve(workingDir, userPath);
    const normalizedBase = path.resolve(workingDir);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
        throw new Error(`Path escapes working directory: ${userPath}`);
    }
    return resolved;
}
