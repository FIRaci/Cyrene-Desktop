// Agent reply performance tracing: records elapsed time across stages to identify latency bottlenecks.
//
// Design:
//   - Module-level singleton, tracks one turn at a time (automatically dumps previous turn if concurrent).
//   - Log prefix [Perf], grep "[Perf]" in terminal to inspect traces.
//   - Three APIs:
//       perf.track("name", async () => ...)  -- async tracing (recommended, manages begin/end)
//       const t = perf.begin("name"); ...; t.end()  -- manual tracing
//       perf.mark("checkpoint")  -- timestamp checkpoint only
//   - Call perf.dump() at turn completion to print summary table.
//
// Usage example:
//   perf.beginTurn("desktop");
//   const ctx = await perf.track("always_on_context", () => buildAlwaysOnContext(...));
//   const t = perf.begin("cita_prepare"); ...; t.end();
//   perf.dump();  // Call in complete callback or finally

import { debugLog, debugWarn } from "./agent-log";

const PREFIX = "[Perf]";

interface PhaseMark {
  name: string;
  start: number;
  end?: number;
}

let turnStart = 0;
let turnLabel = "";
let phases: PhaseMark[] = [];

function now(): number {
  return Date.now();
}

function tPlus(): number {
  return turnStart > 0 ? now() - turnStart : 0;
}

export const perf = {
  /** Starts tracking a turn. Automatically dumps previous turn if not yet dumped. */
  beginTurn(label = ""): void {
    if (turnStart > 0) {
      debugWarn(`${PREFIX} previous turn "${turnLabel}" not dumped, auto-dumping before new turn`);
      this.dump();
    }
    turnStart = now();
    turnLabel = label;
    phases = [];
    debugLog(`${PREFIX} ===== TURN START${label ? ` (${label})` : ""} =====`);
  },

  /**
   * Starts timing a stage. Returns { end } to conclude timing.
   * Prefer perf.track() for nested scopes to ensure proper closing.
   */
  begin(name: string): { end: (extra?: string) => void } {
    const start = now();
    const t0 = start - turnStart;
    debugLog(`${PREFIX} >>> ${name} t+${t0}ms`);
    return {
      end(extra) {
        const endTime = now();
        const elapsed = endTime - start;
        const t1 = endTime - turnStart;
        phases.push({ name, start, end: endTime });
        debugLog(`${PREFIX} <<< ${name} elapsed=${elapsed}ms t+${t1}ms${extra ? ` ${extra}` : ""}`);
      },
    };
  },

  /** Asynchronously tracks a stage, automatically managing begin/end. */
  async track<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const timer = this.begin(name);
    try {
      return await fn();
    } finally {
      timer.end();
    }
  },

  /** Marks a timestamp checkpoint (does not measure duration). */
  mark(name: string): void {
    debugLog(`${PREFIX} --- ${name} t+${tPlus()}ms`);
  },

  /** Prints summary table and resets state. Call when turn ends. */
  dump(): void {
    if (turnStart === 0) return;
    const total = now() - turnStart;
    debugLog(`${PREFIX} ===== TURN SUMMARY (total=${total}ms) =====`);
    if (phases.length === 0) {
      debugLog(`${PREFIX}   (no phases recorded)`);
    } else {
      for (const p of phases) {
        const elapsed = (p.end ?? now()) - p.start;
        const pct = total > 0 ? ((elapsed / total) * 100).toFixed(1) : "0.0";
        debugLog(`${PREFIX}   ${p.name.padEnd(48)} ${String(elapsed).padStart(6)}ms  (${pct}%)`);
      }
    }
    debugLog(`${PREFIX} ===== END SUMMARY =====`);
    turnStart = 0;
    phases = [];
    turnLabel = "";
  },
};
