// tool-catalog - Auto-generates tool catalog at runtime from toolRegistry.
//
// Design principles:
// - Outputs only id + purpose + risk; omits parameters (parameters use tools Schema to avoid double definitions).
// - Catalog serves the first layer of selection in LLM tool phase: "what roughly is this tool for", not replacing full description.
// - Does not depend on global toolRegistry; accepts passed tool list, injectable during testing.

import type { ToolDefinition } from "./tool-registry";

/**
 * Extracts catalog purpose of tool.
 * - Prioritizes catalogHint
 * - Falls back to first line of description
 * - Finally falls back to full description
 */
function extractHint(tool: ToolDefinition): string {
  if (tool.catalogHint && tool.catalogHint.trim()) return tool.catalogHint.trim();
  const firstLine = (tool.description ?? "").split("\n")[0]?.trim();
  if (firstLine) return firstLine;
  return (tool.description ?? "").trim();
}

/**
 * Generates tool catalog text.
 * Returns placeholder notice for empty tool list.
 */
export function buildToolCatalog(tools: ReadonlyArray<ToolDefinition>): string {
  if (tools.length === 0) return "(No tools are currently available.)";
  return tools
    .map((tool) => {
      const hint = extractHint(tool);
      const risk = tool.risk ?? "safe";
      return `- ${tool.id}\n  Purpose: ${hint}\n  Risk: ${risk}`;
    })
    .join("\n");
}
