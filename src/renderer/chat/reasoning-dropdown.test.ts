import { describe, expect, test } from "vitest";
import { computeReasoningDropdown, formatReasoningTriggerLabel } from "./reasoning-dropdown";
import type { ReasoningPreference } from "../../shared/reasoning";

function labels(view: ReturnType<typeof computeReasoningDropdown>): string[] {
  return view.items.map(i => i.label);
}

function activeLabel(view: ReturnType<typeof computeReasoningDropdown>): string {
  const found = view.items.find(i =>
    JSON.stringify(i.preference) === JSON.stringify(view.activePreference),
  );
  return found?.label ?? "?";
}

describe("computeReasoningDropdown — ChatGPT", () => {
  test("gpt-5.6 + undefined saved → 7 items: Default / Off / Low / Medium / High / Very High / Max", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-5.6", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "Low", "Medium", "High", "Very High", "Max"]);
    expect(v.disabled).toBe(false);
    expect(v.statusText).toBe("Default"); // effective ≈ auto
    expect(v.items[0].disabled).toBeUndefined();
  });

  test("gpt-5.6 + {on, high} saved → activeLabel=High", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-5.6", { mode: "on", effort: "high" });
    expect(activeLabel(v)).toBe("High");
    expect(v.statusText).toBe("High");
  });

  test("gpt-5 + {on, minimal} saved → minimal included, activeLabel=Minimal", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-5", { mode: "on", effort: "minimal" });
    expect(labels(v)).toEqual(["Default", "Off", "Minimal", "Low", "Medium", "High"]);
    expect(activeLabel(v)).toBe("Minimal");
  });

  test("gpt-4o → disabled (fallback none)", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-4o", undefined);
    expect(v.disabled).toBe(true);
    expect(v.statusText).toBe("Default");
    expect(labels(v)).toEqual(["Default"]);
  });
});

describe("computeReasoningDropdown — Claude", () => {
  test("claude-sonnet-5 → Default / Off / Low / Medium / High / Very High / Max", () => {
    const v = computeReasoningDropdown("claude", "claude-sonnet-5", undefined);
    expect(v.disabled).toBe(false);
    expect(v.items[0].label).toBe("Default");
    expect(v.items[1].label).toBe("Off");
    expect(v.items[2].label).toBe("Low");
  });
});

describe("computeReasoningDropdown — DeepSeek", () => {
  test("deepseek-v4-pro → Default / Off / High / Max (effort=2)", () => {
    const v = computeReasoningDropdown("deepseek", "deepseek-v4-pro", undefined);
    expect(v.disabled).toBe(false);
    expect(labels(v)).toEqual(["Default", "Off", "High", "Max"]);
  });

  test("deepseek-v4-pro + {on, effort:max} → highlights Max", () => {
    const v = computeReasoningDropdown("deepseek", "deepseek-v4-pro", { mode: "on", effort: "max" });
    expect(activeLabel(v)).toBe("Max");
    expect(v.statusText).toBe("Max");
  });
});

describe("computeReasoningDropdown — GLM", () => {
  test("glm-5.2 → Default / Off / High / Max (effort=2)", () => {
    const v = computeReasoningDropdown("glm", "glm-5.2", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "High", "Max"]);
  });

  test("glm-4.7 → Default / Off / On (toggle only)", () => {
    const v = computeReasoningDropdown("glm", "glm-4.7", undefined);
    expect(v.disabled).toBe(false);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
  });
});

