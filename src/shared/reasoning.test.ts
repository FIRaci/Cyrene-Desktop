import { describe, expect, test } from "vitest";
import {
  MODEL_REASONING_RULES,
  normalizeReasoningPreference,
  resolveEffectiveReasoning,
  resolveReasoningCapability,
  type ReasoningCapability,
  type ReasoningPreference,
} from "./reasoning";

// ── A. Rule Match Priority ──────────────────────────────────────

describe("MODEL_REASONING_RULES — Rule Match Priority", () => {
  test("Qwen qwen3-thinking matches /-thinking$/ -> fixed-on", () => {
    const cap = resolveReasoningCapability("qwen", "qwen3-thinking");
    expect(cap.control).toBe("fixed-on");
  });

  test("Qwen qwen3-max-thinking matches /-thinking$/ -> fixed-on (suffix -thinking)", () => {
    const cap = resolveReasoningCapability("qwen", "qwen3-max-thinking");
    expect(cap.control).toBe("fixed-on");
  });

  test("Qwen qwen3-max matches /^qwen3/ -> toggle (does not match /-thinking$/)", () => {
    const cap = resolveReasoningCapability("qwen", "qwen3-max");
    expect(cap.control).toBe("toggle");
  });

  test("Qwen qwen-max-thinking matches /-thinking$/ -> fixed-on", () => {
    const cap = resolveReasoningCapability("qwen", "qwen-max-thinking");
    expect(cap.control).toBe("fixed-on");
  });

  test("Kimi kimi-k2.6 matches exact K2.6 regex", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.6");
    expect(cap.control).toBe("toggle");
    expect(cap.keepOnTools).toBe(true);
  });

  test("Kimi kimi-k2.5 matches exact K2.5 regex with keepOnTools=false", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.5");
    expect(cap.control).toBe("toggle");
    expect(cap.keepOnTools).toBe(false);
  });

  test("Kimi kimi-k2.7-code matches exact K2.7-Code with control=fixed-on", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.7-code");
    expect(cap.control).toBe("fixed-on");
  });

  test("Kimi kimi-k2.7-code-highspeed matches exact K2.7-Code-HighSpeed with control=fixed-on", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.7-code-highspeed");
    expect(cap.control).toBe("fixed-on");
  });

  test("Kimi kimi-k2.5 is not erroneously matched by generic kimi-k2-thinking family", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.5");
    // If matched by kimi-k2-thinking it would be fixed-on; actual K2.5 is toggle
    expect(cap.control).toBe("toggle");
    expect(cap.control).not.toBe("fixed-on");
  });

  test("MiniMax MiniMax-M3 uses anthropic-adaptive (not thinking-type)", () => {
    const cap = resolveReasoningCapability("minimax", "MiniMax-M3");
    expect(cap.control).toBe("toggle");
    expect(cap.requestStyle).toBe("anthropic-adaptive");
  });

  test("Fallback: unknown model -> { control: 'none', requestStyle: 'none', supportsDisable: false }", () => {
    const cap = resolveReasoningCapability("unknown-provider", "anything");
    expect(cap.control).toBe("none");
    expect(cap.requestStyle).toBe("none");
    expect(cap.supportsDisable).toBe(false);
  });
});

// ── B. All 9 Vendors Presence ──────────────────────────────────────

