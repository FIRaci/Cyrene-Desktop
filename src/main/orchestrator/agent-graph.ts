import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import { AgentRuntimeError } from "./agent-runtime-error";
import { perf } from "../perf-trace";
import type { ToolCallResult } from "./types";
import type { ChatMessage } from "./vendors/types";
import type {
  AskMissingField,
  AskUserAnswer,
} from "../../shared/ask-clarification";

export type ActionDecision =
  | {
      decision: "act";
      capability: string;
      objective: string;
      targetRefs: string[];
      /** Continuation strategy after current tool succeeds. Defaults to respond if undeclared. */
      afterSuccess?: "respond" | "replan";
    }
  | {
      decision: "respond";
      reason: string;
    }
  | {
      decision: "ask_user";
      reason: string;
      missingFields: AskMissingField[];
    }
  | {
      /** Local trusted failure fact. It is never produced by a model. */
      decision: "failure";
      reason: "action_gate_failed";
      code: string;
      disposition: "repair" | "ask_user" | "refresh_state" | "execution_policy" | "fail_closed";
      toolExecuted: false;
    };

export type ActDecision = Extract<ActionDecision, { decision: "act" }>;
export type AskUserDecision = Extract<ActionDecision, { decision: "ask_user" }>;
export type FailureDecision = Extract<ActionDecision, { decision: "failure" }>;

export interface GateFailureInfo {
  code: string;
  disposition: string;
}

export interface AgentGraphInput {
  originalQuery: string;
  contextualizedQuery: string;
  citaContextBlock: string;
  messages: ChatMessage[];
  availableCapabilities: string[];
  clarificationAnswers?: AskUserAnswer[];
}

export interface AgentGraphState extends AgentGraphInput {
  decision?: ActionDecision;
  /** Currently executing act decision (including afterSuccess), read by routeAfterTool. */
  currentAction?: ActDecision;
  toolResults: ToolCallResult[];
  iterationCount: number;
  reply: string;
  clarificationAnswers: AskUserAnswer[];
  /** Number of refresh_state re-decisions, preventing infinite loops. */
  refreshCount: number;
  /** Previous Action Gate failure info, read by next decide and passed to model. */
  lastGateFailure?: GateFailureInfo;
  /** Task Router routing result (used when feature flag is enabled) */
  taskRoute?: import("./task-router").TaskRoute;
  /** Execution plan (plan mode) */
  taskPlan?: import("./task-plan").TaskPlan;
  /** Currently executing step ID */
  currentStepId?: string;
  /** Number of replans */
  replanCount: number;
  /** Restore old Plan after temporary direct execution completes */
  resumePlanAfterDirect?: boolean;
}

export interface AgentGraphDeps {
  decide: (state: AgentGraphState) => Promise<ActionDecision>;
  execute: (state: AgentGraphState, decision: ActDecision) => Promise<ToolCallResult[]>;
  askUser?: (state: AgentGraphState, decision: AskUserDecision) => Promise<AskUserAnswer>;
  respond: (state: AgentGraphState, decision: Exclude<ActionDecision, { decision: "act" }>) => Promise<string>;
  /** Task Router callback (provided when feature flag is enabled) */
  route?: (state: AgentGraphState) => Promise<import("./task-router").TaskRoute>;
  /** Plan creation callback (plan mode) */
  createPlan?: (state: AgentGraphState) => Promise<import("./task-plan").TaskPlan>;
  /** Step verification callback (plan mode) */
  planVerify?: (state: AgentGraphState) => Promise<import("./task-plan").StepVerificationResult>;
  /** Replanning callback (plan mode) */
  planReplan?: (state: AgentGraphState) => Promise<import("./task-plan").PlanStep[]>;
  maxIterations?: number;
  /** Max number of refresh_state re-decisions, defaults to 1. */
  maxRefresh?: number;
  /** Max number of replans, defaults to 2 */
  maxReplans?: number;
  /** Called when Plan state changes, sending snapshot to frontend */
  onPlanUpdate?: (plan: import("./task-plan").TaskPlan, replanCount: number) => void;
  trace?: (node: string, state: AgentGraphState) => void;
}

