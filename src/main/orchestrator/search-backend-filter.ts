/**
 * Search backend tool filtering and API Key validation.
 *
 * Exposes corresponding search tools to Action Gate each turn based on search backend settings.
 * Search backends are mutually exclusive: only tools from one search backend exposed at a time.
 */

// -- API Key validation --

export interface KeyValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  diagnostics: { length: number; trimmed: boolean; hasNonAscii: boolean; hasControlChars: boolean };
}

/**
 * Validate security of search API Key.
 * Does not leak raw Key, returning sanitized diagnostics only.
 */
export function validateSearchApiKey(rawKey: string, label: string): KeyValidationResult {
  const originalLength = rawKey.length;
  const normalized = rawKey.trim();
  const trimmed = normalized.length !== originalLength;
  const hasNonAscii = /[^\x20-\x7E]/.test(normalized);
  const hasControlChars = /[\x00-\x1F\x7F]/.test(normalized);
  const diagnostics = { length: normalized.length, trimmed, hasNonAscii, hasControlChars };

  if (normalized.length === 0) {
    return { valid: false, normalized: "", error: `${label} cannot be empty`, diagnostics };
  }
  if (hasControlChars) {
    return { valid: false, normalized: "", error: `${label} contains control characters, please re-enter`, diagnostics };
  }
  if (hasNonAscii) {
    return { valid: false, normalized: "", error: `${label} contains non-ASCII characters, please verify if extra content was copied`, diagnostics };
  }
  return { valid: true, normalized, diagnostics };
}

// -- Search tool filtering --

export const BUILTIN_SEARCH_TOOL_ID = "web_search";
export const MINIMAX_SEARCH_TOOL_PREFIX = "minimax-web-search-";

export type SearchBackend = "off" | "ddg" | "bocha" | "tavily" | "minimax";

/**
 * Determines whether a tool should be exposed according to current search backend settings.
 * Returns true = exposed, false = hidden.
 */
export function shouldExposeSearchTool(
  toolId: string,
  activeBackend: SearchBackend,
): boolean {
  if (toolId === BUILTIN_SEARCH_TOOL_ID) {
    return activeBackend === "ddg" || activeBackend === "bocha" || activeBackend === "tavily";
  }
  if (toolId.startsWith(MINIMAX_SEARCH_TOOL_PREFIX)) {
    return activeBackend === "minimax";
  }
  return true; // Non-search tools exposed normally
}

/**
 * Filter tool list for search tools corresponding to current search backend.
 * Non-search tools are unaffected.
 */
export function filterToolsBySearchBackend<T extends { id: string }>(
  tools: T[],
  activeBackend: SearchBackend,
): T[] {
  return tools.filter((tool) => shouldExposeSearchTool(tool.id, activeBackend));
}
