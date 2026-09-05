// MCP Adapter: adapts MCP server tool discovery and execution into ToolRegistry
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolDefinition, toolRegistry } from "./tool-registry";

const LOG_PREFIX = "[MCP Adapter]";

export interface McpServerConfig {
  id: string;              // Unique identifier
  name: string;            // Display name
  transport: "stdio" | "sse";
  command?: string;         // Required for stdio, unused for sse
  args?: string[];         // Command line arguments
  env?: Record<string, string>;
  cwd?: string;
  url?: string;            // Required for sse, unused for stdio
}

interface McpServerState {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  connected: boolean;
  toolIds: string[];       // List of tool IDs registered to ToolRegistry
}

/**
 * Connect to an MCP server, discover its tools and register to ToolRegistry.
 * Returns list of registered tool IDs.
 */
export async function connectMcpServer(config: McpServerConfig): Promise<string[]> {
  console.log(LOG_PREFIX, "Connecting to MCP server:", config.name, "(" + config.id + ")");

  let transport: Transport;
  if (config.transport === "sse") {
    if (!config.url) {
      throw new Error("sse transport requires url");
    }
    transport = new SSEClientTransport(new URL(config.url));
  } else {
    if (!config.command) {
      throw new Error("stdio transport requires command");
    }
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    });
  }

  // Listen for transport errors
  transport.onerror = (err: Error) => {
    console.error(LOG_PREFIX, "Transport error [" + config.name + "]:", err.message);
  };

  const client = new Client(
    { name: "cyrene", version: "0.8.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    console.log(LOG_PREFIX, "Connected to", config.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Connection failed [" + config.name + "]:", msg);
    // Cleanup transport on connection failure
    try { await transport.close(); } catch (_) { /* ignore */ }
    throw err;
  }

  // Discover tools
  let mcpTools: Array<{
    name: string;
    description?: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  }> = [];

  try {
    const result = await client.listTools();
    mcpTools = result.tools as Array<{
      name: string;
      description?: string;
      inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
      };
    }>;
    console.log(LOG_PREFIX, "Discovered " + mcpTools.length + " tools:", mcpTools.map(t => t.name).join(", "));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "listTools failed [" + config.name + "]:", msg);
    await client.close();
    throw err;
  }

  // Register to ToolRegistry
  const registeredIds: string[] = [];
  for (const mt of mcpTools) {
    // Use hyphen instead of colon -- some providers do not allow colons in function names
    // Hyphens are accepted by all vendors.
    const toolId = config.id + "-" + mt.name;

    // Skip if tool with same name already exists
    if (toolRegistry.getById(toolId)) {
      console.warn(LOG_PREFIX, "Tool already exists, skipping:", toolId);
      continue;
    }

    const toolDef: ToolDefinition = {
      id: toolId,
      name: "[" + config.name + "] " + mt.name,
      description: mt.description || mt.name,
      enabled: true,
      inputSchema: {
        type: "object",
        properties: mt.inputSchema?.properties as Record<string, { type: string; description: string }> || {},
        required: mt.inputSchema?.required,
      },
      risk: "shell", // Default for MCP tools to require approval (treated as unsafe)
      // TODO: map ctx to MCP hidden arguments if needed in the future.
      // Current MCP tool execute does not take ctx.
      execute: async (args: Record<string, unknown>) => {
        console.log(LOG_PREFIX, "Calling tool:", toolId, JSON.stringify(args));
        try {
          const result = await client.callTool({
            name: mt.name,
            arguments: args,
          });
          // Extract text content
          const texts: string[] = [];
          if (result.content && Array.isArray(result.content)) {
            for (const block of result.content) {
              if (block && typeof block === "object" && (block as { type: string }).type === "text") {
                texts.push(String((block as { text: string }).text));
              }
            }
          }
          const output = texts.join("\n") || JSON.stringify(result.content);
          if (result.isError === true) {
            throw new Error(`E_MCP_TOOL_FAILED${output ? `: ${output}` : ""}`);
          }
          console.log(LOG_PREFIX, "Tool returned [" + toolId + "]:", output.slice(0, 200));
          return output;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(LOG_PREFIX, "Tool execution failed [" + toolId + "]:", msg);
          if (msg.startsWith("E_MCP_TOOL_FAILED")) throw err;
          throw new Error(`E_MCP_TOOL_FAILED: ${msg}`);
        }
      },
    };

    toolRegistry.register(toolDef);
    registeredIds.push(toolId);
    console.log(LOG_PREFIX, "Registered tool:", toolId);
  }

  // Save state
  const state: McpServerState = {
    config,
    client,
    transport,
    connected: true,
    toolIds: registeredIds,
  };
  mcpServerStates.set(config.id, state);

  console.log(LOG_PREFIX, "MCP server ready:", config.name, "(" + registeredIds.length + " tools)");
  return registeredIds;
}

/**
 * Disconnect and clean up an MCP server and its registered tools.
 */
export async function disconnectMcpServer(serverId: string): Promise<boolean> {
  console.log(LOG_PREFIX, "Disconnecting MCP server:", serverId);
  const state = mcpServerStates.get(serverId);
  if (!state) {
    console.warn(LOG_PREFIX, "MCP server not found:", serverId);
    return false;
  }

  // Remove tools from ToolRegistry
  for (const toolId of state.toolIds) {
    toolRegistry.unregister(toolId);
    console.log(LOG_PREFIX, "Removed tool:", toolId);
  }

  try {
    await state.client.close();
    console.log(LOG_PREFIX, "Disconnected:", serverId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "client.close failed [" + serverId + "]:", msg);
    // Attempt to close transport even if client.close fails
    try { await state.transport.close(); } catch (_) { /* ignore */ }
  }

  state.connected = false;
  mcpServerStates.delete(serverId);
  return true;
}

/**
 * Get status of all connected MCP servers.
 */
export function getMcpServerStates(): Array<{
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  toolIds: string[];
}> {
  return Array.from(mcpServerStates.values()).map(s => ({
    id: s.config.id,
    name: s.config.name,
    connected: s.connected,
    toolCount: s.toolIds.length,
    toolIds: [...s.toolIds],
  }));
}

// Internal state storage
const mcpServerStates = new Map<string, McpServerState>();



