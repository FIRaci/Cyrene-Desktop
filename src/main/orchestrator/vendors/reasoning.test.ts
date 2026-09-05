import { describe, expect, test } from "vitest";
import { applyReasoningPreference } from "./reasoning";
import type { ReasoningCapability } from "../../../shared/reasoning";

const ctx = { hasTools: false, providerId: "test", model: "test-model" };
const ctxWithTools = { hasTools: true, providerId: "test", model: "test-model" };

const noneCap: ReasoningCapability = {
  control: "none",
  requestStyle: "none",
  supportsDisable: false,
};

const dynamicCap: ReasoningCapability = {
  control: "dynamic",
  requestStyle: "none",
  supportsDisable: false,
};

const fixedOnThinkingCap: ReasoningCapability = {
  control: "fixed-on",
  requestStyle: "thinking-type",
  supportsDisable: false,
};

const fixedOnNoneCap: ReasoningCapability = {
  control: "fixed-on",
  requestStyle: "none",
  supportsDisable: false,
};

const fixedOnAdaptiveCap: ReasoningCapability = {
  control: "fixed-on",
  requestStyle: "anthropic-adaptive",
  supportsDisable: false,
};

const toggleQwenCap: ReasoningCapability = {
  control: "toggle",
  requestStyle: "qwen-enable-thinking",
  supportsDisable: true,
};

const toggleThinkingKeepCap: ReasoningCapability = {
  control: "toggle",
  requestStyle: "thinking-type",
  supportsDisable: true,
  keepOnTools: true,
};

const toggleThinkingNoKeepCap: ReasoningCapability = {
  control: "toggle",
  requestStyle: "thinking-type",
  supportsDisable: true,
  keepOnTools: false,
};

const toggleAdaptiveCap: ReasoningCapability = {
  control: "toggle",
  requestStyle: "anthropic-adaptive",
  supportsDisable: true,
};

const effortDisableCap: ReasoningCapability = {
  control: "effort",
  supportedEfforts: ["high", "max"],
  defaultEffort: "high",
  requestStyle: "openai-effort",
  supportsDisable: true,
};

const effortNoDisableCap: ReasoningCapability = {
  control: "effort",
  supportedEfforts: ["high", "max"],
  defaultEffort: "high",
  requestStyle: "openai-effort",
  supportsDisable: false,
};

const toggleEffortAnthropicCap: ReasoningCapability = {
  control: "toggle-effort",
  supportedEfforts: ["low", "medium", "high"],
  defaultEffort: "high",
  requestStyle: "anthropic-adaptive",
  supportsDisable: true,
};

describe("applyReasoningPreference -- auto path", () => {
  test("auto + any control -> does not add fields", () => {
    const body = { model: "x", messages: [] };
    expect(applyReasoningPreference(body, { mode: "auto" }, noneCap, ctx)).toEqual(body);
    expect(applyReasoningPreference(body, { mode: "auto" }, toggleQwenCap, ctx)).toEqual(body);
    expect(applyReasoningPreference(body, { mode: "auto" }, toggleAdaptiveCap, ctx)).toEqual(body);
  });

  test("does not mutate input params (snapshot)", () => {
    const body = { model: "x", messages: [] };
    const snapshot = { ...body };
    applyReasoningPreference(body, { mode: "on" }, toggleAdaptiveCap, ctx);
    expect(body).toEqual(snapshot);
  });
});

describe("applyReasoningPreference — none / dynamic", () => {
  test("none + any mode -> body unchanged", () => {
    const body = { messages: [] };
    expect(applyReasoningPreference(body, { mode: "on" }, noneCap, ctx)).toEqual(body);
    expect(applyReasoningPreference(body, { mode: "off" }, noneCap, ctx)).toEqual(body);
  });

  test("dynamic + any mode -> body unchanged", () => {
    const body = { messages: [] };
    expect(applyReasoningPreference(body, { mode: "on" }, dynamicCap, ctx)).toEqual(body);
    expect(applyReasoningPreference(body, { mode: "off" }, dynamicCap, ctx)).toEqual(body);
  });
});

describe("applyReasoningPreference -- fixed-on normalization", () => {
  test("fixed-on + thinking-type + off -> effective=on, injects { type: 'enabled' }", () => {
    const body = {};
    const result = applyReasoningPreference(body, { mode: "off" }, fixedOnThinkingCap, ctx);
    expect(result).toEqual({ thinking: { type: "enabled" } });
  });

  test("fixed-on + requestStyle=none + off -> body unchanged (K2.7-Code path)", () => {
    const body = { messages: [] };
    expect(applyReasoningPreference(body, { mode: "off" }, fixedOnNoneCap, ctx)).toEqual(body);
  });

  test("fixed-on + anthropic-adaptive + auto -> injects { type: 'adaptive' }", () => {
    const body = {};
    const result = applyReasoningPreference(body, { mode: "auto" }, fixedOnAdaptiveCap, ctx);
    expect(result).toEqual({ thinking: { type: "adaptive" } });
  });

  test("fixed-on + on -> injects enable field", () => {
    const body = {};
    const result = applyReasoningPreference(body, { mode: "on" }, fixedOnAdaptiveCap, ctx);
    expect(result).toEqual({ thinking: { type: "adaptive" } });
  });
});