const GraphState = Annotation.Root({
  originalQuery: Annotation<string>,
  contextualizedQuery: Annotation<string>,
  citaContextBlock: Annotation<string>,
  messages: Annotation<ChatMessage[]>,
  availableCapabilities: Annotation<string[]>,
  decision: Annotation<ActionDecision | undefined>,
  currentAction: Annotation<ActDecision | undefined>,
  toolResults: Annotation<ToolCallResult[]>,
  iterationCount: Annotation<number>,
  reply: Annotation<string>,
  clarificationAnswers: Annotation<AskUserAnswer[]>,
  refreshCount: Annotation<number>,
  lastGateFailure: Annotation<GateFailureInfo | undefined>,
  taskRoute: Annotation<import("./task-router").TaskRoute | undefined>,
  taskPlan: Annotation<import("./task-plan").TaskPlan | undefined>,
  currentStepId: Annotation<string | undefined>,
  replanCount: Annotation<number>,
  resumePlanAfterDirect: Annotation<boolean | undefined>,
});

// -- createPlan error classification --

function extractHttpStatus(message: string): number | undefined {
  const match = message.match(/HTTP\s+(\d{3})/);
  return match ? parseInt(match[1], 10) : undefined;
}

function classifyCreatePlanError(error: unknown): { errorType: string; retryable: boolean } {
  const errStr = error instanceof Error ? error.message : String(error);
  const errName = error instanceof Error ? error.name : "Unknown";
  const httpStatus = extractHttpStatus(errStr);

  // User explicitly cancelled
  if (errName === "AbortError" || errStr.includes("aborted") || errStr.includes("E_AGENT_GRAPH_CANCELLED")) {
    return { errorType: "abort", retryable: false };
  }
  // Authentication failure
  if (errStr.includes("401") || errStr.includes("403") || errStr.includes("AUTH") || errStr.includes("API key")) {
    return { errorType: "auth_failed", retryable: false };
  }
  // Content refusal
  if (errStr.includes("REFUSED") || errStr.includes("CONTENT_FILTERED")) {
    return { errorType: "model_refused", retryable: false };
  }
  // Schema error (structured output repair budget exhausted)
  if (errStr.includes("REPAIR_EXHAUSTED") || errStr.includes("NO_JSON_OBJECT") || errStr.includes("NO_SCHEMA_VALID_OBJECT")) {
    return { errorType: "structured_output_failed", retryable: false };
  }
  // Retryable transient error
  if (httpStatus === 429 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504 || httpStatus === 529) {
    return { errorType: "temporary_server_error", retryable: true };
  }
  if (errStr.includes("overloaded") || errStr.includes("timeout") || errStr.includes("TIMEOUT")) {
    return { errorType: "temporary_server_error", retryable: true };
  }
  if (errStr.includes("MODEL_REQUEST_FAILED") && !httpStatus) {
    // Request failure without HTTP status code, likely network issue
    return { errorType: "request_failed", retryable: true };
  }
  return { errorType: "unknown", retryable: false };
}

