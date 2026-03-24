import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import type {ServerConfig} from "./types.js";

/**
 * Creates an McpServer instance with the given config.
 */
export function createServer(config: ServerConfig): McpServer {
    return new McpServer({
        name: config.name,
        version: config.version,
    });
}

/**
 * Connects the server to stdio transport and starts listening.
 */
export async function startServer(server: McpServer, label: string): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${label} running on stdio`);
}

/**
 * Standard entry point wrapper with fatal error handling.
 */
export function runServer(main: () => Promise<void>): void {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
