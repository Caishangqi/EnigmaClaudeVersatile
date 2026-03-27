import type {ToolRegistry} from "../registry.js";
import {readFileTool} from "./read-file.js";
import {listDirTool} from "./list-dir.js";
import {searchPatternTool} from "./search-pattern.js";

export {readFileTool} from "./read-file.js";
export {listDirTool} from "./list-dir.js";
export {searchPatternTool} from "./search-pattern.js";

/** Register local filesystem tools (read_file, list_dir, search_pattern). Always available. */
export function registerFilesystemTools(registry: ToolRegistry): void {
    registry.register(readFileTool);
    registry.register(listDirTool);
    registry.register(searchPatternTool);
}
