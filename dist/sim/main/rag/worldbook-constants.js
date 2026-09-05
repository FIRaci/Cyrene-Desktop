"use strict";
// ── Central Worldbook Constants ──
// Principle: centralize non-algorithmic configuration constants here for easier tuning.
// Algorithmic parameters (Bu/Bm/γ/λ/α/β, etc.) belong in DmaeParams.
Object.defineProperty(exports, "__esModule", { value: true });
exports.INJECTION_PREAMBLE = exports.INJECTION_HEADER = exports.WORLDBOOK_STATES = exports.WORLDBOOK_CONSTANTS = void 0;
exports.WORLDBOOK_CONSTANTS = {
    // ── State machine parameters ──
    MAX_ACTIVE: 8, // Hard upper bound on active entries injected into context
    DEFAULT_INTRINSIC_VALUE: 60, // Fallback when .md does not specify intrinsic_value
    // ── Numerical safety ──
    MIN_INTRINSIC_VALUE: 1, // QuadraticResistanceDecay divide-by-zero protection: sqrt(0)
    EPSILON: 0.01, // Invariant protection: Rm = clamp(Rm, 0, D - eps)
    // ── Floor semantics ──
    FLOOR_TRIGGER_STATE: "Archived", // Only trigger Floor when resurrecting from Archived
};
// ── State labels ──
exports.WORLDBOOK_STATES = {
    UNINITIALIZED: "Uninitialized",
    ACTIVE: "Active",
    DORMANT: "Dormant",
    ARCHIVED: "Archived",
};
// Header and preamble used when injecting world knowledge into orchestrator prompt
exports.INJECTION_HEADER = "[Activated World Knowledge]";
exports.INJECTION_PREAMBLE = "The following content has been triggered by the current user message and is considered true and established. Naturally incorporate this information in your reply without claiming not to know, having heard it for the first time, or asking the user to introduce it, unless the content itself is contradictory.";
