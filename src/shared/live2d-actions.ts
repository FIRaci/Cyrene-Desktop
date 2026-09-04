// Live2D action catalog — single source of truth for every alias Cyrene
// can perform on her Live2D model. Consumed by:
//   - Main process: build the play_live2d_action tool description, validate
//     LLM tool calls before forwarding.
//   - Renderer: map an incoming `Live2DTarget` to motion()/expression() calls.
//
// Adding a new alias = appending one entry here. No prompt edits required —
// the tool description is generated from this list at registration time.

export type Live2DTarget =
  | { kind: "motion"; group: string; motionName: string }
  | { kind: "expression"; name: string };

export interface Live2DAction {
  /** English name exposed to the LLM. Unique within the catalog (case-insensitive). */
  alias: string;
  /** One-line hint shown to the LLM alongside the alias. */
  description: string;
  /** Concrete target the renderer dispatches. */
  target: Live2DTarget;
}

export const LIVE2D_ACTIONS: readonly Live2DAction[] = [
  {
    alias: "reset",
    description: "Return to the default pose and expression",
    target: { kind: "motion", group: "动作#6", motionName: "动作回正" },
  },
  {
    alias: "wink",
    description: "Give the user a playful wink",
    target: { kind: "motion", group: "动作#6", motionName: "Wink~" },
  },
  {
    alias: "act cute",
    description: "Strike a shy, cute pose",
    target: { kind: "motion", group: "动作#6", motionName: "我可爱吧~" },
  },
  {
    alias: "smile",
    description: "Smile warmly at the user",
    target: { kind: "motion", group: "动作#6", motionName: "笑一笑吧~" },
  },
  {
    alias: "sunglasses",
    description: "Put on sunglasses with confidence",
    target: { kind: "expression", name: "墨镜" },
  },
  {
    alias: "question mark",
    description: "Show a puzzled question mark",
    target: { kind: "expression", name: "问号" },
  },
  {
    alias: "sparkle",
    description: "Shimmer with bright sparkles",
    target: { kind: "expression", name: "闪耀" },
  },
  {
    alias: "starry eyes",
    description: "Turn her eyes into excited stars",
    target: { kind: "expression", name: "星星眼" },
  },
  {
    alias: "dizzy eyes",
    description: "Show dizzy spiral eyes",
    target: { kind: "expression", name: "圈圈眼" },
  },
  {
    alias: "happy eyes",
    description: "Show cheerful smiling eyes",
    target: { kind: "expression", name: "开心眼" },
  },
];

/**
 * Look up an action by its alias. Case-insensitive. Returns undefined for
 * unknown or empty input. Both Main (tool handler validation) and Renderer
 * (alias→target resolution) call this; it never throws.
 */
export function findAction(alias: string): Live2DAction | undefined {
  if (!alias) return undefined;
  const needle = alias.trim().toLowerCase();
  if (!needle) return undefined;
  return LIVE2D_ACTIONS.find((a) => a.alias.toLowerCase() === needle);
}