describe("MODEL_REASONING_RULES — All 9 Vendors Presence", () => {
  test("chatgpt gpt-5.6 -> effort + openai-effort + supportedEfforts includes max", () => {
    const cap = resolveReasoningCapability("chatgpt", "gpt-5.6");
    expect(cap.control).toBe("effort");
    expect(cap.requestStyle).toBe("openai-effort");
    expect(cap.supportedEfforts).toContain("max");
    expect(cap.supportsDisable).toBe(true);
  });

  test("chatgpt gpt-5 -> effort + supportedEfforts includes minimal", () => {
    const cap = resolveReasoningCapability("chatgpt", "gpt-5");
    expect(cap.supportedEfforts).toContain("minimal");
  });

  test("chatgpt o1 → effort + supportedEfforts", () => {
    const cap = resolveReasoningCapability("chatgpt", "o1-preview");
    expect(cap.control).toBe("effort");
  });

  test("chatgpt o3 → effort", () => {
    const cap = resolveReasoningCapability("chatgpt", "o3-mini");
    expect(cap.control).toBe("effort");
  });

  test("chatgpt o4 → effort", () => {
    const cap = resolveReasoningCapability("chatgpt", "o4");
    expect(cap.control).toBe("effort");
  });

  test("chatgpt gpt-4o fallback -> none", () => {
    const cap = resolveReasoningCapability("chatgpt", "gpt-4o");
    expect(cap.control).toBe("none");
  });

  test("claude claude-fable-5 -> toggle-effort + anthropic-adaptive", () => {
    const cap = resolveReasoningCapability("claude", "claude-fable-5");
    expect(cap.control).toBe("toggle-effort");
    expect(cap.requestStyle).toBe("anthropic-adaptive");
    expect(cap.supportedEfforts).toContain("max");
  });

  test("claude claude-sonnet-5 → toggle-effort + anthropic-adaptive", () => {
    const cap = resolveReasoningCapability("claude", "claude-sonnet-5");
    expect(cap.control).toBe("toggle-effort");
    expect(cap.requestStyle).toBe("anthropic-adaptive");
  });

  test("deepseek deepseek-v4-pro → toggle-effort + thinking-type + [high,max]", () => {
    const cap = resolveReasoningCapability("deepseek", "deepseek-v4-pro");
    expect(cap.control).toBe("toggle-effort");
    expect(cap.supportedEfforts).toEqual(["high", "max"]);
  });

  test("glm glm-5.2 → toggle-effort + [high,max]", () => {
    const cap = resolveReasoningCapability("glm", "glm-5.2");
    expect(cap.control).toBe("toggle-effort");
    expect(cap.supportedEfforts).toEqual(["high", "max"]);
  });

  test("glm glm-4.7 → toggle only", () => {
    const cap = resolveReasoningCapability("glm", "glm-4.7");
    expect(cap.control).toBe("toggle");
    expect(cap.supportedEfforts).toBeUndefined();
  });

  test("qwen qwen3-max → toggle + qwen-enable-thinking", () => {
    const cap = resolveReasoningCapability("qwen", "qwen3-max");
    expect(cap.control).toBe("toggle");
    expect(cap.requestStyle).toBe("qwen-enable-thinking");
  });

  test("qwen qwen3-thinking → fixed-on", () => {
    const cap = resolveReasoningCapability("qwen", "qwen3-thinking");
    expect(cap.control).toBe("fixed-on");
  });

  test("kimi kimi-k2.5 → toggle", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.5");
    expect(cap.control).toBe("toggle");
  });

  test("kimi kimi-k2.6 → toggle + keepOnTools=true", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.6");
    expect(cap.control).toBe("toggle");
    expect(cap.keepOnTools).toBe(true);
  });

  test("kimi kimi-k2.7-code → fixed-on + requestStyle=none", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.7-code");
    expect(cap.control).toBe("fixed-on");
    expect(cap.requestStyle).toBe("none");
  });

  test("kimi kimi-k2.7-code-highspeed → fixed-on + requestStyle=none", () => {
    const cap = resolveReasoningCapability("kimi", "kimi-k2.7-code-highspeed");
    expect(cap.control).toBe("fixed-on");
    expect(cap.requestStyle).toBe("none");
  });

  test("minimax MiniMax-M3 → toggle + anthropic-adaptive", () => {
    const cap = resolveReasoningCapability("minimax", "MiniMax-M3");
    expect(cap.requestStyle).toBe("anthropic-adaptive");
  });

  test("minimax MiniMax-M2.7 → fixed-on", () => {
    const cap = resolveReasoningCapability("minimax", "MiniMax-M2.7");
    expect(cap.control).toBe("fixed-on");
  });

  test("mimo mimo-v2.5-pro → toggle + thinking-type", () => {
    const cap = resolveReasoningCapability("mimo", "mimo-v2.5-pro");
    expect(cap.control).toBe("toggle");
    expect(cap.requestStyle).toBe("thinking-type");
  });

  test("doubao seed 2.1 → toggle + thinking-type", () => {
    const cap = resolveReasoningCapability("doubao", "doubao-seed-2-1-pro-260628");
    expect(cap.control).toBe("toggle");
    expect(cap.requestStyle).toBe("thinking-type");
    expect(cap.supportsDisable).toBe(true);
  });

  test("unknown provider + any model -> none", () => {
    const cap = resolveReasoningCapability("unknown", "anything");
    expect(cap.control).toBe("none");
  });
});

