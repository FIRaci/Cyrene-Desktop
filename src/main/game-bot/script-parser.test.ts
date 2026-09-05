// script-parser unit tests — YAML text -> GameRecipe parsing + validation.
import { describe, it, expect } from "vitest";
import { parseRecipe } from "./script-parser";

describe("parseRecipe", () => {
  it("parses valid complete script (including all primitives + nested branch)", () => {
    const yaml = [
      'name: star-rail-daily',
      'exe: "${exe_path}"',
      'model: "${vlm_config}"',
      'steps:',
      '  - launch: "${exe}"',
      '  - wait: 60s',
      '  - key: F4',
      '  - click: center',
      '  - vlm_click: { ref: download_btn, repeat: 3, interval: 1s }',
      '  - vlm_select: "First item in support list"',
      '  - vlm_check: { id: has_update, ask: "Is there an update dialog?" }',
      '  - vlm_compare: { id: st, ask: "Which one matches?", refs: [a, b] }',
      '  - branch:',
      '      if: "${has_update}"',
      '      then:',
      '        - click: center',
      '      else:',
      '        - key: ESC',
    ].join("\n");
    const r = parseRecipe(yaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.name).toBe("star-rail-daily");
    expect(r.recipe.steps).toHaveLength(9);
    expect(r.recipe.steps[0]).toEqual({ type: "launch", exe: "${exe}" });
    expect(r.recipe.steps[1]).toEqual({ type: "wait", ms: 60000 });
    expect(r.recipe.steps[2]).toEqual({ type: "key", combo: "F4" });
    expect(r.recipe.steps[3]).toEqual({ type: "click", target: "center" });
    expect(r.recipe.steps[4]).toEqual({
      type: "vlm_click", ref: "download_btn", repeat: 3, interval: 1000, retry: 2,
    });
    expect(r.recipe.steps[5]).toEqual({
      type: "vlm_select", desc: "First item in support list", retry: 2,
    });
    expect(r.recipe.steps[6]).toEqual({
      type: "vlm_check", id: "has_update", ask: "Is there an update dialog?",
    });
    expect(r.recipe.steps[7]).toEqual({
      type: "vlm_compare", id: "st", ask: "Which one matches?", refs: ["a", "b"],
    });
    const br = r.recipe.steps[8];
    expect(br.type).toBe("branch");
    if (br.type === "branch") {
      expect(br.if).toBe("${has_update}");
      expect(br.then).toEqual([{ type: "click", target: "center" }]);
      expect(br.else).toEqual([{ type: "key", combo: "ESC" }]);
    }
  });

  it("throws on missing name", () => {
    const r = parseRecipe("exe: x\nsteps: []");
    expect(r.ok).toBe(false);
  });

  it("throws on missing steps", () => {
    const r = parseRecipe("name: x\nexe: y");
    expect(r.ok).toBe(false);
  });

  it("throws on unknown primitive", () => {
    const r = parseRecipe("name: x\nexe: y\nsteps:\n  - unknown_op: foo");
    expect(r.ok).toBe(false);
  });

  it("treats pure number wait as ms", () => {
    const r = parseRecipe("name: x\nexe: y\nsteps:\n  - wait: 500");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.steps[0]).toEqual({ type: "wait", ms: 500 });
  });

  it("parses wait with ms unit", () => {
    const r = parseRecipe("name: x\nexe: y\nsteps:\n  - wait: 250ms");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.steps[0]).toEqual({ type: "wait", ms: 250 });
  });

  it("parses click coordinate format", () => {
    const r = parseRecipe("name: x\nexe: y\nsteps:\n  - click: { x: 100, y: 200 }");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.steps[0]).toEqual({ type: "click", target: { x: 100, y: 200 } });
  });

  it("throws when vlm_check lacks id", () => {
    const r = parseRecipe('name: x\nexe: y\nsteps:\n  - vlm_check: { ask: "Is it there?" }');
    expect(r.ok).toBe(false);
  });

  it("throws on invalid YAML", () => {
    const r = parseRecipe("name: x\n  bad: : :");
    expect(r.ok).toBe(false);
  });
});
