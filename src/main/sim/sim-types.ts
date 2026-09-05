// ── Simulator Shared Types ──
import type { DmaeState, DmaeParams, WorldbookEntry, EntryState } from "../rag/worldbook";

export interface Round {
  index: number;            // 0-based round index
  userText: string;         // User input for this round
  modelText: string;        // Model response for this round (for modelHit detection)
  note?: string;            // Debug notes
}

export interface EntrySnapshot {
  entryId: string;
  intrinsicValue: number;
  priority: number;
  activation: number;
  userSilence: number;
  modelSilence: number;
  state: DmaeState;
  userHit: boolean;         // Whether hit by user this round
  modelHit: boolean;        // Whether hit by model this round
}

export interface SimResult {
  scenario: string;
  params: DmaeParams;
  entries: WorldbookEntry[];
  rounds: Round[];
  snapshots: EntrySnapshot[][];   // [roundIdx][entryIdx] = snapshot of entry at round
  // Statistical results (populated by render/stats.ts)
  stats: SimStats;
}

export interface SimStats {
  promptOccupancy: Map<string, number>;   // entryId -> occupancy rate 0~1
  avgActiveLife: Map<string, number>;     // entryId -> average active rounds per activation
  promptRanking: Map<number, string[]>;   // roundIdx -> list of entryIds sorted descending by A
  totalRounds: number;
}

export interface Scenario {
  name: string;
  buildRounds(): Round[];
  buildEntries(): WorldbookEntry[];       // fixture -> entry parsing
  description: string;
}
