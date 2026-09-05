/**
 * Soul Execution Context -- Generic execution projection layer.
 *
 * Deterministically projects ToolCallResult into structured context safely usable by Soul.
 * Does not expose raw output, toolId, args, or internal references.
 *
 * Core principles:
 * - actions only prove a tool call actually took place
 * - projections define the extent to which Soul is permitted to make claims from the tool result
 * - executionStatus=succeeded != business action completed != user goal achieved
 */

import type { ToolCallResult } from "./types";
import type { ToolDefinition } from "./tool-registry";

// -- Size limits --

const MAX_PROJECTION_ITEMS = 10;
const MAX_ATTRIBUTES_PER_ITEM = 8;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 10;
const MAX_TOTAL_PROJECTION_LENGTH = 12_000;

// -- Control tag escaping --

const CONTROL_TAGS = [
  "SOUL_PHASE_RULES",
  "SOUL_EXECUTION_CONTEXT",
  "ACTION_DECISION",
  "CLARIFICATION_ANSWERS",
  "TOOL_EXECUTION_CONTEXT",
  "FAILURE_SOUL_POLICY",
  "RESPONSE_CONTEXT",
];

const controlTagPattern = new RegExp(
  `\\[/?(?:${CONTROL_TAGS.join("|")})\\]`,
  "g",
);

function escapeControlTags(text: string): string {
  return text.replace(controlTagPattern, (match) =>
    match.replace(/\[/g, "［").replace(/\]/g, "］"),
  );
}

// -- Path safety --

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// -- Value sanitization --

type ProjectionValue = string | number | boolean | string[];

function sanitizeString(value: string): string {
  const escaped = escapeControlTags(value);
  return escaped.length > MAX_STRING_LENGTH ? escaped.slice(0, MAX_STRING_LENGTH) : escaped;
}

function sanitizeValue(value: unknown): ProjectionValue | undefined {
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    const escaped = value.map(sanitizeString);
    return escaped.length > MAX_ARRAY_ITEMS
      ? escaped.slice(0, MAX_ARRAY_ITEMS)
      : escaped;
  }
  return undefined;
}

// -- Type definitions --

export type ProjectionSource = "trusted_internal" | "external_untrusted";

export type SoulClaimKind =
  | "request_dispatched"
  | "browser_opened"
  | "file_created"
  | "message_sent"
  | "action_completed";

export type SoulClaim =
  | { kind: "request_dispatched" }
  | { kind: "browser_opened" }
  | { kind: "file_created" }
  | { kind: "message_sent" }
  | { kind: "action_completed"; action: string };

export type SoulProjectionConfig =
  | {
      projector: "entity_list";
      source: ProjectionSource;
      itemsPath: string;
      fields: Record<string, string>;
      maxItems?: number;
    }
  | {
      projector: "entity_detail";
      source: ProjectionSource;
      entityPath?: string;
      fields: Record<string, string>;
    }
  | {
      projector: "action_dispatch";
      source: ProjectionSource;
      statePath: string;
      stateClaims: Record<string, SoulClaim>;
    }
  | {
      projector: "action_completed";
      source: ProjectionSource;
      claim: SoulClaim;
      confirmation: { kind: "tool_status" };
    }
  | {
      projector: "action_completed";
      source: ProjectionSource;
      claim: SoulClaim;
      confirmation: { kind: "output_field"; path: string; values: Array<string | number | boolean> };
    };

export type SoulProjection =
  | {
      kind: "entity_list";
      source: ProjectionSource;
      items: Array<{
        title?: string;
        attributes?: Record<string, ProjectionValue>;
      }>;
      truncated?: boolean;
    }
  | {
      kind: "entity_detail";
      source: ProjectionSource;
      title?: string;
      attributes: Record<string, ProjectionValue>;
    }
  | {
      kind: "action_dispatch";
      source: ProjectionSource;
      state: string;
      claim: SoulClaim;
    }
  | {
      kind: "action_completed";
      source: ProjectionSource;
      claim: SoulClaim;
    };

