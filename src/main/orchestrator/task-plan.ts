/**
 * Task Plan -- Execution plan data structures and logic.
 *
 * Contains TaskPlan / PlanStep / StepCompletionPolicy type definitions,
 * and core logic for createPlan, verifyStep, and replan.
 *
 * Identification hierarchy:
 *   planId -> stepId -> stepExecutionId -> stepAttemptId
 *
 * Budget system:
 *   toolCallCount (≤ maxStepToolCalls) -> retryCount (≤ maxStepRetries) -> replanCount (≤ maxReplans) -> maxIterations
 */

import { runStructuredOutput } from "./structured-output/runner";
import type { StructuredOutputProfile } from "./structured-output/types";
import type { ChatMessage, ChatRequest, ChatResponse } from "./vendors/types";
import type { ToolCallResult } from "./types";
import type { ToolDefinition } from "./tool-registry";
import type { SoulClaimKind } from "./soul-execution-context";
import { projectToolResult } from "./soul-execution-context";

// -- Budget defaults --

export const DEFAULT_MAX_STEP_TOOL_CALLS = 4;
export const DEFAULT_MAX_STEP_RETRIES = 2;
export const DEFAULT_MAX_REPLANS = 2;
export const HARD_MAX_ITERATIONS = 30;
export const BASE_ITERATIONS = 12;
export const ITERATIONS_PER_STEP = 3;

// -- Data structures --

export type CompletionCriterion =
  | { kind: "tool_succeeded"; capabilityId: string }
  | { kind: "projection_claim"; capabilityId?: string; claimKind: SoulClaimKind };

export interface StepCompletionPolicy {
  /** All must be satisfied */
  allOf?: CompletionCriterion[];
  /** At least one satisfied per group */
  anyOf?: CompletionCriterion[][];
}

export interface StepFailure {
  errorCode?: string;
  message: string;
  failedAt: number;
}

export interface PlanStep {
  id: string;
  objective: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "superseded";
  completionPolicy: StepCompletionPolicy;
  /** Step execution cycle ID (from start to completion/failure) */
  executionId?: string;
  /** Actual tool call count */
  toolCallCount: number;
  /** Retry count after failure */
  retryCount: number;
  /** Failure info (retained after being superseded) */
  failure?: StepFailure;
  /** Which replacement steps supersede this */
  supersededBy?: string[];
}

