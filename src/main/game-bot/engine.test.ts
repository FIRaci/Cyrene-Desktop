// engine unit tests — mock BotTools verifying step execution/branching/variables/settle/retry/abort.
import { describe, it, expect, vi } from "vitest";
import { runRecipe } from "./engine";
import type { BotTools } from "./bot-tools";
import { parseRecipe } from "./script-parser";

function mockTools(overrides: Partial<BotTools> = {}): BotTools {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue({ base64: "x", mime: "image/png", width: 1000, height: 1000 }),
    click: vi.fn().mockResolvedValue(undefined),
    clickCenter: vi.fn().mockResolvedValue(undefined),
    key: vi.fn().mockResolvedValue(undefined),
    locate: vi.fn().mockResolvedValue(null),
    select: vi.fn().mockResolvedValue(null),
    check: vi.fn().mockResolvedValue(null),
    compare: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function recipe(yaml: string) {
  const r = parseRecipe(yaml);
  if (!r.ok) throw new Error(r.error);
  return r.recipe;
}

const noSleep = vi.fn().mockResolvedValue(undefined);

describe("runRecipe", () => {
  it("launch injects variables and calls tools.launch", async () => {
    const tools = mockTools();
    const r = recipe('name: x\nexe: y\nsteps:\n  - launch: "${exe_path}"');
    await runRecipe(r, { tools, vars: { exe_path: "C:/game.exe" }, sleep: noSleep });
    expect(tools.launch).toHaveBeenCalledWith("C:/game.exe");
  });

  it("wait calls sleep", async () => {
    const tools = mockTools();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = recipe('name: x\nexe: y\nsteps:\n  - wait: 60s');
    await runRecipe(r, { tools, sleep });
    expect(sleep).toHaveBeenCalledWith(60000);
  });

  it("vlm_click clicks on successful location", async () => {
    const tools = mockTools({ locate: vi.fn().mockResolvedValue({ x: 100, y: 200 }) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_click: { ref: btn }');
    await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.locate).toHaveBeenCalledWith("btn", undefined);
    expect(tools.click).toHaveBeenCalledWith(100, 200);
  });

  it("vlm_click gives up after retrying retry times on failure", async () => {
    const tools = mockTools({ locate: vi.fn().mockResolvedValue(null) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_click: { ref: btn, retry: 2 }');
    const res = await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.locate).toHaveBeenCalledTimes(3);
    expect(tools.click).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it("vlm_click repeats click 3 times", async () => {
    const tools = mockTools({ locate: vi.fn().mockResolvedValue({ x: 5, y: 5 }) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_click: { ref: btn, repeat: 3, interval: 1s }');
    await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.click).toHaveBeenCalledTimes(3);
  });

  it("vlm_check binds variable for branch then execution", async () => {
    const tools = mockTools({ check: vi.fn().mockResolvedValue(true) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_check: { id: has_update, ask: "is there an update" }\n  - branch:\n      if: "${has_update}"\n      then:\n        - key: F4\n      else:\n        - key: ESC');
    await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.key).toHaveBeenCalledWith("F4");
    expect(tools.key).not.toHaveBeenCalledWith("ESC");
  });

  it("runs else branch when condition is false", async () => {
    const tools = mockTools({ check: vi.fn().mockResolvedValue(false) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_check: { id: fl, ask: "x" }\n  - branch:\n      if: "${fl}"\n      then:\n        - key: F4\n      else:\n        - key: ESC');
    await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.key).toHaveBeenCalledWith("ESC");
  });

  it("evaluates vlm_compare == expression branch", async () => {
    const tools = mockTools({ compare: vi.fn().mockResolvedValue(1) });
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_compare: { id: st, ask: "x", refs: [a, b] }\n  - branch:\n      if: "${st == 1}"\n      then:\n        - key: V');
    await runRecipe(r, { tools, sleep: noSleep });
    expect(tools.key).toHaveBeenCalledWith("V");
  });

  it("executes settle sleep before vlm_*", async () => {
    const tools = mockTools({ locate: vi.fn().mockResolvedValue({ x: 1, y: 1 }) });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = recipe('name: x\nexe: y\nsteps:\n  - vlm_click: { ref: btn }');
    await runRecipe(r, { tools, sleep, settleMs: 3000 });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("aborts between steps on abort signal", async () => {
    const tools = mockTools();
    const signal = { aborted: false };
    tools.key = vi.fn().mockImplementation(() => { signal.aborted = true; return Promise.resolve(); });
    const r = recipe('name: x\nexe: y\nsteps:\n  - key: F4\n  - key: F5');
    await runRecipe(r, { tools, sleep: noSleep, signal });
    expect(tools.key).toHaveBeenCalledTimes(1);
  });

  it("invokes onProgress callback before each step", async () => {
    const tools = mockTools();
    const onProgress = vi.fn();
    const r = recipe('name: x\nexe: y\nsteps:\n  - key: F4\n  - key: F5');
    await runRecipe(r, { tools, sleep: noSleep, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ index: 0, total: 2 }));
  });
});
