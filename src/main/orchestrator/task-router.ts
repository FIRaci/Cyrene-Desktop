/**
 * Task Router -- Evaluates execution strategy and skills to load for current task.
 *
 * Outputs TaskRoute deciding between direct or plan mode.
 * Router and Action Gate use separate structured output calls.
 *
 * Feature flag: ENABLE_TASK_ROUTER (default false)
 * When disabled, completely skips router with zero overhead.
 */

import { runStructuredOutput } from "./structured-output/runner";
import { resolveStructuredOutputProfile, classifyStructuredOutputEndpoint } from "./structured-output/profiles";
import type { StructuredOutputProfile } from "./structured-output/types";
import type { ChatMessage, ChatRequest, ChatResponse } from "./vendors/types";
import type { ToolDefinition } from "./tool-registry";

// -- Data structures --

export interface TaskRoute {
  executionMode: "direct" | "plan";
  /** Retain original intent upon plan degradation */
  requestedExecutionMode?: "plan";
  /** Reason for degradation */
  fallbackReason?: string;
  skillIds: string[];
  reason: string;
}

export interface SkillRouteInfo {
  id: string;
  description: string;
  defaultExecutionMode?: "direct" | "plan";
}

export interface RunTaskRouterInput {
  model: string;
  originalQuery: string;
  contextualizedQuery: string;
  messages: ChatMessage[];
  availableSkills: SkillRouteInfo[];
  availableCapabilities: Array<{
    capabilityId: string;
    description: string;
    hasCompletionEvidence: boolean;
  }>;
  /** Preselected skillIds from exact match fast-path */
  preselectedSkillIds?: string[];
  profile: StructuredOutputProfile;
  generate: (request: ChatRequest, signal: AbortSignal) => Promise<ChatResponse>;
  signal?: AbortSignal;
}

// ── Feature flag ─────────────────────────

export const ENABLE_TASK_ROUTER = true;

// -- Fast path: exact skill matching --

/**
 * Check if user message exactly matches registered Skill name, alias, or ID.
 * Performs exact matching only, no fuzzy keyword routing.
 */
export function matchSkillByName(
  userMessage: string,
  skills: SkillRouteInfo[],
): string | undefined {
  const normalized = userMessage.trim().toLowerCase();
  for (const skill of skills) {
    const id = skill.id.toLowerCase();
    // Exact match for "use xlsx skill" / "call xlsx skill" / "xlsx skill"
    if (normalized.includes(`use ${id} skill`) ||
        normalized.includes(`call ${id} skill`) ||
        normalized.includes(`invoke ${id} skill`) ||
        normalized.includes(`\u4f7f\u7528 ${id} skill`) ||
        normalized.includes(`\u4f7f\u7528 ${id} \u6280\u80fd`) ||
        normalized.includes(`\u8c03\u7528 ${id} skill`) ||
        normalized.includes(`\u8c03\u7528 ${id} \u6280\u80fd`) ||
        normalized.includes(`\u7528 ${id} skill`) ||
        normalized.includes(`${id} skill`)) {
      return skill.id;
    }
  }
  return undefined;
}

// -- Router LLM invocation --

const ROUTER_SYSTEM_PROMPT = `You are the Task Router. Determine the execution strategy for the current request.

## Execution modes
- direct: The task is simple or has a fixed tool chain and needs no explicit plan. The Action Gate decides each step.
- plan: The task has multiple dependent steps and needs a formal plan to track progress.

## Decision factors
- Whether a registered Skill matches
- Estimated number of actions
- Dependencies between actions
- Whether deliverables require validation
- Whether multiple domains are involved
- Whether any irreversible write is involved
- Whether user confirmation is needed mid-task

## Rules
1. One or two independent actions with no dependencies -> direct
2. Three or more actions, or any dependency chain -> plan
3. Search or lookup only, with no file writes -> direct
4. When uncertain -> direct; prefer a missed plan over a false positive

Sentence length does not determine task complexity.

## Output
Return one JSON object containing exactly these fields:
- executionMode: "direct" or "plan"
- skillIds: Skill IDs to load, drawn only from the available list; may be empty
- reason: a brief reason

## Examples
"Check the weather in Hangzhou" -> {"executionMode":"direct","skillIds":[],"reason":"single lookup"}
"Find a song and play it" -> {"executionMode":"direct","skillIds":["cyrene-music-companion"],"reason":"fixed action chain"}
"Create a monthly Excel report" -> {"executionMode":"plan","skillIds":["xlsx"],"reason":"multiple steps with validation"}
"Find AI news, deduplicate it, compare sources, and write a document" -> {"executionMode":"plan","skillIds":[],"reason":"dependent, cross-domain steps"}`;

function routerSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      executionMode: { type: "string", enum: ["direct", "plan"] },
      skillIds: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1, maxLength: 100 },
      },
      reason: { type: "string", minLength: 1, maxLength: 300 },
    },
    required: ["executionMode", "skillIds", "reason"],
  };
}