export interface TaskPlan {
  id: string;
  conversationId: string;
  goal: string;
  steps: PlanStep[];
  status: "running" | "awaiting_user" | "paused" | "completed" | "failed" | "cancelled";
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PendingTaskSwitch {
  userRequest: string;
  contextualizedRequest?: string;
  proposedRoute?: import("./task-router").TaskRoute;
  createdAt: number;
}

// -- Frontend progress card snapshot --

export interface TaskPlanSnapshot {
  planId: string;
  goal: string;
  planStatus: TaskPlan["status"];
  steps: Array<{
    stepId: string;
    objective: string;
    status: PlanStep["status"];
    failureMessage?: string;
  }>;
  replanCount: number;
  timestamp: number;
}

export function buildPlanSnapshot(
  plan: TaskPlan,
  replanCount: number,
): TaskPlanSnapshot {
  return {
    planId: plan.id,
    goal: plan.goal,
    planStatus: plan.status,
    steps: plan.steps.map((s) => ({
      stepId: s.id,
      objective: s.objective,
      status: s.status,
      ...(s.failure?.message ? { failureMessage: s.failure.message } : {}),
    })),
    replanCount,
    timestamp: Date.now(),
  };
}

// -- Dynamic maxIterations --

export function computeMaxIterations(plan: TaskPlan | undefined): number {
  if (!plan) return BASE_ITERATIONS;
  return Math.min(
    HARD_MAX_ITERATIONS,
    BASE_ITERATIONS + plan.steps.length * ITERATIONS_PER_STEP,
  );
}

// -- Step ID generation --

let stepIdCounter = 0;
export function generateStepId(): string {
  return `s${++stepIdCounter}`;
}

let executionIdCounter = 0;
export function generateExecutionId(): string {
  return `exec_${++executionIdCounter}_${Date.now()}`;
}

let attemptIdCounter = 0;
export function generateAttemptId(): string {
  return `att_${++attemptIdCounter}_${Date.now()}`;
}

let planIdCounter = 0;
export function generatePlanId(): string {
  return `plan_${++planIdCounter}_${Date.now()}`;
}

// -- Step lookup --

export function findStep(plan: TaskPlan, stepId: string | undefined): PlanStep | undefined {
  if (!stepId) return undefined;
  return plan.steps.find((s) => s.id === stepId);
}

export function findCurrentStep(plan: TaskPlan, currentStepId: string | undefined): PlanStep | undefined {
  return findStep(plan, currentStepId);
}

export function findNextPendingStep(plan: TaskPlan, afterStepId?: string): PlanStep | undefined {
  let foundAfter = !afterStepId;
  for (const step of plan.steps) {
    if (!foundAfter) {
      if (step.id === afterStepId) foundAfter = true;
      continue;
    }
    if (step.status === "pending") return step;
  }
  return undefined;
}

// -- planVerify: completion criteria check --

export interface StepVerificationResult {
  status: "completed" | "failed" | "running";
  failureReason?: string;
}

export function verifyStep(
  step: PlanStep,
  stepResults: ToolCallResult[],
  tools: ToolDefinition[],
): StepVerificationResult {
  const toolMap = new Map(tools.map((t) => [t.id, t]));

  // Check for non-retryable failure
  const hasNonRetryableFailure = stepResults.some(
    (r) => r.status === "failed" && !r.retryable,
  );
  if (hasNonRetryableFailure) {
    const failed = stepResults.find((r) => r.status === "failed" && !r.retryable);
    return {
      status: "failed",
      failureReason: failed?.errorCode ?? "Tool execution failed",
    };
  }

  // Check completion criteria
  const policy = step.completionPolicy;
  if (!policy.allOf && !policy.anyOf) {
    // No completion criteria: tool success and terminal means complete
    const hasSuccess = stepResults.some((r) => r.status === "succeeded" && r.terminal !== false);
    return hasSuccess ? { status: "completed" } : { status: "running" };
  }

  // allOf: all criteria must be satisfied
  if (policy.allOf) {
    for (const criterion of policy.allOf) {
      if (!checkCriterion(criterion, stepResults, toolMap)) {
        return { status: "running" };
      }
    }
  }

  // anyOf: at least one satisfied per group
  if (policy.anyOf) {
    for (const group of policy.anyOf) {
      const anySatisfied = group.some((c) => checkCriterion(c, stepResults, toolMap));
      if (!anySatisfied) {
        return { status: "running" };
      }
    }
  }

  return { status: "completed" };
}

function checkCriterion(
  criterion: CompletionCriterion,
  results: ToolCallResult[],
  toolMap: Map<string, ToolDefinition>,
): boolean {
  if (criterion.kind === "tool_succeeded") {
    return results.some(
      (r) => r.status === "succeeded" && (r.capabilityId === criterion.capabilityId || r.toolId === criterion.capabilityId),
    );
  }
  // projection_claim: check using shared projection function
  for (const result of results) {
    if (result.status !== "succeeded") continue;
    const tool = toolMap.get(result.toolId);
    const projection = projectToolResult(result, tool);
    if (!projection) continue;
    if (projection.kind === "action_dispatch" || projection.kind === "action_completed") {
      if (projection.claim.kind === criterion.claimKind) {
        if (!criterion.capabilityId) return true;
        if (result.capabilityId === criterion.capabilityId || result.toolId === criterion.capabilityId) {
          return true;
        }
      }
    }
  }
  return false;
}

// -- createPlan: plan creation LLM call --

export interface RunCreatePlanInput {
  model: string;
  userRequest: string;
  contextualizedQuery: string;
  messages: ChatMessage[];
  availableCapabilities: Array<{
    capabilityId: string;
    description: string;
    completionEvidence: Array<{ kind: string; claimKind?: string }>;
  }>;
  loadedSkillInstructions?: string;
  conversationId: string;
  skillIds: string[];
  profile: StructuredOutputProfile;
  generate: (request: ChatRequest, signal: AbortSignal) => Promise<ChatResponse>;
  signal?: AbortSignal;
}

const PLANNER_SYSTEM_PROMPT = `You are the Planner responsible for creating an execution plan for the current task.

## Rules
- Every step must map to a tool action or produce an explicit projection claim.
- Do not create thinking-only steps such as "analyze results" or "compare sources"; include analysis in the action that produces an artifact.
- Prefer 3-7 steps and avoid unnecessary fragmentation.
- Every objective must be specific and verifiable.
- Use allOf for criteria that must all pass and anyOf for groups where at least one criterion must pass.
- Put mutually exclusive evidence, such as dispatched and web_fallback, in the same anyOf group.

## Output format
Return JSON:
{
  "goal": "Final task goal",
  "steps": [
    {
      "objective": "Step objective",
      "completionPolicy": {
        "allOf": [{ "kind": "tool_succeeded", "capabilityId": "..." }],
        "anyOf": [[{ "kind": "projection_claim", "capabilityId": "...", "claimKind": "..." }]]
      }
    }
  ]
}`;

function planSchema(): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string", minLength: 1, maxLength: 500 },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            objective: { type: "string", minLength: 1, maxLength: 300 },
            completionPolicy: {
              type: "object",
              properties: {
                allOf: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: ["tool_succeeded", "projection_claim"] },
                      capabilityId: { type: "string" },
                      claimKind: { type: "string" },
                    },
                    required: ["kind"],
                  },
                },
                anyOf: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: ["tool_succeeded", "projection_claim"] },
                        capabilityId: { type: "string" },
                        claimKind: { type: "string" },
                      },
                      required: ["kind"],
                    },
                  },
                },
              },
            },
          },
          required: ["objective", "completionPolicy"],
        },
      },
    },
    required: ["goal", "steps"],
  };
}