// ── C. normalize Allowlist ──────────────────────────────────────

describe("normalizeReasoningPreference — Allowlist", () => {
  test("fully valid -> as-is", () => {
    expect(normalizeReasoningPreference({ mode: "on", effort: "high" }))
      .toEqual({ mode: "on", effort: "high" });
  });

  test("mode not in allowlist -> undefined", () => {
    expect(normalizeReasoningPreference({ mode: "banana", effort: "high" }))
      .toBeUndefined();
  });

  test("effort not in allowlist -> mode kept, effort discarded", () => {
    expect(normalizeReasoningPreference({ mode: "on", effort: "ultra" }))
      .toEqual({ mode: "on" });
  });

  test("effort omitted -> return mode only", () => {
    expect(normalizeReasoningPreference({ mode: "auto" }))
      .toEqual({ mode: "auto" });
  });

  test("effort is null -> return mode only", () => {
    expect(normalizeReasoningPreference({ mode: "off", effort: null }))
      .toEqual({ mode: "off" });
  });

  test("completely invalid object (null) -> undefined", () => {
    expect(normalizeReasoningPreference(null)).toBeUndefined();
  });

  test("completely invalid object (undefined) -> undefined", () => {
    expect(normalizeReasoningPreference(undefined)).toBeUndefined();
  });

  test("non-object (string) -> undefined", () => {
    expect(normalizeReasoningPreference("on")).toBeUndefined();
  });

  test("mode omitted -> undefined", () => {
    expect(normalizeReasoningPreference({ effort: "high" })).toBeUndefined();
  });

  test("valid effort (one of 6 values) -> preserved", () => {
    for (const e of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
      expect(normalizeReasoningPreference({ mode: "on", effort: e }))
        .toEqual({ mode: "on", effort: e });
    }
  });
});

// ── D. resolveEffectiveReasoning ──────────────────────────────────────

