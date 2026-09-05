// Tool registry - Unified management of all tools dispatchable by LLM Router
// Worldbook is not registered here; it follows independent always-on retrieval

import { searchMemory } from "../rag/index";
import type { ToolRiskLevel } from "../permission";
import type { ToolContext } from "./tool-context";
import type { SoulProjectionConfig, SoulClaimKind } from "./soul-execution-context";

/** Tool completion evidence metadata: used by Planner to generate completionCriteria and planVerify validation */
export interface CapabilityCompletionEvidence {
  kind: "tool_succeeded" | "projection_claim";
  claimKind?: SoulClaimKind;
}

/** JSON Schema fragment: arguments can be primitive types or array/object (including items/properties). */
export type JsonSchemaProp =
  | { type: string; description?: string; enum?: string[] }
  | { type: "array"; description?: string; items: JsonSchemaProp }
  | { type: "object"; description?: string; properties: Record<string, JsonSchemaProp>; required?: string[] };

/** Controlled input policy: simple string or object with kind */
export type ControlledInputPolicy =
  | "context_ref"
  | "context_ref_array"
  | "tool_result"
  | { type: "context_ref"; kind: string }
  | { type: "context_ref_array"; kind: string }
  | { type: "tool_result" };

/** Extract underlying policy type string from ControlledInputPolicy */
export function controlledInputType(policy: ControlledInputPolicy): string {
  return typeof policy === "string" ? policy : policy.type;
}

/** Extract expectedKind from ControlledInputPolicy if present */
export function controlledInputKind(policy: ControlledInputPolicy): string | undefined {
  return typeof policy === "object" && "kind" in policy ? policy.kind : undefined;
}

export interface ToolDefinition {
  id: string;           // Unique tool identifier, e.g. "imported_docs"
  name: string;         // Display name, e.g. "Import Documents"
  description: string;  // One-line description used in LLM Router Prompt
  /** One-line purpose displayed in tool catalog (optional). Falls back to description first line.
   *  Used only for runtime-generated tool catalog; full parameters remain in tools Schema. */
  catalogHint?: string;
  /** Optional category tag; not strictly enforced in Phase 1. */
  category?: string;
  /** Stable capability identifier for Action Gate; falls back to tool id if omitted. */
  capability?: string;
  /** Runtime verification of controlled parameter origins; values cannot be invented by model. */
  controlledInput?: Record<string, ControlledInputPolicy>;
  enabled: boolean;     // Whether user enabled tool (corresponds to settings toggle)
  // Risk level: determines permission tiers under which tool may be invoked; defaults to "safe"
  risk?: ToolRiskLevel;
  // MCP compatible field: parameter schema, reused when connecting MCP
  inputSchema: {
    type: "object";
    properties: Record<string, JsonSchemaProp>;
    required?: string[];
  };
  /** When tool declares needsContext, dispatcher passes ToolContext during execution. Defaults to false. */
  needsContext?: boolean;
  /** Safe semantic name replacing toolId in Soul context */
  soulActionLabel?: string;
  /** Declarative Soul projection config */
  soulProjection?: SoulProjectionConfig;
  /** Tool-specific error code -> user-safe message */
  soulErrorMessages?: Record<string, string>;
  /** Completion evidence metadata: used by Planner and planVerify. */
  completionEvidence?: CapabilityCompletionEvidence[];
  /** Hidden in Plan mode: not exposed to Action Gate and Native FC. */
  hideInPlanMode?: boolean;
  // Executor: built-in tool points to local function, external MCP tool points to transport call
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<string>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const tool = this.tools.get(id);
    if (tool) {
      tool.enabled = enabled;
    }
  }

  getEnabledTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.enabled && isCompanionSafeTool(t));
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }
}

/** The model only sees capabilities the application can enforce without arbitrary mutation/process escape. */
export function isCompanionSafeTool(tool: Pick<ToolDefinition, "risk" | "id">): boolean {
  if (tool.id === "install_mcp_server") return false;
  // Fail closed: every model-visible tool must explicitly declare its capability risk.
  const risk = tool.risk;
  if (!risk) return false;
  return risk === "safe" || risk === "fs-read" || risk === "network" || risk === "input-control";
}

// Global singleton
export const toolRegistry = new ToolRegistry();

// -- Register built-in tools --

function formatMemoryResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as { text?: unknown; entry?: { text?: unknown } };
  if (typeof record.entry?.text === "string") return record.entry.text;
  if (typeof record.text === "string") return record.text;
  return "";
}

toolRegistry.register({
  id: 'imported_docs',
  name: 'Imported documents',
  description:
    'Semantically searches documents, novels, and files imported by the user and returns relevant excerpts.\n\n' +
    'Use it when:\n' +
    '- The user refers to a file, document, novel, or an uploaded-file marker\n' +
    '- The answer may be in an imported document\n' +
    '- The user asks you to find something in a document or novel\n\n' +
    'Do not use it for:\n' +
    '- Arbitrary local files (use read_file)\n' +
    '- Facts from previous conversations (use user_memory)\n' +
    '- Online information (use web_search)\n\n' +
    'Arguments: query (required search query), topK (optional result count, default 5).',
  enabled: true,
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK:  { type: 'number', description: 'Number of results; defaults to 5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await searchMemory(String(args.query), 'imported_doc', Number(args.topK) || 5);
    return results.map((r: unknown) => String(r)).join('\n');
  },
});

toolRegistry.register({
  id: 'user_memory',
  name: 'User memory',
  description:
    'Searches memories, personal details, and facts the user mentioned in earlier conversations.\n\n' +
    'Use it when:\n' +
    '- The user asks whether you remember something they said before\n' +
    '- The user asks about their preferences, habits, or background\n' +
    '- You need to verify a specific detail previously shared by the user\n\n' +
    'Do not use it for:\n' +
    '- Information already visible in the recent conversation\n' +
    '- Imported document content (use imported_docs)\n' +
    '- Information the user never shared; say you do not know when no memory is found\n\n' +
    'Arguments: query (required search query), topK (optional result count, default 5).',
  enabled: true,
  risk: 'safe',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK:  { type: 'number', description: 'Number of results; defaults to 5' },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const results = await searchMemory(String(args.query), 'user_memory', Number(args.topK) || 5);
    return results.map(formatMemoryResult).filter(Boolean).join('\n');
  },
});