function replanSchema(): object {
  const plan = planSchema() as {
    properties: {
      steps: {
        items: object;
      };
    };
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      replacementSteps: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: plan.properties.steps.items,
      },
    },
    required: ["replacementSteps"],
  };
}

function parsePlan(value: unknown, skillIds: string[], conversationId: string): TaskPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TaskPlan must be an object");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.goal !== "string" || obj.goal.trim().length === 0) {
    throw new Error("goal is invalid");
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0 || obj.steps.length > 10) {
    throw new Error("steps is invalid");
  }

  const steps: PlanStep[] = obj.steps.map((raw, index) => {
    const s = raw as Record<string, unknown>;
    if (typeof s.objective !== "string" || s.objective.trim().length === 0) {
      throw new Error(`step ${index} objective is invalid`);
    }
    const policy = parseCompletionPolicy(s.completionPolicy);
    return {
      id: generateStepId(),
      objective: s.objective.trim(),
      status: "pending" as const,
      completionPolicy: policy,
      toolCallCount: 0,
      retryCount: 0,
    };
  });

  const now = Date.now();
  return {
    id: generatePlanId(),
    conversationId,
    goal: obj.goal.trim(),
    steps,
    status: "running",
    skillIds,
    createdAt: now,
    updatedAt: now,
  };
}

function parseCompletionPolicy(value: unknown): StepCompletionPolicy {
  if (!value || typeof value !== "object") {
    throw new Error("completionPolicy is invalid");
  }
  const obj = value as Record<string, unknown>;
  const policy: StepCompletionPolicy = {};

  if (Array.isArray(obj.allOf)) {
    policy.allOf = obj.allOf.map(parseCriterion);
  }
  if (Array.isArray(obj.anyOf)) {
    policy.anyOf = obj.anyOf.map((group) =>
      Array.isArray(group) ? group.map(parseCriterion) : [],
    ).filter((g) => g.length > 0);
  }

  if (!policy.allOf && !policy.anyOf) {
    throw new Error("completionPolicy must have allOf or anyOf");
  }
  return policy;
}

