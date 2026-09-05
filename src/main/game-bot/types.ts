// game-bot type definitions — script primitives + GameRecipe.
// Pure types without side effects. id always = script filename (stripped .yaml), name is display-only.

// ── Primitives ──────────────────────────────────────────────────
// One interface per primitive; Step is union type. branch.then/else recurses to Step[].

export interface StepLaunch { type: "launch"; exe: string; }
export interface StepWait { type: "wait"; ms: number; }
export interface StepKey { type: "key"; combo: string; }  // "F4" / "Alt+F4"
export interface StepClick { type: "click"; target: "center" | { x: number; y: number }; }

export interface StepVlmClick {
  type: "vlm_click";
  ref: string;          // Reference image name (cropped from red bounding box)
  target?: string;      // Supplementary description for VLM (optional)
  repeat?: number;      // Repeat click count, default 1
  interval?: number;    // Repeat click interval ms, default 1000
  retry?: number;       // Retry count on location failure, default 2
  settle?: number;      // Wait ms before screenshot, overrides engine default
}

export interface StepVlmSelect {
  type: "vlm_select";
  desc: string;         // Semantic description, e.g. "first item in list" (no reference image)
  retry?: number;       // Default 2
  settle?: number;
}

export interface StepVlmCheck {
  type: "vlm_check";
  id: string;           // Result bound to variable ${id} (boolean), used for branch.if
  ask: string;
  ref?: string;         // Optional reference image for state
  settle?: number;
}

export interface StepVlmCompare {
  type: "vlm_compare";
  id: string;           // Result bound to variable ${id} (matched ref index or description)
  ask: string;
  refs: string[];       // Multiple reference images
  settle?: number;
}

export interface StepBranch {
  type: "branch";
  if: string;           // Expression, e.g. "${has_update}" / "${auto_battle_state == 'off'}"
  then: Step[];
  else?: Step[];
}

export type Step =
  | StepLaunch | StepWait | StepKey | StepClick
  | StepVlmClick | StepVlmSelect | StepVlmCheck | StepVlmCompare
  | StepBranch;

export interface GameRecipe {
  name: string;
  exe: string;          // Can contain ${exe_path}
  model?: string;       // Can contain ${vlm_config}; leave blank to use global VLM config
  steps: Step[];
}