function parseTaskRoute(value: unknown): TaskRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TaskRoute must be an object");
  }
  const obj = value as Record<string, unknown>;
  if (obj.executionMode !== "direct" && obj.executionMode !== "plan") {
    throw new Error("executionMode is invalid");
  }
  if (!Array.isArray(obj.skillIds)) throw new Error("skillIds is invalid");
  if (typeof obj.reason !== "string" || obj.reason.trim().length === 0) {
    throw new Error("reason is invalid");
  }
  return {
    executionMode: obj.executionMode,
    skillIds: obj.skillIds.map((s) => String(s)),
    reason: obj.reason.trim(),
  };
}

function buildRouterRequest(input: RunTaskRouterInput): ChatRequest {
  const schema = routerSchema();
  const skillCatalog = input.availableSkills.length > 0
    ? input.availableSkills.map((s) => `- ${s.id}: ${s.description}`).join("\n")
    : "(No Skills available)";
  const capabilityList = input.availableCapabilities
    .filter((c) => c.hasCompletionEvidence)
    .map((c) => `- ${c.capabilityId}: ${c.description}`)
    .join("\n");
  const preselected = input.preselectedSkillIds?.length
    ? `\nPreselected Skills: ${input.preselectedSkillIds.join(", ")}\nDetermine only executionMode and use the preselected skillIds.`
    : "";

  const userContent = JSON.stringify({
    userRequest: input.originalQuery.slice(0, 500),
    contextualizedQuery: input.contextualizedQuery.slice(0, 500),
    availableSkills: skillCatalog,
    availableCapabilitiesWithCompletionEvidence: capabilityList || "(none)",
    preselectedNote: preselected,
  });

  const structuredOutput = input.profile.mode === "provider_json_schema"
    ? { mode: "json_schema" as const, name: "task_route", schema, strict: true }
    : input.profile.mode === "provider_json_object"
      ? { mode: "json_object" as const, name: "task_route", schema }
      : {
          mode: "prompt_json" as const,
          name: "task_route",
          schema,
          sendJsonObjectHint: input.profile.requestHints.sendJsonObject,
        };

  return {
    model: input.model,
    messages: [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      ...input.messages.slice(-6),
      { role: "user", content: userContent },
    ],
    stream: false,
    maxTokens: 300,
    // Kimi k2.6 only allows temperature=1.
    // Omit to use server default; other models use temperature=0 for determinism.
    ...(input.model.match(/^kimi-k2\.6(?:$|-)/i) ? {} : { temperature: 0 }),
    structuredOutput,
  };
}

// -- Main function --

export async function runTaskRouter(input: RunTaskRouterInput): Promise<TaskRoute> {
  // 1. Fast path: exact skill matching
  const matchedSkillId = matchSkillByName(input.originalQuery, input.availableSkills);
  if (matchedSkillId) {
    const skill = input.availableSkills.find((s) => s.id === matchedSkillId);
    if (skill?.defaultExecutionMode) {
      // Skill metadata declared execution mode, skip Router LLM
      return {
        executionMode: skill.defaultExecutionMode,
        skillIds: [matchedSkillId],
        reason: "User-selected Skill with a mode declared in metadata",
      };
    }
    // Metadata undeclared, call Router with preselected skillIds
    input = { ...input, preselectedSkillIds: [matchedSkillId] };
  }

  // 2. LLM call
  try {
    const result = await runStructuredOutput<TaskRoute, ChatRequest>({
      stage: "action_gate", // Reuse repair strategy
      profile: input.profile,
      signal: input.signal,
      buildRequest: () => buildRouterRequest(input),
      generate: async (request, signal) => {
        const response = await input.generate(request, signal);
        return {
          text: response.text,
          finishReason: response.finishReason,
          refusal: response.refusal,
          structuredValue: response.structuredValue,
        };
      },
      parseSchema: parseTaskRoute,
      validateBusiness: (route) => {
        // Validate skillIds in available list
        const validSkillIds = new Set(input.availableSkills.map((s) => s.id));
        const filtered = route.skillIds.filter((id) => validSkillIds.has(id));
        if (filtered.length < route.skillIds.length) {
          route = { ...route, skillIds: filtered };
        }
        // Merge with preselected skillIds if present
        if (input.preselectedSkillIds) {
          const merged = new Set([...filtered, ...input.preselectedSkillIds]);
          route = { ...route, skillIds: [...merged] };
        }
        return { status: "accepted", value: route };
      },
    });

    if (result.outcome === "success") {
      return result.value;
    }
  } catch {
    // Router failed, fallback to direct
  }

  // 3. Fallback: direct + preselected skillIds (if any)
  return {
    executionMode: "direct",
    skillIds: input.preselectedSkillIds ?? [],
    reason: "Router fallback to direct",
  };
}

// -- Helper: build capabilities list from ToolDefinition --

export function buildRouterCapabilities(tools: ToolDefinition[]): RunTaskRouterInput["availableCapabilities"] {
  return tools
    .filter((t) => t.enabled)
    .map((t) => ({
      capabilityId: t.capability ?? t.id,
      description: t.catalogHint?.trim() || t.description.split("\n")[0]?.trim() || t.description,
      hasCompletionEvidence: (t.completionEvidence?.length ?? 0) > 0,
    }));
}