function parseCriterion(value: unknown): CompletionCriterion {
  if (!value || typeof value !== "object") {
    throw new Error("criterion is invalid");
  }
  const obj = value as Record<string, unknown>;
  if (obj.kind === "tool_succeeded") {
    if (typeof obj.capabilityId !== "string") throw new Error("tool_succeeded requires capabilityId");
    return { kind: "tool_succeeded", capabilityId: obj.capabilityId };
  }
  if (obj.kind === "projection_claim") {
    if (typeof obj.claimKind !== "string") throw new Error("projection_claim requires claimKind");
    return {
      kind: "projection_claim",
      ...(typeof obj.capabilityId === "string" ? { capabilityId: obj.capabilityId } : {}),
      claimKind: obj.claimKind as SoulClaimKind,
    };
  }
  throw new Error("criterion kind is invalid");
}

export async function runCreatePlan(input: RunCreatePlanInput): Promise<TaskPlan> {
  const evidenceCatalog = input.availableCapabilities
    .filter((c) => c.completionEvidence.length > 0)
    .map((c) => ({
      capabilityId: c.capabilityId,
      description: c.description,
      availableEvidence: c.completionEvidence,
    }));

  const userContent = JSON.stringify({
    userRequest: input.userRequest.slice(0, 500),
    contextualizedQuery: input.contextualizedQuery.slice(0, 500),
    availableCapabilities: evidenceCatalog,
    loadedSkills: input.loadedSkillInstructions?.slice(0, 6000) ?? "(none)",
  });

  const schema = planSchema();
  const structuredOutput = input.profile.mode === "provider_json_schema"
    ? { mode: "json_schema" as const, name: "task_plan", schema, strict: true }
    : input.profile.mode === "provider_json_object"
      ? { mode: "json_object" as const, name: "task_plan", schema }
      : {
          mode: "prompt_json" as const,
          name: "task_plan",
          schema,
          sendJsonObjectHint: input.profile.requestHints.sendJsonObject,
        };

  const request: ChatRequest = {
    model: input.model,
    messages: [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      ...input.messages.slice(-6),
      { role: "user", content: userContent },
    ],
    stream: false,
    maxTokens: 1200,
    structuredOutput,
  };

  const result = await runStructuredOutput<TaskPlan, ChatRequest>({
    stage: "action_gate",
    profile: input.profile,
    signal: input.signal,
    buildRequest: () => request,
    generate: async (req, signal) => {
      const response = await input.generate(req, signal);
      return {
        text: response.text,
        finishReason: response.finishReason,
        refusal: response.refusal,
        structuredValue: response.structuredValue,
      };
    },
    parseSchema: (value) => parsePlan(value, input.skillIds, input.conversationId),
    validateBusiness: (plan) => ({ status: "accepted", value: plan }),
  });

  if (result.outcome === "success") return result.value;
  const failCode = result.failure.code;
  const failDisp = result.failure.disposition;
  throw new Error(`Plan creation failed: code=${failCode} disposition=${failDisp} attempts=${result.failure.attempts}`);
}

// -- replan: replanning --

export interface RunReplanInput {
  model: string;
  plan: TaskPlan;
  failedStep: PlanStep;
  errorMessage: string;
  messages: ChatMessage[];
  availableCapabilities: Array<{
    capabilityId: string;
    description: string;
    completionEvidence: Array<{ kind: string; claimKind?: string }>;
  }>;
  profile: StructuredOutputProfile;
  generate: (request: ChatRequest, signal: AbortSignal) => Promise<ChatResponse>;
  signal?: AbortSignal;
}

const REPLANNER_SYSTEM_PROMPT = `You are the Replanner responsible for adjusting an execution plan after a step fails.

## Rules
- Completed steps cannot be reversed.
- The failed step and every later incomplete step may be replaced.
- Replacement steps must have an explicit completionPolicy.
- Do not create thinking-only steps.

## Output format
Return JSON:
{
  "replacementSteps": [
    {
      "objective": "...",
      "completionPolicy": { "allOf": [...], "anyOf": [[...]] }
    }
  ]
}`;

