// MCP Manager: manages lifecycle, configuration persistence, and auto-connection for MCP servers
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { connectMcpServer, disconnectMcpServer, getMcpServerStates, McpServerConfig } from "./mcp-adapter";

const LOG_PREFIX = "[MCP Manager]";

function getConfigPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "mcp-servers.json");
}

function loadConfigs(): McpServerConfig[] {
  try {
    const raw = fs.readFileSync(getConfigPath(), "utf-8");
    const configs = JSON.parse(raw);
    if (Array.isArray(configs)) {
      console.log(LOG_PREFIX, "Loaded " + configs.length + " MCP server configs");
      return configs;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(LOG_PREFIX, "Failed to read configs:", (err as Error).message);
    }
  }
  return [];
}

function saveConfigs(configs: McpServerConfig[]): void {
  try {
    const dir = path.dirname(getConfigPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getConfigPath(), JSON.stringify(configs, null, 2), "utf-8");
    console.log(LOG_PREFIX, "Saved " + configs.length + " MCP server configs");
  } catch (err) {
    console.error(LOG_PREFIX, "Failed to save configs:", (err as Error).message);
  }
}

/**
 * Clean up decommissioned builtin MCP server configs.
 * Idempotent: does not write to disk or error if entries do not exist.
 * Only deletes specified fixed IDs, never touches user custom MCPs.
 * Returns list of removed IDs for logging.
 */
export async function pruneMcpServersByIds(serverIds: string[]): Promise<string[]> {
  const configs = loadConfigs();
  const removed: string[] = [];
  const kept = configs.filter((c) => {
    if (serverIds.includes(c.id)) {
      removed.push(c.id);
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    saveConfigs(kept);
  }
  // Disconnect if already connected
  for (const id of removed) {
    try {
      await disconnectMcpServer(id);
    } catch {
      // ignore
    }
  }
  return removed;
}

/**
 * Automatically connect all saved MCP servers on startup.
 */
export async function initMcpManager(): Promise<void> {
  console.log(LOG_PREFIX, "Initializing MCP Manager...");
  const configs = loadConfigs();

  if (configs.length === 0) {
    console.log(LOG_PREFIX, "No configured MCP servers, skipping");
    return;
  }

  let connected = 0;
  let failed = 0;

  for (const config of configs) {
    try {
      await connectMcpServer(config);
      connected++;
    } catch (err) {
      failed++;
      console.error(LOG_PREFIX, "Auto-connect failed [" + config.name + "]:", (err as Error).message);
    }
  }

  console.log(LOG_PREFIX, `MCP Manager initialized: ${connected} connected, ${failed} failed`);
}

/**
 * Add a new MCP server configuration, connect and persist.
 */
export async function addMcpServer(config: McpServerConfig): Promise<{
  ok: boolean;
  toolIds?: string[];
  error?: string;
}> {
  console.log(LOG_PREFIX, "Adding MCP server:", config.name);

  // Check if already exists
  const configs = loadConfigs();
  if (configs.some(c => c.id === config.id)) {
    return { ok: false, error: "MCP server with identical ID already exists: " + config.id };
  }

  try {
    const toolIds = await connectMcpServer(config);
    configs.push(config);
    saveConfigs(configs);
    return { ok: true, toolIds };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Remove an MCP server, disconnect and persist.
 */
export async function removeMcpServer(serverId: string): Promise<{ ok: boolean; error?: string }> {
  console.log(LOG_PREFIX, "Removing MCP server:", serverId);

  const disconnected = await disconnectMcpServer(serverId);
  if (!disconnected) {
    return { ok: false, error: "MCP server not found: " + serverId };
  }

  const configs = loadConfigs().filter(c => c.id !== serverId);
  saveConfigs(configs);
  return { ok: true };
}

/**
 * Get status list of all MCP servers.
 */
export function listMcpServers(): Array<{
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  toolIds: string[];
}> {
  return getMcpServerStates();
}