describe("computeReasoningDropdown — Qwen", () => {
  test("qwen3-max → Default / Off / On (toggle + qwen-enable-thinking)", () => {
    const v = computeReasoningDropdown("qwen", "qwen3-max", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
    expect(v.disabled).toBe(false);
  });

  test("qwen3-thinking → fixed-on, disabled, single item Always On", () => {
    const v = computeReasoningDropdown("qwen", "qwen3-thinking", { mode: "on" });
    expect(v.disabled).toBe(true);
    expect(v.statusText).toBe("Always On");
    expect(labels(v)).toEqual(["Always On"]);
    expect(v.items[0].disabled).toBe(true);
  });
});

describe("computeReasoningDropdown — Kimi", () => {
  test("kimi-k2.6 → Default / Off / On (toggle)", () => {
    const v = computeReasoningDropdown("kimi", "kimi-k2.6", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
  });

  test("kimi-k2.6 + {on} + computeReasoningDropdown → active=On", () => {
    const v = computeReasoningDropdown("kimi", "kimi-k2.6", { mode: "on" });
    expect(activeLabel(v)).toBe("On");
  });

  test("kimi-k2.7-code → fixed-on", () => {
    const v = computeReasoningDropdown("kimi", "kimi-k2.7-code", undefined);
    expect(v.disabled).toBe(true);
    expect(v.statusText).toBe("Always On");
    expect(labels(v)).toEqual(["Always On"]);
  });
});

describe("computeReasoningDropdown — MiniMax (anthropic-adaptive)", () => {
  test("MiniMax-M3 → Default / Off / On (toggle + anthropic-adaptive)", () => {
    const v = computeReasoningDropdown("minimax", "MiniMax-M3", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
    expect(v.disabled).toBe(false);
  });

  test("MiniMax-M2.7 → fixed-on", () => {
    const v = computeReasoningDropdown("minimax", "MiniMax-M2.7", undefined);
    expect(v.disabled).toBe(true);
    expect(v.statusText).toBe("Always On");
  });
});

describe("computeReasoningDropdown — MiMo", () => {
  test("mimo-v2.5-pro → Default / Off / On (toggle)", () => {
    const v = computeReasoningDropdown("mimo", "mimo-v2.5-pro", undefined);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
  });
});

describe("computeReasoningDropdown — Doubao", () => {
  test("doubao-seed-2-1 → selects Default, Off, or On", () => {
    const v = computeReasoningDropdown("doubao", "doubao-seed-2-1-pro-260628", undefined);
    expect(v.disabled).toBe(false);
    expect(labels(v)).toEqual(["Default", "Off", "On"]);
  });
});

describe("computeReasoningDropdown — Unknown Model", () => {
  test("unknown → disabled, single item Default", () => {
    const v = computeReasoningDropdown("unknown", "anything", undefined);
    expect(v.disabled).toBe(true);
    expect(v.statusText).toBe("Default");
    expect(labels(v)).toEqual(["Default"]);
  });
});

describe("computeReasoningDropdown — saved invariant", () => {
  test("saved effort='max' but model only supports high → active highlight is Max", () => {
    const saved: ReasoningPreference = { mode: "on", effort: "max" };
    const v = computeReasoningDropdown("deepseek", "deepseek-v4-pro", saved);
    expect(activeLabel(v)).toBe("Max");
    const saved2: ReasoningPreference = { mode: "on", effort: "low" };
    const v2 = computeReasoningDropdown("deepseek", "deepseek-v4-pro", saved2);
    expect(v2.activePreference.effort).toBe("high");
    expect(activeLabel(v2)).toBe("High");
    expect(saved2).toEqual({ mode: "on", effort: "low" });
  });

  test("fixed-on model: saved=off → effective=on → activeLabel=Always On", () => {
    const saved: ReasoningPreference = { mode: "off" };
    const v = computeReasoningDropdown("qwen", "qwen3-thinking", saved);
    expect(v.activePreference.mode).toBe("on");
    expect(v.items.length).toBe(1);
    expect(saved).toEqual({ mode: "off" });
  });
});

describe("formatReasoningTriggerLabel", () => {
  test("Default → Reasoning · Default", () => {
    expect(formatReasoningTriggerLabel("Default")).toBe("Reasoning · Default");
  });
  test("High → Reasoning · High", () => {
    expect(formatReasoningTriggerLabel("High")).toBe("Reasoning · High");
  });
  test("Always On → Reasoning · Always On", () => {
    expect(formatReasoningTriggerLabel("Always On")).toBe("Reasoning · Always On");
  });
});

describe("computeReasoningDropdown — resolveEffectiveReasoning full path", () => {
  test("auto + capability.effort → active is defaultEffort", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-5.6", { mode: "auto" });
    expect(v.statusText).toBe("Default");
  });

  test("off + supportsDisable=true → active is off → statusText = Off", () => {
    const v = computeReasoningDropdown("deepseek", "deepseek-v4-pro", { mode: "off" });
    expect(v.statusText).toBe("Off");
  });

  test("on + no effort → defaultEffort", () => {
    const v = computeReasoningDropdown("chatgpt", "gpt-5.6", { mode: "on" });
    expect(v.statusText).toBe("Medium"); // defaultEffort = "medium"
    expect(activeLabel(v)).toBe("Medium");
  });
});