export async function runReplan(input: RunReplanInput): Promise<PlanStep[]> {
  const completedSteps = input.plan.steps
    .filter((s) => s.status === "completed")
    .map((s) => ({ objective: s.objective }));

  const userContent = JSON.stringify({
    taskGoal: input.plan.goal,
    completedSteps,
    failedStep: { objective: input.failedStep.objective, error: input.errorMessage },
    availableCapabilities: input.availableCapabilities
      .filter((c) => c.completionEvidence.length > 0)
      .map((c) => ({ capabilityId: c.capabilityId, description: c.description, evidence: c.completionEvidence })),
  });

  const schema = replanSchema();
  const structuredOutput = input.profile.mode === "provider_json_schema"
    ? { mode: "json_schema" as const, name: "replacement_steps", schema, strict: true }
    : input.profile.mode === "provider_json_object"
      ? { mode: "json_object" as const, name: "replacement_steps", schema }
      : {
          mode: "prompt_json" as const,
          name: "replacement_steps",
          schema,
          sendJsonObjectHint: input.profile.requestHints.sendJsonObject,
        };
  const request: ChatRequest = {
    model: input.model,
    messages: [
      { role: "system", content: REPLANNER_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    stream: false,
    maxTokens: 800,
    structuredOutput,
  };

  const result = await runStructuredOutput<{ replacementSteps: PlanStep[] }, ChatRequest>({
    stage: "action_gate",
    profile: input.profile,
    signal: input.signal,
    buildRequest: () => request,
    generate: async (req, signal) => {
      const response = await input.generate(req, signal);
      return {
        text: response.text,
        finishReason: response.finishReason,
        refusal: response.refusal,
        structuredValue: response.structuredValue,
      };
    },
    parseSchema: (value) => {
      if (!value || typeof value !== "object") throw new Error("invalid");
      const obj = value as Record<string, unknown>;
      if (!Array.isArray(obj.replacementSteps) || obj.replacementSteps.length === 0) {
        throw new Error("replacementSteps is invalid");
      }
      const steps: PlanStep[] = obj.replacementSteps.map((raw: unknown) => {
        const r = raw as Record<string, unknown>;
        if (typeof r.objective !== "string") throw new Error("objective is invalid");
        return {
          id: generateStepId(),
          objective: r.objective,
          status: "pending" as const,
          completionPolicy: parseCompletionPolicy(r.completionPolicy),
          toolCallCount: 0,
          retryCount: 0,
        };
      });
      return { replacementSteps: steps };
    },
    validateBusiness: (val) => ({ status: "accepted", value: val }),
  });

  if (result.outcome === "success") return result.value.replacementSteps;
  throw new Error("Replan failed");
}

// -- Plan state update helpers --

export function markStepSuperseded(step: PlanStep, failure: StepFailure, supersededBy: string[]): void {
  step.status = "superseded";
  step.failure = failure;
  step.supersededBy = supersededBy;
}

export function applyReplan(
  plan: TaskPlan,
  failedStep: PlanStep,
  replacementSteps: PlanStep[],
): void {
  const failedIndex = plan.steps.indexOf(failedStep);
  if (failedIndex < 0) return;

  const replacementIds = replacementSteps.map((s) => s.id);
  markStepSuperseded(failedStep, failedStep.failure ?? { message: "unknown", failedAt: Date.now() }, replacementIds);

  // Mark all pending steps following failed step as superseded
  for (let i = failedIndex + 1; i < plan.steps.length; i++) {
    if (plan.steps[i].status === "pending") {
      markStepSuperseded(plan.steps[i], { message: "A prerequisite step failed", failedAt: Date.now() }, replacementIds);
    }
  }

  // Insert replacement steps
  plan.steps.splice(failedIndex + 1, 0, ...replacementSteps);
  plan.updatedAt = Date.now();
}

export function isPlanComplete(plan: TaskPlan): boolean {
  return plan.steps.every((s) =>
    s.status === "completed" || s.status === "skipped" || s.status === "superseded",
  );
}
