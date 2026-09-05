// engine — step interpreter. Executes GameRecipe primitives, supporting branch/variables/settle/retry.
// Core pure logic: accesses capabilities via BotTools dependency injection, without importing screenshot/input/vlm directly,
// making unit testing with mock BotTools straightforward. settle/sleep are also injected for fake timers.

import type { GameRecipe, Step } from "./types";
import type { BotTools, ProgressCb } from "./bot-tools";

export interface RunContext {
  tools: BotTools;
  vars?: Record<string, string>;      // Injected variables (exe_path / vlm_config etc.)
  settleMs?: number;                   // Wait before vlm_* screenshot, default 3000
  sleep?: (ms: number) => Promise<void>;
  onProgress?: ProgressCb;
  signal?: { aborted: boolean };       // Abort signal: true stops execution after current step
}

export interface RunResult {
  ok: boolean;
  error?: string;
  completed: number;
  total: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Replaces ${var} with values from vars. */
function resolveVars(s: string, vars: Record<string, unknown>): string {
  return s.replace(/\$\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined ? "" : String(v);
  });
}

/**
 * Evaluates branch.if expression -> boolean.
 * Supports "${var}" / "${var == 'val'}" / "${var == 1}" / bare true/false.
 */
function evalExpr(expr: string, vars: Record<string, unknown>): boolean {
  const m = expr.trim().match(/^\$\{(\w+)\s*(?:==\s*(.+?))?\}$/);
  if (!m) {
    const r = resolveVars(expr, vars).trim().toLowerCase();
    return r === "true" || r === "1";
  }
  const name = m[1];
  const rhs = m[2];
  const val = vars[name];
  if (rhs === undefined) {
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    const s = String(val ?? "").trim().toLowerCase();
    return s === "true" || s === "1";
  }
  let r = rhs.trim();
  if ((r.startsWith("'") && r.endsWith("'")) || (r.startsWith('"') && r.endsWith('"'))) r = r.slice(1, -1);
  return String(val ?? "") === r;
}

function stepDesc(step: Step): string {
  switch (step.type) {
    case "launch": return "Launch " + step.exe;
    case "wait": return "Wait " + step.ms + "ms";
    case "key": return "Press " + step.combo;
    case "click": return "Click " + (step.target === "center" ? "center" : JSON.stringify(step.target));
    case "vlm_click": return "Locate and click " + step.ref;
    case "vlm_select": return "Select " + step.desc;
    case "vlm_check": return "Check " + step.id;
    case "vlm_compare": return "Compare " + step.id;
    case "branch": return "Branch " + step.if;
  }
}

export async function runRecipe(recipe: GameRecipe, ctx: RunContext): Promise<RunResult> {
  const tools = ctx.tools;
  const vars: Record<string, unknown> = { ...(ctx.vars ?? {}) };
  const sleep = ctx.sleep ?? defaultSleep;
  const settleMs = ctx.settleMs ?? 3000;
  const total = recipe.steps.length;
  let completed = 0;

  async function execStep(step: Step): Promise<string | null> {
    if (ctx.signal?.aborted) return "Automation was stopped.";
    switch (step.type) {
      case "launch":
        await tools.launch(resolveVars(step.exe, vars));
        return null;
      case "wait":
        await sleep(step.ms);
        return null;
      case "key":
        await tools.key(step.combo);
        return null;
      case "click":
        if (step.target === "center") await tools.clickCenter();
        else await tools.click(step.target.x, step.target.y);
        return null;
      case "vlm_click": {
        await sleep(step.settle ?? settleMs);
        const tries = (step.retry ?? 2) + 1;
        let coord: { x: number; y: number } | null = null;
        for (let i = 0; i < tries; i++) {
          if (ctx.signal?.aborted) return "Automation was stopped.";
          coord = await tools.locate(step.ref, step.target);
          if (coord) break;
          if (i < tries - 1) await sleep(1000);
        }
        if (!coord) return "VLM could not locate target: " + step.ref;
        const repeat = step.repeat ?? 1;
        for (let r = 0; r < repeat; r++) {
          await tools.click(coord.x, coord.y);
          if (r < repeat - 1) await sleep(step.interval ?? 1000);
        }
        return null;
      }
      case "vlm_select": {
        await sleep(step.settle ?? settleMs);
        const tries = (step.retry ?? 2) + 1;
        let coord: { x: number; y: number } | null = null;
        for (let i = 0; i < tries; i++) {
          if (ctx.signal?.aborted) return "Automation was stopped.";
          coord = await tools.select(step.desc);
          if (coord) break;
          if (i < tries - 1) await sleep(1000);
        }
        if (!coord) return "VLM could not locate selection: " + step.desc;
        await tools.click(coord.x, coord.y);
        return null;
      }
      case "vlm_check": {
        await sleep(step.settle ?? settleMs);
        let ans: boolean | null = null;
        for (let i = 0; i < 3; i++) {
          ans = await tools.check(step.ask, step.ref);
          if (ans !== null) break;
          if (i < 2) await sleep(1000);
        }
        vars[step.id] = ans ?? false;
        return null;
      }
      case "vlm_compare": {
        await sleep(step.settle ?? settleMs);
        let idx: number | null = null;
        for (let i = 0; i < 3; i++) {
          idx = await tools.compare(step.refs, step.ask);
          if (idx !== null) break;
          if (i < 2) await sleep(1000);
        }
        vars[step.id] = idx ?? 0;
        return null;
      }
      case "branch": {
        const cond = evalExpr(step.if, vars);
        const branchSteps = cond ? step.then : (step.else ?? []);
        for (const sub of branchSteps) {
          if (ctx.signal?.aborted) return "Automation was stopped.";
          const err = await execStep(sub);
          if (err) return err;
        }
        return null;
      }
    }
  }

  for (let i = 0; i < recipe.steps.length; i++) {
    if (ctx.signal?.aborted) return { ok: false, error: "Automation was stopped.", completed, total };
    const step = recipe.steps[i];
    ctx.onProgress?.({ index: i, total, desc: stepDesc(step) });
    const err = await execStep(step);
    if (err) return { ok: false, error: err, completed, total };
    completed = i + 1;
  }
  return { ok: true, completed, total };
}
