// Built-in MCP auto-sync functions.
// Extracted from src/main/index.ts so vitest can import them without
// pulling in the whole Electron entry-point.

import { addMcpServer, removeMcpServer, listMcpServers } from "./orchestrator/mcp-manager";

const LOG_PREFIX = "[Cyrene]";

export const PLAYWRIGHT_MCP_ID = "playwright-mcp";

/**
 * Retired built-in MCP server id list — cleaned up from mcp-servers.json at startup.
 * Only ids in this allowlist are removed, preserving user custom MCP servers.
 */
export const REMOVED_BUILTIN_MCP_IDS: readonly string[] = ["firecrawl-hosted"];

/**
 * Sync the Playwright MCP server.
 * Default OFF: opt-in via settings.playwrightMcpEnabled.
 * Stdio + npx + @playwright/mcp@latest, isolated, headless, no-sandbox.
 */
export async function syncPlaywrightMcp(settings: {
  playwrightMcpEnabled: boolean;
}): Promise<void> {
  const exists = listMcpServers().some(s => s.id === PLAYWRIGHT_MCP_ID);

  if (settings.playwrightMcpEnabled && !exists) {
    console.log(LOG_PREFIX, "Registering Playwright MCP Server...");
    try {
      const result = await addMcpServer({
        id: PLAYWRIGHT_MCP_ID,
        name: "Playwright Browser",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--isolated", "--headless", "--no-sandbox"],
      });
      if (result.ok) {
        console.log(LOG_PREFIX, "Playwright MCP registered successfully, tools:", result.toolIds?.join(", "));
      } else {
        console.error(LOG_PREFIX, "Playwright MCP registration failed:", result.error);
      }
    } catch (err) {
      console.error(LOG_PREFIX, "Playwright MCP registration error:", err);
    }
  } else if (!settings.playwrightMcpEnabled && exists) {
    console.log(LOG_PREFIX, "Removing Playwright MCP Server...");
    try {
      await removeMcpServer(PLAYWRIGHT_MCP_ID);
    } catch (err) {
      console.error(LOG_PREFIX, "Playwright MCP removal error:", err);
    }
  }
}
