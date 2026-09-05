import { describe, expect, it, vi } from "vitest";
import { runAgentGraph, type ActionDecision } from "./agent-graph";
import type { ToolCallResult } from "./types";

function succeeded(toolId: string): ToolCallResult {
  return { toolId, args: {}, output: JSON.stringify({ ok: true }), status: "succeeded", terminal: true, retryable: false };
}

function failed(toolId: string, retryable = false): ToolCallResult {
  return {
    toolId, args: {}, output: "fail", status: "failed",
    errorCode: "E_FAIL", terminal: true, retryable,
  };
}

function succeededNonTerminal(toolId: string): ToolCallResult {
  return { toolId, args: {}, output: JSON.stringify({ ok: true }), status: "succeeded", terminal: false, retryable: false };
}

describe("runAgentGraph", () => {
  it("routes a terminal act success directly to Soul without re-consulting decide", async () => {
    const decisions: ActionDecision[] = [
      { decision: "act", capability: "music.play_track", objective: "play selected track", targetRefs: ["ctx_song_1"], afterSuccess: "respond" },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn(async () => [succeeded("music_play_track")]);
    const respond = vi.fn(async (state) => {
      expect(state.toolResults).toHaveLength(1);
      return "Processed";
    });

    const result = await runAgentGraph({
      originalQuery: "Play track 1",
      contextualizedQuery: "Play current daily recommendation track 1",
      citaContextBlock: "[CITA_CONTEXT]",
      messages: [{ role: "user", content: "Play track 1" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // routeAfterTool routes directly to soul after tool succeeds, decide called only 1 time
    expect(decide).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Processed");
    expect(result.toolResults).toHaveLength(1);
    expect(result.iterationCount).toBe(1);
  });

  it("collects an ask_user answer and re-enters decision routing without using Soul", async () => {
    const decisions: ActionDecision[] = [
      {
        decision: "ask_user",
        reason: "Multiple versions exist",
        missingFields: [{
          field: "version",
          reason: "Song version unclear",
          required: true,
          typeHint: "single_select",
          candidateHints: ["Live version", "Studio version"],
          allowCustom: true,
        }],
      },
      { decision: "respond", reason: "User selection obtained" },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn();
    const askUser = vi.fn(async () => ({
      requestId: "choice-1",
      answers: [{ field: "version", selectedValues: ["Live version"] }],
    }));
    const respond = vi.fn(async (state) => {
      expect(state.clarificationAnswers).toEqual([{
        requestId: "choice-1",
        answers: [{ field: "version", selectedValues: ["Live version"] }],
      }]);
      expect(state.messages.at(-1)).toEqual({ role: "user", content: "Play Left Turn Signal" });
      return "Sure, continuing with Live version.";
    });

    const result = await runAgentGraph({
      originalQuery: "Play Left Turn Signal",
      contextualizedQuery: "Play Left Turn Signal, but multiple versions exist",
      citaContextBlock: "[CITA_CONTEXT]",
      messages: [{ role: "user", content: "Play Left Turn Signal" }],
      availableCapabilities: ["music.search", "music.play_track"],
    }, ({
      decide,
      execute,
      askUser,
      respond,
    } as Parameters<typeof runAgentGraph>[1]));

    expect(execute).not.toHaveBeenCalled();
    expect(askUser).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe("Sure, continuing with Live version.");
  });

  it("stops an endless act loop at the configured iteration limit", async () => {
    await expect(runAgentGraph({
      originalQuery: "Keep trying",
      contextualizedQuery: "Keep trying",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Keep trying" }],
      availableCapabilities: ["music.play_track"],
    }, {
      decide: async () => ({ decision: "act", capability: "music.play_track", objective: "retry", targetRefs: [], afterSuccess: "replan" as const }),
      execute: async () => [succeeded("music_play_track")],
      respond: async () => "Should not reach here",
      maxIterations: 2,
    })).rejects.toMatchObject({ code: "E_AGENT_GRAPH_ITERATION_LIMIT" });
  });

  it("uses its own iteration guard before LangGraph's recursion guard", async () => {
    await expect(runAgentGraph({
      originalQuery: "Keep trying",
      contextualizedQuery: "Keep trying",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Keep trying" }],
      availableCapabilities: ["music.play_track"],
    }, {
      decide: async () => ({ decision: "act", capability: "music.play_track", objective: "retry", targetRefs: [], afterSuccess: "replan" as const }),
      execute: async () => [succeeded("music_play_track")],
      respond: async () => "Should not reach here",
      maxIterations: 12,
    })).rejects.toMatchObject({ code: "E_AGENT_GRAPH_ITERATION_LIMIT" });
  });

  it("routes to Soul directly when a terminal act succeeds with afterSuccess=respond", async () => {
    const decide = vi.fn(async () => ({
      decision: "act" as const, capability: "music.play_track", objective: "play",
      targetRefs: ["ctx_song_1"], afterSuccess: "respond" as const,
    }));
    const execute = vi.fn(async () => [succeeded("music_play_track")]);
    const respond = vi.fn(async () => "Play request sent.");

    const result = await runAgentGraph({
      originalQuery: "Play track 4",
      contextualizedQuery: "Play track 4",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 4" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // Single-step task: routeAfterTool routes directly to soul after tool succeeds, decide called once
    expect(decide).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Play request sent.");
  });

  it("routes back to decide when afterSuccess=replan and the tool succeeded terminally", async () => {
    const decisions: ActionDecision[] = [
      { decision: "act", capability: "music.play_track", objective: "play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "replan" },
      { decision: "respond", reason: "Done" },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn(async () => [succeeded("music_play_track")]);
    const respond = vi.fn(async () => "Done.");

    const result = await runAgentGraph({
      originalQuery: "Play track 1 then search",
      contextualizedQuery: "Play track 1 then search",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 1 then search" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // Multi-step task: return to decide after first act+replan succeeds, second decide chooses respond
    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Done.");
  });

  it("routes to Soul directly when a failed tool is not retryable", async () => {
    const decide = vi.fn(async () => ({
      decision: "act" as const, capability: "music.play_track", objective: "play",
      targetRefs: ["ctx_song_1"], afterSuccess: "respond" as const,
    }));
    const execute = vi.fn(async () => [failed("music_play_track", false)]);
    const respond = vi.fn(async () => "Playback failed, please try again later.");

    const result = await runAgentGraph({
      originalQuery: "Play track 4",
      contextualizedQuery: "Play track 4",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 4" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // Non-retryable failure: proceed directly to soul, do not return to decide
    expect(decide).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Playback failed, please try again later.");
  });

  it("routes back to decide when a failed tool is retryable", async () => {
    const decisions: ActionDecision[] = [
      { decision: "act", capability: "music.play_track", objective: "play", targetRefs: ["ctx_song_1"], afterSuccess: "respond" },
      { decision: "respond", reason: "give up retry" },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn(async () => [failed("music_play_track", true)]);
    const respond = vi.fn(async () => "Retry failed.");

    const result = await runAgentGraph({
      originalQuery: "Play track 4",
      contextualizedQuery: "Play track 4",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 4" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // Retryable failure: return to decide to let LLM choose between retry or giving up
    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Retry failed.");
  });

  it("routes back to decide when a succeeded tool is not terminal", async () => {
    const decisions: ActionDecision[] = [
      { decision: "act", capability: "music.play_track", objective: "start listening", targetRefs: ["ctx_song_1"], afterSuccess: "respond" },
      { decision: "respond", reason: "Done" },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn(async () => [succeededNonTerminal("music_play_track")]);
    const respond = vi.fn(async () => "Done.");

    const result = await runAgentGraph({
      originalQuery: "Start listening",
      contextualizedQuery: "Start listening",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Start listening" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // terminal=false: return to decide, do not enter soul directly
    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Done.");
  });

  it("routes refresh_state failure to refresh, then back to decide for re-decision", async () => {
    const decisions: ActionDecision[] = [
      { decision: "failure", reason: "action_gate_failed", code: "TARGET_REF_INVALID", disposition: "refresh_state", toolExecuted: false },
      { decision: "respond", reason: "recovered" },
    ];
    const decide = vi.fn(async (state) => {
      // Second decide should be able to see previous failure info
      if (decide.mock.calls.length === 2) {
        expect(state.lastGateFailure).toEqual({ code: "TARGET_REF_INVALID", disposition: "refresh_state" });
      }
      return decisions.shift()!;
    });
    const execute = vi.fn();
    const respond = vi.fn(async () => "Recovered");

    const result = await runAgentGraph({
      originalQuery: "Play track 3",
      contextualizedQuery: "Play track 3",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 3" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Recovered");
    expect(result.refreshCount).toBe(1);
  });

  it("routes refresh_state to soul when refresh budget is exhausted", async () => {
    const decisions: ActionDecision[] = [
      { decision: "failure", reason: "action_gate_failed", code: "TARGET_REF_INVALID", disposition: "refresh_state", toolExecuted: false },
      { decision: "failure", reason: "action_gate_failed", code: "TARGET_REF_INVALID", disposition: "refresh_state", toolExecuted: false },
    ];
    const decide = vi.fn(async () => decisions.shift()!);
    const execute = vi.fn();
    const respond = vi.fn(async () => "Failed");

    const result = await runAgentGraph({
      originalQuery: "Play track 3",
      contextualizedQuery: "Play track 3",
      citaContextBlock: "",
      messages: [{ role: "user", content: "Play track 3" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond, maxRefresh: 1 });

    // First failure -> refresh; second failure -> refreshCount reached limit -> soul
    expect(decide).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Failed");
    expect(result.refreshCount).toBe(1);
  });

  it("routes fail_closed directly to soul without refresh", async () => {
    const decide = vi.fn(async () => ({
      decision: "failure" as const,
      reason: "action_gate_failed" as const,
      code: "REPAIR_EXHAUSTED",
      disposition: "fail_closed" as const,
      toolExecuted: false as const,
    }));
    const execute = vi.fn();
    const respond = vi.fn(async () => "Failed");

    const result = await runAgentGraph({
      originalQuery: "test",
      contextualizedQuery: "test",
      citaContextBlock: "",
      messages: [{ role: "user", content: "test" }],
      availableCapabilities: ["music.play_track"],
    }, { decide, execute, respond });

    // fail_closed does not refresh, proceeds directly to soul
    expect(decide).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(result.refreshCount).toBe(0);
  });

  describe("createPlan retry on temporary request errors", () => {
    function makePlanGoal(goal: string) {
      return {
        id: "plan_1",
        conversationId: "c1",
        goal,
        steps: [{ id: "s1", objective: "step 1", status: "pending" as const, completionPolicy: { allOf: [{ kind: "tool_succeeded" as const, capabilityId: "x" }] }, toolCallCount: 0, retryCount: 0 }],
        status: "running" as const,
        skillIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const planRoute = async () => ({
      executionMode: "plan" as const,
      skillIds: [],
      reason: "test",
    });

    it("retries once on HTTP 529 then succeeds", async () => {
      let callCount = 0;
      const createPlan = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("Plan creation failed: code=MODEL_REQUEST_FAILED HTTP 529");
        return makePlanGoal("Successful goal");
      });
      const decide = vi.fn(async () => ({ decision: "respond" as const, reason: "done" }));
      const execute = vi.fn(async () => []);
      const respond = vi.fn(async () => "Plan created");

      const result = await runAgentGraph({
        originalQuery: "Search news and organize document",
        contextualizedQuery: "Search news and organize document",
        citaContextBlock: "",
        messages: [{ role: "user", content: "Search news and organize document" }],
        availableCapabilities: ["web_search"],
      }, { decide, execute, createPlan, route: planRoute, respond });

      expect(createPlan).toHaveBeenCalledTimes(2);
      expect(result.taskPlan).toBeDefined();
      expect(result.taskPlan!.goal).toBe("Successful goal");
    });

    it("does not retry on HTTP 401 (auth failure)", async () => {
      const createPlan = vi.fn(async () => {
        throw new Error("Plan creation failed: code=MODEL_REQUEST_FAILED HTTP 401");
      });
      const decide = vi.fn(async () => ({ decision: "respond" as const, reason: "done" }));
      const execute = vi.fn(async () => []);
      const respond = vi.fn(async () => "Degraded");

      await runAgentGraph({
        originalQuery: "test",
        contextualizedQuery: "test",
        citaContextBlock: "",
        messages: [{ role: "user", content: "test" }],
        availableCapabilities: ["x"],
      }, { decide, execute, createPlan, route: planRoute, respond });

      expect(createPlan).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledTimes(1);
    });

    it("falls back to direct after two consecutive 529s", async () => {
      const createPlan = vi.fn(async () => {
        throw new Error("Plan creation failed: code=MODEL_REQUEST_FAILED HTTP 529");
      });
      const decide = vi.fn(async () => ({ decision: "respond" as const, reason: "done" }));
      const execute = vi.fn(async () => []);
      const respond = vi.fn(async () => "Degraded");

      const result = await runAgentGraph({
        originalQuery: "test",
        contextualizedQuery: "test",
        citaContextBlock: "",
        messages: [{ role: "user", content: "test" }],
        availableCapabilities: ["x"],
      }, { decide, execute, createPlan, route: planRoute, respond });

      expect(createPlan).toHaveBeenCalledTimes(2);
      expect(result.taskPlan).toBeUndefined();
      expect(result.taskRoute?.executionMode).toBe("direct");
    });

    it("does not retry on user abort", async () => {
      const abortErr = new Error("E_AGENT_GRAPH_CANCELLED");
      abortErr.name = "AbortError";
      const createPlan = vi.fn(async () => { throw abortErr; });
      const decide = vi.fn(async () => ({ decision: "respond" as const, reason: "done" }));
      const execute = vi.fn(async () => []);
      const respond = vi.fn(async () => "Cancelled");

      await runAgentGraph({
        originalQuery: "test",
        contextualizedQuery: "test",
        citaContextBlock: "",
        messages: [{ role: "user", content: "test" }],
        availableCapabilities: ["x"],
      }, { decide, execute, createPlan, route: planRoute, respond });

      expect(createPlan).toHaveBeenCalledTimes(1);
    });

    it("clears taskPlan on failure so delegate_task is not hidden", async () => {
      const createPlan = vi.fn(async () => {
        throw new Error("Plan creation failed: code=MODEL_REQUEST_FAILED HTTP 529");
      });
      const decide = vi.fn(async () => ({ decision: "respond" as const, reason: "done" }));
      const execute = vi.fn(async () => []);
      const respond = vi.fn(async () => "Degraded");

      const result = await runAgentGraph({
        originalQuery: "test",
        contextualizedQuery: "test",
        citaContextBlock: "",
        messages: [{ role: "user", content: "test" }],
        availableCapabilities: ["x"],
      }, { decide, execute, createPlan, route: planRoute, respond });

      expect(result.taskPlan).toBeUndefined();
      expect(result.taskRoute?.executionMode).toBe("direct");
    });
  });

  describe("full Plan chain: createPlan → execute → planVerify → soul", () => {
    function makePlanResult(steps: Array<{ id: string; objective: string; capabilityId: string }>) {
      return {
        id: "plan_1",
        conversationId: "c1",
        goal: "Test plan",
        steps: steps.map((s) => ({
          id: s.id,
          objective: s.objective,
          status: "pending" as const,
          completionPolicy: { allOf: [{ kind: "tool_succeeded" as const, capabilityId: s.capabilityId }] },
          toolCallCount: 0,
          retryCount: 0,
        })),
        status: "running" as const,
        skillIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const planRoute = async () => ({
      executionMode: "plan" as const,
      skillIds: [],
      reason: "test",
    });

    it("completes multi-step plan: step1 → step2 → plan completed → soul", async () => {
      const plan = makePlanResult([
        { id: "s1", objective: "search", capabilityId: "web_search" },
        { id: "s2", objective: "organize", capabilityId: "write_word" },
      ]);
      // s1 pending first, s2 pending first; planVerify will advance sequentially
      let currentStep = "s1";
      let step1Done = false;

      const createPlan = vi.fn(async () => plan);
      const execute = vi.fn(async (_state: unknown, _decision: unknown) => {
        if (currentStep === "s1") return [succeeded("web_search")];
        return [succeeded("write_word")];
      });
      const decide = vi.fn(async () => {
        // In Plan mode, decide selects tool for current step
        if (currentStep === "s1") {
          return { decision: "act" as const, capability: "web_search", objective: "search", targetRefs: [] as string[], afterSuccess: "respond" as const };
        }
        return { decision: "act" as const, capability: "write_word", objective: "organize", targetRefs: [] as string[], afterSuccess: "respond" as const };
      });
      const planVerify = vi.fn(async () => {
        // Simulate verifyStep: check if current step is completed
        if (currentStep === "s1") {
          step1Done = true;
          return { status: "completed" as const };
        }
        return { status: "completed" as const };
      });
      const respond = vi.fn(async () => "Plan completed");

      // Rewrite execute to switch based on currentStepId
      const originalExecute = execute;
      const wrappedExecute = vi.fn(async (state, _decision) => {
        currentStep = state.currentStepId ?? "s1";
        return originalExecute(state, _decision);
      });

      const result = await runAgentGraph({
        originalQuery: "Search news and organize into document",
        contextualizedQuery: "Search news and organize into document",
        citaContextBlock: "",
        messages: [{ role: "user", content: "Search news and organize into document" }],
        availableCapabilities: ["web_search", "write_word"],
      }, { decide, execute: wrappedExecute, createPlan, route: planRoute, planVerify, respond });

      // createPlan should be called
      expect(createPlan).toHaveBeenCalledTimes(1);
      // planVerify should be called twice (once per step)
      expect(planVerify).toHaveBeenCalledTimes(2);
      // plan should be marked as completed
      expect(result.taskPlan?.status).toBe("completed");
      // eventually should enter soul to generate reply
      expect(respond).toHaveBeenCalledTimes(1);
    });

    it("handles step failure → replan → continue with replacement steps", async () => {
      const plan = makePlanResult([
        { id: "s1", objective: "search", capabilityId: "web_search" },
        { id: "s2", objective: "failing step", capabilityId: "failing_tool" },
        { id: "s3", objective: "organize", capabilityId: "write_word" },
      ]);

      let verifyCallCount = 0;
      let currentStep = "s1";

      const createPlan = vi.fn(async () => plan);
      const execute = vi.fn(async (_state: unknown, _decision: unknown) => {
        if (currentStep === "s1") return [succeeded("web_search")];
        if (currentStep === "s2") return [failed("failing_tool")];
        return [succeeded("write_word")];
      });
      const decide = vi.fn(async () => {
        if (currentStep === "s1") return { decision: "act" as const, capability: "web_search", objective: "search", targetRefs: [] as string[], afterSuccess: "respond" as const };
        if (currentStep === "s2") return { decision: "act" as const, capability: "failing_tool", objective: "failing step", targetRefs: [] as string[], afterSuccess: "respond" as const };
        return { decision: "act" as const, capability: "write_word", objective: "organize", targetRefs: [] as string[], afterSuccess: "respond" as const };
      });
      const planVerify = vi.fn(async () => {
        verifyCallCount++;
        if (verifyCallCount === 1) return { status: "completed" as const }; // s1 completed
        if (verifyCallCount === 2) return { status: "failed" as const, failureReason: "E_FAIL" }; // s2 failed
        return { status: "completed" as const }; // replacement step completed
      });
      const planReplan = vi.fn(async () => {
        // Return replacement step
        return [{
          id: "r1",
          objective: "replacement step",
          status: "pending" as const,
          completionPolicy: { allOf: [{ kind: "tool_succeeded" as const, capabilityId: "write_word" }] },
          toolCallCount: 0,
          retryCount: 0,
        }];
      });
      const respond = vi.fn(async () => "Plan completed (with replan)");

      const wrappedExecute = vi.fn(async (state, decision) => {
        currentStep = state.currentStepId ?? "s1";
        return execute(state, decision);
      });

      const result = await runAgentGraph({
        originalQuery: "test",
        contextualizedQuery: "test",
        citaContextBlock: "",
        messages: [{ role: "user", content: "test" }],
        availableCapabilities: ["web_search", "write_word"],
      }, { decide, execute: wrappedExecute, createPlan, route: planRoute, planVerify, planReplan, respond });

      // planReplan should be called once (after s2 fails)
      expect(planReplan).toHaveBeenCalledTimes(1);
      // plan should finally be completed
      expect(result.taskPlan?.status).toBe("completed");
      // replanCount should be 1
      expect(result.replanCount).toBe(1);
    });
  });
});