describe("applyReasoningPreference — toggle", () => {
  test("qwen + on → enable_thinking: true", () => {
    expect(applyReasoningPreference({}, { mode: "on" }, toggleQwenCap, ctx))
      .toEqual({ enable_thinking: true });
  });

  test("qwen + off → enable_thinking: false", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, toggleQwenCap, ctx))
      .toEqual({ enable_thinking: false });
  });

  test("thinking-type + on → { type: 'enabled' }", () => {
    expect(applyReasoningPreference({}, { mode: "on" }, toggleThinkingNoKeepCap, ctx))
      .toEqual({ thinking: { type: "enabled" } });
  });

  test("thinking-type + on + keepOnTools=true + hasTools -> { type: 'enabled', keep: 'all' } (K2.6 path)", () => {
    expect(applyReasoningPreference({}, { mode: "on" }, toggleThinkingKeepCap, ctxWithTools))
      .toEqual({ thinking: { type: "enabled", keep: "all" } });
  });

  test("thinking-type + on + keepOnTools=false + hasTools -> no keep (K2.5 path)", () => {
    expect(applyReasoningPreference({}, { mode: "on" }, toggleThinkingNoKeepCap, ctxWithTools))
      .toEqual({ thinking: { type: "enabled" } });
  });

  test("thinking-type + off → { type: 'disabled' }", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, toggleThinkingNoKeepCap, ctx))
      .toEqual({ thinking: { type: "disabled" } });
  });

  test("anthropic-adaptive (MiniMax-M3) + on -> { type: 'adaptive' } (not enabled)", () => {
    expect(applyReasoningPreference({}, { mode: "on" }, toggleAdaptiveCap, ctx))
      .toEqual({ thinking: { type: "adaptive" } });
  });

  test("anthropic-adaptive（MiniMax-M3）+ off → { type: 'disabled' }", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, toggleAdaptiveCap, ctx))
      .toEqual({ thinking: { type: "disabled" } });
  });
});

describe("applyReasoningPreference -- effort / supportsDisable", () => {
  test("effort + on + effort in supportedEfforts -> reasoning_effort field", () => {
    expect(applyReasoningPreference({}, { mode: "on", effort: "max" }, effortDisableCap, ctx))
      .toEqual({ reasoning_effort: "max" });
  });

  test("effort + on + effort not in supportedEfforts -> reasoning_effort uses defaultEffort", () => {
    // Simulate preference after fallback from 'max' to 'high'
    expect(applyReasoningPreference({}, { mode: "on", effort: "high" }, effortDisableCap, ctx))
      .toEqual({ reasoning_effort: "high" });
  });

  test("effort + off + supportsDisable=true → reasoning_effort: 'none'", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, effortDisableCap, ctx))
      .toEqual({ reasoning_effort: "none" });
  });

  test("effort + off + supportsDisable=false -> body unchanged (GPT-5.6 path)", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, effortNoDisableCap, ctx))
      .toEqual({});
  });
});

describe("applyReasoningPreference — toggle-effort", () => {
  test("anthropic-adaptive + on -> output_config.effort merges with existing output_config", () => {
    const body = { output_config: { other_field: "keep_me" } };
    // cap.supportedEfforts = [low, medium, high], high is listed
    expect(applyReasoningPreference(body, { mode: "on", effort: "high" }, toggleEffortAnthropicCap, ctx))
      .toEqual({
        output_config: { other_field: "keep_me", effort: "high" },
        thinking: { type: "adaptive" },
      });
  });

  test("anthropic-adaptive + on + effort not in supportedEfforts -> safety net falls back to defaultEffort", () => {
    const body = {};
    // xhigh is not in [low, medium, high]
    expect(applyReasoningPreference(body, { mode: "on", effort: "xhigh" }, toggleEffortAnthropicCap, ctx))
      .toEqual({
        output_config: { effort: "high" },
        thinking: { type: "adaptive" },
      });
  });

  test("anthropic-adaptive + on + no output_config -> sets effort directly", () => {
    expect(applyReasoningPreference({}, { mode: "on", effort: "high" }, toggleEffortAnthropicCap, ctx))
      .toEqual({
        output_config: { effort: "high" },
        thinking: { type: "adaptive" },
      });
  });

  test("anthropic-adaptive + off -> thinking.type=disabled, does not send effort", () => {
    expect(applyReasoningPreference({}, { mode: "off" }, toggleEffortAnthropicCap, ctx))
      .toEqual({ thinking: { type: "disabled" } });
  });

  test("thinking-type + on → thinking.enabled + reasoning_effort", () => {
    const cap: ReasoningCapability = {
      control: "toggle-effort",
      supportedEfforts: ["high", "max"],
      defaultEffort: "high",
      requestStyle: "thinking-type",
      supportsDisable: true,
    };
    expect(applyReasoningPreference({}, { mode: "on", effort: "max" }, cap, ctx))
      .toEqual({
        thinking: { type: "enabled" },
        reasoning_effort: "max",
      });
  });
});

describe("applyReasoningPreference -- merge with existing fields", () => {
  test("anthropic output_config existing fields are not overwritten", () => {
    const body = {
      output_config: { format: "json", effort: "old" },
    };
    const result = applyReasoningPreference(
      body,
      { mode: "on", effort: "high" },
      toggleEffortAnthropicCap,
      ctx,
    );
    expect((result.output_config as Record<string, unknown>).format).toBe("json");
    expect((result.output_config as Record<string, unknown>).effort).toBe("high");
  });

  test("existing body fields are preserved", () => {
    const body = { model: "x", messages: [{ role: "user", content: "hi" }] };
    const result = applyReasoningPreference(body, { mode: "on" }, toggleAdaptiveCap, ctx);
    expect(result.model).toBe("x");
    expect(result.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.thinking).toEqual({ type: "adaptive" });
  });
});