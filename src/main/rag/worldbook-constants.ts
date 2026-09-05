// ── Central Worldbook Constants ──
// Principle: centralize non-algorithmic configuration constants here for easier tuning.
// Algorithmic parameters (Bu/Bm/γ/λ/α/β, etc.) belong in DmaeParams.

export const WORLDBOOK_CONSTANTS: {
  MAX_ACTIVE: number;
  DEFAULT_INTRINSIC_VALUE: number;
  MIN_INTRINSIC_VALUE: number;
  EPSILON: number;
  FLOOR_TRIGGER_STATE: string;
} = {
  // ── State machine parameters ──
  MAX_ACTIVE: 8,                   // Hard upper bound on active entries injected into context
  DEFAULT_INTRINSIC_VALUE: 60,     // Fallback when .md does not specify intrinsic_value

  // ── Numerical safety ──
  MIN_INTRINSIC_VALUE: 1,          // QuadraticResistanceDecay divide-by-zero protection: sqrt(0)
  EPSILON: 0.01,                   // Invariant protection: Rm = clamp(Rm, 0, D - eps)

  // ── Floor semantics ──
  FLOOR_TRIGGER_STATE: "Archived", // Only trigger Floor when resurrecting from Archived
};

// ── State labels ──
export const WORLDBOOK_STATES = {
  UNINITIALIZED: "Uninitialized",
  ACTIVE: "Active",
  DORMANT: "Dormant",
  ARCHIVED: "Archived",
} as const;

// Header and preamble used when injecting world knowledge into orchestrator prompt
export const INJECTION_HEADER = "[Activated World Knowledge]";

export const INJECTION_PREAMBLE =
  "The following content has been triggered by the current user message and is considered true and established. Naturally incorporate this information in your reply without claiming not to know, having heard it for the first time, or asking the user to introduce it, unless the content itself is contradictory.";