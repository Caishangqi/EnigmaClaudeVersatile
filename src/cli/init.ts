#!/usr/bin/env node

import {existsSync, mkdirSync, writeFileSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {TEMPLATES} from "../lib/config.js";

// ============================================================
// Paths
// ============================================================

const cwd = process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// skills/ lives at package root: dist/cli/init.js → ../../skills/
const SKILLS_SRC = path.resolve(__dirname, "../../skills");

const SKILL_NAMES = ["codex-task", "grok-search"];

// ============================================================
// Helpers
// ============================================================

function writeIfMissing(filePath: string, content: string): "created" | "skipped" {
    if (existsSync(filePath)) return "skipped";
    mkdirSync(path.dirname(filePath), {recursive: true});
    writeFileSync(filePath, content, "utf-8");
    return "created";
}

function log(status: "created" | "skipped", filePath: string): void {
    const rel = path.relative(cwd, filePath);
    if (status === "created") {
        console.log(`  + ${rel}`);
    } else {
        console.log(`  - ${rel} (already exists, skipped)`);
    }
}

// ============================================================
// Main
// ============================================================

function main(): void {
    console.log("\nclaude-versatile init\n");

    let hasChanges = false;

    // 1. Copy Skills
    console.log("Skills:");
    for (const name of SKILL_NAMES) {
        const src = path.join(SKILLS_SRC, name, "SKILL.md");
        const dest = path.join(cwd, ".claude", "skills", name, "SKILL.md");

        if (!existsSync(src)) {
            console.log(`  ! ${name}/SKILL.md — source not found, skipped`);
            continue;
        }

        const content = readFileSync(src, "utf-8");
        const status = writeIfMissing(dest, content);
        log(status, dest);
        if (status === "created") hasChanges = true;
    }

    // 2. Generate .versatile/ config templates
    console.log("\nConfig templates:");
    const versatileDir = path.join(cwd, ".versatile");
    for (const [filename, template] of Object.entries(TEMPLATES)) {
        const dest = path.join(versatileDir, filename);
        const content = JSON.stringify(template, null, 2) + "\n";
        const status = writeIfMissing(dest, content);
        log(status, dest);
        if (status === "created") hasChanges = true;
    }

    // 3. Summary
    console.log("");
    if (hasChanges) {
        console.log("Next steps:");
        console.log("  1. Edit .versatile/codex.agent.json — set your OpenAI API key and base URL");
        console.log("  2. Edit .versatile/grok.agent.json — set your Grok API key and base URL");
        console.log("  3. Configure MCP servers in .mcp.json (see README)");
    } else {
        console.log("Everything is already set up.");
    }
    console.log("");
}

main();