export interface SoulAction {
  /** Safe semantic name; omitted when soulActionLabel is not configured */
  actionLabel?: string;
  executionStatus: "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";
  terminal: boolean;
  errorCode?: string;
  userSafeMessage?: string;
}

export interface SoulExecutionContext {
  actions: SoulAction[];
  projections: SoulProjection[];
}

// -- Common error messages --

const COMMON_ERROR_MESSAGES: Record<string, string> = {
  E_PERMISSION_DENIED: "Permission denied; user authorization is required",
};

function resolveUserSafeMessage(
  errorCode: string | undefined,
  tool: ToolDefinition | undefined,
): string | undefined {
  if (!errorCode) return undefined;
  return (
    tool?.soulErrorMessages?.[errorCode] ??
    COMMON_ERROR_MESSAGES[errorCode] ??
    "Execution failed"
  );
}

function mapExecutionStatus(
  result: ToolCallResult,
): SoulAction["executionStatus"] {
  if (result.status === "succeeded") return "succeeded";
  if (result.errorCode === "E_PERMISSION_DENIED") return "denied";
  return "failed";
}

// -- Projectors --

function projectEntityList(
  parsed: unknown,
  config: Extract<SoulProjectionConfig, { projector: "entity_list" }>,
): SoulProjection | undefined {
  const rawItems = getValueByPath(parsed, config.itemsPath);
  if (!Array.isArray(rawItems)) return undefined;

  const limit = Math.min(config.maxItems ?? MAX_PROJECTION_ITEMS, MAX_PROJECTION_ITEMS);
  const truncated = rawItems.length > limit;
  const items = rawItems.slice(0, limit).map((item): {
    title?: string;
    attributes?: Record<string, ProjectionValue>;
  } | undefined => {
    const titleRaw = config.fields["title"]
      ? getValueByPath(item, config.fields["title"])
      : undefined;
    const title = typeof titleRaw === "string" ? sanitizeString(titleRaw) : undefined;

    const attributes: Record<string, ProjectionValue> = {};
    let attrCount = 0;
    for (const [projName, srcPath] of Object.entries(config.fields)) {
      if (projName === "title") continue;
      if (attrCount >= MAX_ATTRIBUTES_PER_ITEM) break;
      const value = sanitizeValue(getValueByPath(item, srcPath));
      if (value !== undefined) {
        attributes[projName] = value;
        attrCount++;
      }
    }

    if (title === undefined && attrCount === 0) return undefined;
    return {
      ...(title !== undefined ? { title } : {}),
      ...(attrCount > 0 ? { attributes } : {}),
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);

  if (items.length === 0) return undefined;
  return {
    kind: "entity_list",
    source: config.source,
    items,
    ...(truncated ? { truncated: true } : {}),
  };
}

function projectEntityDetail(
  parsed: unknown,
  config: Extract<SoulProjectionConfig, { projector: "entity_detail" }>,
): SoulProjection | undefined {
  const entity = config.entityPath ? getValueByPath(parsed, config.entityPath) : parsed;
  if (entity === null || entity === undefined || typeof entity !== "object") return undefined;

  const titleRaw = config.fields["title"]
    ? getValueByPath(entity, config.fields["title"])
    : undefined;
  const title = typeof titleRaw === "string" ? sanitizeString(titleRaw) : undefined;

  const attributes: Record<string, ProjectionValue> = {};
  let attrCount = 0;
  for (const [projName, srcPath] of Object.entries(config.fields)) {
    if (projName === "title") continue;
    if (attrCount >= MAX_ATTRIBUTES_PER_ITEM) break;
    const value = sanitizeValue(getValueByPath(entity, srcPath));
    if (value !== undefined) {
      attributes[projName] = value;
      attrCount++;
    }
  }

  if (title === undefined && attrCount === 0) return undefined;
  return {
    kind: "entity_detail",
    source: config.source,
    ...(title !== undefined ? { title } : {}),
    attributes,
  };
}

function projectActionDispatch(
  parsed: unknown,
  config: Extract<SoulProjectionConfig, { projector: "action_dispatch" }>,
): SoulProjection | undefined {
  const state = getValueByPath(parsed, config.statePath);
  if (typeof state !== "string") return undefined;
  const claim = config.stateClaims[state];
  if (!claim) return undefined;
  return {
    kind: "action_dispatch",
    source: config.source,
    state,
    claim,
  };
}

function projectActionCompleted(
  result: ToolCallResult,
  parsed: unknown | undefined,
  config: Extract<SoulProjectionConfig, { projector: "action_completed" }>,
): SoulProjection | undefined {
  if (config.confirmation.kind === "tool_status") {
    if (result.status !== "succeeded") return undefined;
  } else {
    if (parsed === undefined) return undefined;
    const value = getValueByPath(parsed, config.confirmation.path);
    if (!config.confirmation.values.includes(value as string | number | boolean)) return undefined;
  }
  return {
    kind: "action_completed",
    source: config.source,
    claim: config.claim,
  };
}

function projectResult(
  result: ToolCallResult,
  config: SoulProjectionConfig,
): SoulProjection | undefined {
  // action_completed with tool_status does not require parsing output
  if (config.projector === "action_completed" && config.confirmation.kind === "tool_status") {
    return projectActionCompleted(result, undefined, config);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output);
  } catch {
    return undefined;
  }

  switch (config.projector) {
    case "entity_list":
      return projectEntityList(parsed, config);
    case "entity_detail":
      return projectEntityDetail(parsed, config);
    case "action_dispatch":
      return projectActionDispatch(parsed, config);
    case "action_completed":
      return projectActionCompleted(result, parsed, config);
  }
}

// -- Main builder function --

/**
 * Projects a single tool result, returning SoulProjection or undefined.
 * Shared by Layer 2 (buildSoulExecutionContext) and planVerify.
 * Does not depend on Soul Prompt text, calling only deterministic projection logic.
 */
export function projectToolResult(
  result: ToolCallResult,
  tool: ToolDefinition | undefined,
): SoulProjection | undefined {
  if (result.status !== "succeeded") return undefined;
  if (!tool?.soulProjection) return undefined;
  return projectResult(result, tool.soulProjection);
}

export function buildSoulExecutionContext(
  results: ToolCallResult[],
  tools: ToolDefinition[],
): SoulExecutionContext {
  const toolMap = new Map(tools.map((t) => [t.id, t]));

  const actions: SoulAction[] = results.map((result) => {
    const tool = toolMap.get(result.toolId);
    const action: SoulAction = {
      executionStatus: mapExecutionStatus(result),
      terminal: result.terminal ?? true,
    };
    if (tool?.soulActionLabel) {
      action.actionLabel = tool.soulActionLabel;
    }
    if (result.errorCode) {
      action.errorCode = result.errorCode;
      action.userSafeMessage = resolveUserSafeMessage(result.errorCode, tool);
    }
    return action;
  });

  const projections: SoulProjection[] = [];
  let totalLength = 0;

  for (const result of results) {
    const tool = toolMap.get(result.toolId);
    const projection = projectToolResult(result, tool);
    if (!projection) continue;

    const serialized = JSON.stringify(projection);
    if (totalLength + serialized.length > MAX_TOTAL_PROJECTION_LENGTH) break;
    totalLength += serialized.length;
    projections.push(projection);
  }

  return { actions, projections };
}

// -- Output formatting --

export function formatSoulExecutionContext(ctx: SoulExecutionContext): string {
  return [
    "[SOUL_EXECUTION_CONTEXT]",
    JSON.stringify(ctx),
    "[/SOUL_EXECUTION_CONTEXT]",
  ].join("\n");
}
