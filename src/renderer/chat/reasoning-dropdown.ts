// Chat window reasoning dropdown - dynamically generates options according to (providerId, model) capability.
//
// Entry point: computeReasoningDropdown(providerId, model, savedPreference)
// Returns ReasoningDropdownView, rendered onto the DOM by chat/main.ts.
//
// Control variations (by capability.control):
// - fixed-on: always enabled, control disabled, single disabled option
// - dynamic: follows dynamic routing, control disabled, single disabled option
// - none: reasoning control not configured, control disabled, single disabled option
// - toggle (without supportedEfforts): Follow Model / [Off] / On
// - effort / toggle-effort (with supportedEfforts): Follow Model / [Off] / supportedEfforts.map
//
// Note: effective must be computed with resolveEffectiveReasoning(saved, capability),
// never directly via saved ?? auto. For fixed-on models even if saved=off, effective.mode is on;
// if saved.effort is unsupported, effective.effort falls back to defaultEffort.

import {
  resolveEffectiveReasoning,
  resolveReasoningCapability,
  type ReasoningEffort,
  type ReasoningPreference,
} from "../../shared/reasoning";

export interface ReasoningDropdownItem {
  label: string;
  preference: ReasoningPreference;
  /** Whether item cannot be clicked (single item for fixed-on / dynamic / none) */
  disabled?: boolean;
  /** Tooltip hint */
  hint?: string;
}

export interface ReasoningDropdownView {
  /** Entire dropdown disabled (fixed-on / dynamic / none): trigger cannot be clicked */
  disabled: boolean;
  /** Text displayed on trigger button (user current effective state) */
  statusText: string;
  /** Currently active preference (may differ from saved preference after normalization) */
  activePreference: ReasoningPreference;
  items: ReasoningDropdownItem[];
}

const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very High",
  max: "Max",
};

export function computeReasoningDropdown(
  providerId: string,
  model: string,
  saved: ReasoningPreference | undefined,
): ReasoningDropdownView {
  const cap = resolveReasoningCapability(providerId, model);
  const effective = resolveEffectiveReasoning(saved, cap);

  // ── fixed-on: always on, control disabled, single disabled item ──
  if (cap.control === "fixed-on") {
    return {
      disabled: true,
      statusText: "Always On",
      activePreference: effective,
      items: [
        {
          label: "Always On",
          preference: { mode: "on" },
          disabled: true,
          hint: "This model always thinks and cannot be disabled",
        },
      ],
    };
  }

  // ── dynamic: follows dynamic routing, control disabled ──
  if (cap.control === "dynamic") {
    return {
      disabled: true,
      statusText: "Dynamic Routing",
      activePreference: effective,
      items: [
        {
          label: "Dynamic Routing",
          preference: { mode: "auto" },
          disabled: true,
          hint: "Determined by dynamic routing",
        },
      ],
    };
  }

  // ── none: reasoning control not configured, control disabled ──
  if (cap.control === "none") {
    return {
      disabled: true,
      statusText: "Default",
      activePreference: effective,
      items: [
        {
          label: "Default",
          preference: { mode: "auto" },
          disabled: true,
          hint: "Reasoning control is not configured for current model",
        },
      ],
    };
  }

  // ── toggle (no supportedEfforts): Default / [Off] / On ──
  if (cap.control === "toggle") {
    const items: ReasoningDropdownItem[] = [
      { label: "Default", preference: { mode: "auto" } },
    ];
    if (cap.supportsDisable) {
      items.push({ label: "Off", preference: { mode: "off" } });
    }
    items.push({ label: "On", preference: { mode: "on" } });
    return {
      disabled: false,
      statusText: statusTextFor(effective),
      activePreference: effective,
      items,
    };
  }

  // ── effort / toggle-effort (with supportedEfforts) ──
  const efforts = cap.supportedEfforts ?? [];
  const items: ReasoningDropdownItem[] = [
    { label: "Default", preference: { mode: "auto" } },
  ];
  if (cap.supportsDisable) {
    items.push({ label: "Off", preference: { mode: "off" } });
  }
  for (const e of efforts) {
    items.push({ label: EFFORT_LABEL[e], preference: { mode: "on", effort: e } });
  }
  return {
    disabled: false,
    statusText: statusTextFor(effective),
    activePreference: effective,
    items,
  };
}

function statusTextFor(effective: ReasoningPreference): string {
  if (effective.mode === "auto") return "Default";
  if (effective.mode === "off") return "Off";
  if (effective.effort) return EFFORT_LABEL[effective.effort];
  return "On";
}

/** statusText displayed on dropdown trigger button: prefix "Reasoning · " */
export function formatReasoningTriggerLabel(statusText: string): string {
  return `Reasoning · ${statusText}`;
}