describe("resolveEffectiveReasoning", () => {
  const fixedOnCap: ReasoningCapability = {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  };
  const toggleEffortCap: ReasoningCapability = {
    control: "toggle-effort",
    supportedEfforts: ["high", "max"],
    defaultEffort: "high",
    requestStyle: "thinking-type",
    supportsDisable: true,
  };
  const toggleEffortNoDisableCap: ReasoningCapability = {
    control: "toggle-effort",
    supportedEfforts: ["high", "max"],
    defaultEffort: "high",
    requestStyle: "thinking-type",
    supportsDisable: false,
  };
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
  const toggleCap: ReasoningCapability = {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  };

  test("none + any → { mode: 'auto' }", () => {
    expect(resolveEffectiveReasoning({ mode: "on" }, noneCap))
      .toEqual({ mode: "auto" });
  });

  test("dynamic + any → { mode: 'auto' }", () => {
    expect(resolveEffectiveReasoning({ mode: "on" }, dynamicCap))
      .toEqual({ mode: "auto" });
  });

  test("fixed-on + { mode: 'auto' } → { mode: 'on' }", () => {
    expect(resolveEffectiveReasoning({ mode: "auto" }, fixedOnCap))
      .toEqual({ mode: "on" });
  });

  test("fixed-on + { mode: 'off' } → { mode: 'on' }", () => {
    expect(resolveEffectiveReasoning({ mode: "off" }, fixedOnCap))
      .toEqual({ mode: "on" });
  });

  test("fixed-on + { mode: 'on' } → { mode: 'on' }", () => {
    expect(resolveEffectiveReasoning({ mode: "on" }, fixedOnCap))
      .toEqual({ mode: "on" });
  });

  test("fixed-on ignores pref.effort (discards even if pref contains effort)", () => {
    const result = resolveEffectiveReasoning(
      { mode: "off", effort: "high" },
      fixedOnCap,
    );
    expect(result).toEqual({ mode: "on" });
    expect(result.effort).toBeUndefined();
  });

  test("toggle-effort + supportsDisable=false + { mode: 'off' } -> { mode: 'off' }", () => {
    expect(resolveEffectiveReasoning({ mode: "off" }, toggleEffortNoDisableCap))
      .toEqual({ mode: "off" });
  });

  test("toggle-effort + { mode: 'on', effort: 'max' } + supportedEfforts=[high] → { mode: 'on', effort: 'high' }", () => {
    // supportedEfforts does not contain max
    const capWithoutMax: ReasoningCapability = {
      ...toggleEffortCap,
      supportedEfforts: ["high"],
      defaultEffort: "high",
    };
    expect(resolveEffectiveReasoning({ mode: "on", effort: "max" }, capWithoutMax))
      .toEqual({ mode: "on", effort: "high" });
  });

  test("toggle-effort + { mode: 'on', effort: 'xhigh' } + supportedEfforts=[high,max] -> { mode: 'on', effort: 'xhigh' } (preserved)", () => {
    const cap: ReasoningCapability = {
      ...toggleEffortCap,
      supportedEfforts: ["high", "max", "xhigh"],
    };
    expect(resolveEffectiveReasoning({ mode: "on", effort: "xhigh" }, cap))
      .toEqual({ mode: "on", effort: "xhigh" });
  });

  test("toggle-effort + { mode: 'on' } + defaultEffort='high' -> { mode: 'on', effort: 'high' } (defaults filled)", () => {
    expect(resolveEffectiveReasoning({ mode: "on" }, toggleEffortCap))
      .toEqual({ mode: "on", effort: "high" });
  });

  test("toggle + { mode: 'auto', effort: 'high' } -> { mode: 'auto' } (effort discarded when mode !== on)", () => {
    expect(resolveEffectiveReasoning({ mode: "auto", effort: "high" }, toggleCap))
      .toEqual({ mode: "auto" });
  });

  test("toggle + { mode: 'off', effort: 'high' } -> { mode: 'off' } (effort discarded when mode !== on)", () => {
    expect(resolveEffectiveReasoning({ mode: "off", effort: "high" }, toggleCap))
      .toEqual({ mode: "off" });
  });

  test("preference omitted -> treated as { mode: 'auto' }", () => {
    expect(resolveEffectiveReasoning(undefined, toggleCap))
      .toEqual({ mode: "auto" });
  });

  test("saved and effective desynchronized: saved retains original effort", () => {
    const saved: ReasoningPreference = { mode: "on", effort: "max" };
    const cap: ReasoningCapability = {
      control: "toggle-effort",
      supportedEfforts: ["high"],
      defaultEffort: "high",
      requestStyle: "thinking-type",
      supportsDisable: true,
    };
    // effective substituted defaultEffort "high" for "max"
    expect(resolveEffectiveReasoning(saved, cap)).toEqual({ mode: "on", effort: "high" });
    // saved unchanged
    expect(saved).toEqual({ mode: "on", effort: "max" });
  });
});

// ── E. Rules Table Data Integrity ──────────────────────────────────────

