// 3 categories of statistics: Prompt Occupancy Rate / Average Lifespan / Per-Round Prompt Ranking
import type { SimResult, SimStats, EntrySnapshot } from "../sim-types";
import { deriveState } from "../../rag/worldbook";

export function computeStats(result: SimResult): SimStats {
  const threshold = result.params.promptThreshold;
  const occupancy = new Map<string, number>();
  const life = new Map<string, number[]>();
  const ranking = new Map<number, string[]>();

  for (const entry of result.entries) {
    occupancy.set(entry.id, 0);
    life.set(entry.id, []);
  }

  // Occupancy + ranking (ranking only includes entries with A > 0 to avoid counting Archived dead entries)
  for (let r = 0; r < result.snapshots.length; r++) {
    const sorted = [...result.snapshots[r]]
      .filter((s) => {
        const ent = result.entries.find((e) => e.id === s.entryId);
        return ent && !ent.permanent && s.activation > 0;
      })
      .sort((a, b) => b.activation - a.activation)
      .map((s) => s.entryId);
    ranking.set(r, sorted);
    for (const snap of result.snapshots[r]) {
      if (snap.state === "Active") {
        occupancy.set(snap.entryId, (occupancy.get(snap.entryId) ?? 0) + 1);
      }
    }
  }

  // Normalize occupancy
  const totalRounds = result.snapshots.length;
  for (const [k, v] of occupancy) {
    occupancy.set(k, totalRounds > 0 ? v / totalRounds : 0);
  }

  // Average lifespan: average duration of consecutive Active segments
  for (const entry of result.entries) {
    const snaps = result.snapshots.map((s) => s.find((x) => x.entryId === entry.id)).filter(Boolean) as EntrySnapshot[];
    let curRun = 0;
    for (const s of snaps) {
      if (s.state === "Active") {
        curRun++;
      } else if (curRun > 0) {
        life.get(entry.id)!.push(curRun);
        curRun = 0;
      }
    }
    if (curRun > 0) life.get(entry.id)!.push(curRun);
  }

  const avgLife = new Map<string, number>();
  for (const [k, runs] of life) {
    avgLife.set(k, runs.length > 0 ? runs.reduce((a, b) => a + b, 0) / runs.length : 0);
  }

  return { promptOccupancy: occupancy, avgActiveLife: avgLife, promptRanking: ranking, totalRounds };
}

export function printStats(result: SimResult): void {
  const { stats, entries, params } = result;
  console.log("\n=== Statistics Summary ===");
  console.log(`Parameters: Bu=${params.userRewardBase} gamma=${params.wakeGamma} Bm=${params.modelRewardBase} lambda=${params.wakeLambda} alpha=${params.decayAlpha} beta=${params.decayBeta} threshold=${params.promptThreshold}`);
  console.log(`Total Rounds: ${stats.totalRounds}\n`);

  console.log("--- Prompt Occupancy Rate (Rounds in Active state) ---");
  const occRows = entries
    .filter((e) => !e.permanent)
    .map((e) => {
      const occ = stats.promptOccupancy.get(e.id) ?? 0;
      return { id: e.id, I: e.intrinsicValue, occ };
    })
    .sort((a, b) => b.occ - a.occ);
  for (const r of occRows) {
    const bar = "█".repeat(Math.round(r.occ * 40));
    console.log(`  ${r.id.padEnd(40)}  I=${String(r.I).padStart(3)}  ${(r.occ * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }

  console.log("\n--- Average Lifespan (Average continuous rounds per activation) ---");
  const lifeRows = entries
    .filter((e) => !e.permanent)
    .map((e) => ({ id: e.id, I: e.intrinsicValue, life: stats.avgActiveLife.get(e.id) ?? 0 }))
    .sort((a, b) => b.life - a.life);
  for (const r of lifeRows) {
    console.log(`  ${r.id.padEnd(40)}  I=${String(r.I).padStart(3)}  ${r.life.toFixed(2).padStart(6)} rounds/activation`);
  }

  console.log("\n--- Per-Round Prompt Ranking (Sampled every 5 rounds) ---");
  const step = Math.max(1, Math.floor(stats.totalRounds / 20));
  for (let r = 0; r < stats.totalRounds; r += step) {
    const top = (stats.promptRanking.get(r) ?? []).slice(0, 5);
    if (top.length === 0) continue;
    console.log(`  R${String(r).padStart(3)}: ${top.map((id, i) => `${i + 1}.${id.split("_").slice(-2).join("_")}`).join("  ")}`);
  }
}