export async function runAgentGraph(input: AgentGraphInput, deps: AgentGraphDeps): Promise<AgentGraphState> {
  const maxIterations = Math.max(1, deps.maxIterations ?? 12);
  const maxRefresh = Math.max(0, deps.maxRefresh ?? 1);
  const maxReplans = Math.max(0, deps.maxReplans ?? 2);

  const compileTimer = perf.begin("graph_build_compile");
  const graph = new StateGraph(GraphState)
    .addNode("route", async (state) => {
      deps.trace?.("route", state);
      if (!deps.route) return {};  // no-op when feature flag is disabled
      const taskRoute = await deps.route(state);
      return { taskRoute };
    })
    .addNode("decide", async (state) => {
      deps.trace?.("decide", state);
      const decision = await deps.decide(state);
      // act decision is written synchronously to currentAction for routeAfterTool to read afterSuccess
      // lastGateFailure is cleared after being read by decide callback to avoid cross-turn residue
      return {
        decision,
        lastGateFailure: undefined,
        ...(decision.decision === "act" ? { currentAction: decision } : {}),
      };
    })
    .addNode("execute", async (state) => {
      deps.trace?.("execute", state);
      if (state.iterationCount >= maxIterations) {
        throw new AgentRuntimeError(
          "E_AGENT_GRAPH_ITERATION_LIMIT",
          `Agent graph exceeded ${maxIterations} iterations.`,
        );
      }
      if (state.decision?.decision !== "act") {
        throw new Error("E_AGENT_GRAPH_INVALID_ACT_STATE");
      }
      const results = await deps.execute(state, state.decision);
      return {
        toolResults: [...state.toolResults, ...results],
        iterationCount: state.iterationCount + 1,
      };
    })
    .addNode("routeAfterTool", async (state) => {
      deps.trace?.("routeAfterTool", state);
      const result = state.toolResults[state.toolResults.length - 1];
      const action = state.currentAction;
      if (!result || !action) {
        return new Command({ goto: "decide" });
      }

      // Routing logic (pure code, no LLM call)
      let goto: "decide" | "soul" | "planVerify";
      if (result.status === "failed") {
        goto = result.retryable ? "decide" : "soul";
      } else if (!result.terminal) {
        goto = "decide";
      } else {
        goto = action.afterSuccess === "replan" ? "decide" : "soul";
      }

      // In plan mode, terminal state routes to planVerify rather than soul
      // Only runs planVerify when truly in plan mode (taskPlan exists and is running)
      const inPlanMode = state.taskRoute?.executionMode === "plan"
        && state.taskPlan?.status === "running";
      if (goto === "soul" && inPlanMode) {
        goto = "planVerify";
      }

      // Rewrite decision to respond when going to soul
      const update = goto === "soul"
        ? { decision: { decision: "respond" as const, reason: "tool_complete" } }
        : {};
      return new Command({ update, goto });
    })
    .addNode("askUser", async (state) => {
      deps.trace?.("askUser", state);
      if (state.decision?.decision !== "ask_user" || !deps.askUser) {
        return new Command({ goto: "soul" });
      }
      if (state.iterationCount >= maxIterations) {
        throw new AgentRuntimeError(
          "E_AGENT_GRAPH_ITERATION_LIMIT",
          `Agent graph exceeded ${maxIterations} iterations.`,
        );
      }
      const answer = await deps.askUser(state, state.decision);
      if (answer.answers.length === 0) {
        return new Command({ goto: "soul" });
      }
      return new Command({
        update: {
          clarificationAnswers: [...state.clarificationAnswers, answer],
          decision: undefined,
          iterationCount: state.iterationCount + 1,
        },
        goto: "decide",
      });
    })
    .addNode("refresh", async (state) => {
      deps.trace?.("refresh", state);
      const failure = state.decision as FailureDecision;
      return {
        refreshCount: state.refreshCount + 1,
        lastGateFailure: { code: failure.code, disposition: failure.disposition } as GateFailureInfo,
        decision: undefined,
      };
    })
    .addNode("createPlan", async (state) => {
      deps.trace?.("createPlan", state);
      if (!deps.createPlan) {
        console.warn("[AgentGraph] CreatePlan: dep missing, skipping");
        return new Command({ goto: "decide" });
      }
      console.log("[AgentGraph] CreatePlan entered");

      const MAX_REQUEST_RETRIES = 1;
      let lastError: unknown;

      for (let attempt = 1; attempt <= 1 + MAX_REQUEST_RETRIES; attempt++) {
        try {
          const plan = await deps.createPlan(state);
          const firstStep = plan.steps.find((s) => s.status === "pending");
          if (firstStep) {
            firstStep.executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            firstStep.status = "running";
          }
          if (attempt > 1) {
            console.log(`[AgentGraph] CreatePlan retry succeeded: attempt=${attempt} steps=${plan.steps.length}`);
          } else {
            console.log(`[AgentGraph] CreatePlan succeeded: steps=${plan.steps.length} goal=${plan.goal.slice(0, 80)}`);
          }
          deps.onPlanUpdate?.(plan, 0);
          return {
            taskPlan: plan,
            currentStepId: firstStep?.id,
          };
        } catch (error) {
          lastError = error;
          const errStr = error instanceof Error ? error.message : String(error);
          const errName = error instanceof Error ? error.name : "Unknown";
          const { errorType, retryable } = classifyCreatePlanError(error);
          const httpStatus = extractHttpStatus(errStr);

          if (retryable && attempt <= MAX_REQUEST_RETRIES) {
            // Retry after short backoff
            console.log(`[AgentGraph] CreatePlan request failed: attempt=${attempt}/${1 + MAX_REQUEST_RETRIES} type=${errorType} httpStatus=${httpStatus ?? "n/a"} retryable=true next=retry`);
            await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
            continue;
          }

          // Final failure
          console.error(`[AgentGraph] CreatePlan failed: attempts=${attempt} type=${errorType} httpStatus=${httpStatus ?? "n/a"} retryable=${retryable} fallback=direct`);
          break;
        }
      }

      // Degrade: clean up plan state while retaining original routing intent
      return new Command({
        update: {
          taskRoute: {
            executionMode: "direct" as const,
            requestedExecutionMode: "plan" as const,
            fallbackReason: "create_plan_failed",
            skillIds: state.taskRoute?.skillIds ?? [],
            reason: "Plan creation failed, fallback to direct",
          },
          taskPlan: undefined,
          currentStepId: undefined,
        },
        goto: "decide",
      });
    })
    .addNode("planVerify", async (state) => {
      deps.trace?.("planVerify", state);
      if (!deps.planVerify || !state.taskPlan || !state.currentStepId) {
        return new Command({ goto: "soul" });
      }
      const result = await deps.planVerify(state);
      const plan = state.taskPlan;
      const step = plan.steps.find((s) => s.id === state.currentStepId);
      if (!step) return new Command({ goto: "soul" });

      if (result.status === "completed") {
        step.status = "completed";
        plan.updatedAt = Date.now();
        // Find next pending step
        const nextStep = plan.steps.find((s) => s.status === "pending");
        if (nextStep) {
          nextStep.executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          nextStep.status = "running";
          deps.onPlanUpdate?.(plan, state.replanCount);
          return new Command({
            update: { taskPlan: plan, currentStepId: nextStep.id },
            goto: "decide",
          });
        }
        // All steps completed
        plan.status = "completed";
        deps.onPlanUpdate?.(plan, state.replanCount);
        return new Command({
          update: { taskPlan: plan, decision: { decision: "respond" as const, reason: "plan_completed" } },
          goto: "soul",
        });
      }
      if (result.status === "failed") {
        step.status = "failed";
        step.failure = { message: result.failureReason ?? "Step failed", failedAt: Date.now() };
        plan.updatedAt = Date.now();
        deps.onPlanUpdate?.(plan, state.replanCount);
        return new Command({
          update: { taskPlan: plan },
          goto: "planReplan",
        });
      }
      // running: continue current step
      return new Command({ goto: "decide" });
    })
    .addNode("planReplan", async (state) => {
      deps.trace?.("planReplan", state);
      if (!deps.planReplan || !state.taskPlan || state.replanCount >= maxReplans) {
        // Replan budget exhausted
        const plan = state.taskPlan;
        if (plan) {
          plan.status = "failed";
          plan.updatedAt = Date.now();
          deps.onPlanUpdate?.(plan, state.replanCount);
        }
        return new Command({
          update: { taskPlan: plan, decision: { decision: "respond" as const, reason: "plan_failed" } },
          goto: "soul",
        });
      }
      try {
        const replacementSteps = await deps.planReplan(state);
        const plan = state.taskPlan;
        const failedStep = plan.steps.find((s) => s.id === state.currentStepId && s.status === "failed");
        if (!failedStep) return new Command({ goto: "soul" });

        // Mark failed and subsequent pending steps as superseded
        const replacementIds = replacementSteps.map((s) => s.id);
        const failedIndex = plan.steps.indexOf(failedStep);
        failedStep.status = "superseded";
        failedStep.supersededBy = replacementIds;
        for (let i = failedIndex + 1; i < plan.steps.length; i++) {
          if (plan.steps[i].status === "pending") {
            plan.steps[i].status = "superseded";
            plan.steps[i].supersededBy = replacementIds;
          }
        }
        // Insert replacement steps
        plan.steps.splice(failedIndex + 1, 0, ...replacementSteps);
        plan.updatedAt = Date.now();

        const nextStep = replacementSteps[0];
        if (nextStep) {
          nextStep.executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          nextStep.status = "running";
        }
        deps.onPlanUpdate?.(plan, state.replanCount + 1);
        return new Command({
          update: {
            taskPlan: plan,
            currentStepId: nextStep?.id,
            replanCount: state.replanCount + 1,
          },
          goto: "decide",
        });
      } catch {
        // Replanning failed
        const plan = state.taskPlan;
        if (plan) {
          plan.status = "failed";
          plan.updatedAt = Date.now();
        }
        return new Command({
          update: { taskPlan: plan, decision: { decision: "respond" as const, reason: "replan_failed" } },
          goto: "soul",
        });
      }
    })
    .addNode("soul", async (state) => {
      deps.trace?.("soul", state);
      if (!state.decision || state.decision.decision === "act") {
        throw new Error("E_AGENT_GRAPH_INVALID_SOUL_STATE");
      }
      return { reply: await deps.respond(state, state.decision) };
    })
    .addEdge(START, "route")
    .addConditionalEdges("route", (state) => {
      const mode = state.taskRoute?.executionMode;
      const hasCreatePlan = !!deps.createPlan;
      if (mode === "plan" && hasCreatePlan) {
        console.log("[AgentGraph] Route transition: executionMode=plan next=createPlan");
        return "createPlan";
      }
      if (mode === "plan" && !hasCreatePlan) {
        console.warn("[AgentGraph] Route transition: executionMode=plan but createPlan dep missing, falling back to decide");
      }
      return "decide";
    })
    .addEdge("createPlan", "decide")
    .addConditionalEdges("decide", (state) => {
      if (state.decision?.decision === "act") return "execute";
      if (state.decision?.decision === "ask_user" && deps.askUser) return "askUser";
      if (state.decision?.decision === "failure"
        && state.decision.disposition === "refresh_state"
        && state.refreshCount < maxRefresh) {
        return "refresh";
      }
      return "soul";
    })
    .addEdge("execute", "routeAfterTool")
    .addEdge("refresh", "decide")
    .addEdge("soul", END)
    .compile();
  compileTimer.end();

  const invokeTimer = perf.begin("graph_invoke");
  const result = await graph.invoke({
    ...input,
    decision: undefined,
    currentAction: undefined,
    toolResults: [],
    clarificationAnswers: input.clarificationAnswers ?? [],
    iterationCount: 0,
    refreshCount: 0,
    lastGateFailure: undefined,
    taskRoute: undefined,
    taskPlan: undefined,
    currentStepId: undefined,
    replanCount: 0,
    resumePlanAfterDirect: undefined,
    reply: "",
  }, {
    // route + decide + execute + routeAfterTool + planVerify/planReplan consumes multiple supersteps.
    recursionLimit: maxIterations * 4 + 12,
  });
  invokeTimer.end();
  return result;
}