describe("MODEL_REASONING_RULES — Data Integrity", () => {
  test("all providerId values match capabilities.ts id values", () => {
    const known = new Set([
      "chatgpt", "claude", "deepseek", "glm", "kimi",
      "qwen", "minimax", "mimo", "doubao",
    ]);
    const providerIds = new Set(MODEL_REASONING_RULES.map(r => r.providerId));
    for (const id of providerIds) {
      expect(known.has(id), `Unknown providerId: ${id}`).toBe(true);
    }
  });

  test("every capability has a supportsDisable field", () => {
    for (const rule of MODEL_REASONING_RULES) {
      expect(typeof rule.capability.supportsDisable).toBe("boolean");
    }
  });

  test("regexes do not have g flag to avoid .test() state pollution", () => {
    for (const rule of MODEL_REASONING_RULES) {
      expect(rule.modelPattern.flags.includes("g")).toBe(false);
    }
  });
});

// ── F. foldReasoning Tri-state + Priority ──

import { foldReasoning } from "./reasoning";

describe("foldReasoning — Persistence Fold", () => {
  test("H1 omitted (hasIncomingKey=false) -> keep old value", () => {
    const existing = { mode: "on" as const, effort: "high" as const };
    expect(foldReasoning(undefined, existing, false)).toEqual(existing);
  });

  test("H1b omitted + existing is undefined -> return undefined", () => {
    expect(foldReasoning(undefined, undefined, false)).toBeUndefined();
  });

  test("H2 explicit auto -> persisted as {mode:'auto'}, clearing old effort", () => {
    const existing = { mode: "on" as const, effort: "high" as const };
    expect(foldReasoning({ mode: "auto" }, existing, true)).toEqual({ mode: "auto" });
  });

  test("H3 invalid value -> keeps old value to prevent overwrite", () => {
    const existing = { mode: "on" as const, effort: "high" as const };
    expect(foldReasoning({ mode: "banana" }, existing, true)).toEqual(existing);
    expect(foldReasoning("not an object", existing, true)).toEqual(existing);
  });

  test("H3b valid mode + invalid effort -> normalized to {mode}, clearing invalid effort", () => {
    const existing = { mode: "on" as const, effort: "high" as const };
    expect(foldReasoning({ mode: "on", effort: "ultra" }, existing, true)).toEqual({ mode: "on" });
  });

  test("H4 explicit undefined/null -> treated as user clear, returns undefined", () => {
    expect(foldReasoning(undefined, { mode: "on" as const, effort: "high" as const }, true))
      .toBeUndefined();
    expect(foldReasoning(null, { mode: "on" as const, effort: "high" as const }, true))
      .toBeUndefined();
  });

  test("H5 perProfile takes precedence over top-level reasoning", () => {
    // Simulate saveModelSettings decision: when perProfile.reasoning exists -> select perProfile
    const perProfileReasoning = { mode: "off" as const };
    const topLevelReasoning = { mode: "on" as const, effort: "low" as const };
    const existing = { mode: "auto" as const };

    // Decision 1: select perProfile -> foldReasoning(perProfileReasoning, existing, true)
    const r1 = foldReasoning(perProfileReasoning, existing, true);
    expect(r1).toEqual({ mode: "off" });

    // Decision 2: no perProfile then select topLevel -> foldReasoning(topLevelReasoning, existing, true)
    const r2 = foldReasoning(topLevelReasoning, existing, true);
    expect(r2).toEqual({ mode: "on", effort: "low" });

    // Decision 3: neither selected -> foldReasoning(undefined, existing, false) -> keep old value
    const r3 = foldReasoning(undefined, existing, false);
    expect(r3).toEqual(existing);
  });

  test("H6 top-level reasoning takes effect when no perProfile write occurs", () => {
    const topLevel = { mode: "on" as const, effort: "low" as const };
    const existing = undefined;
    // Simulate decision: incomingProfileForReasoning has no reasoning -> hasProfileReasoning=false,
    // top-level settings.reasoning exists -> hasTopLevelReasoning=true
    // → foldReasoning(topLevel, undefined, true)
    expect(foldReasoning(topLevel, existing, true)).toEqual({ mode: "on", effort: "low" });
  });
});
