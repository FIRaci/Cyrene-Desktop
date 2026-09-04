// Tool: play_live2d_action
//
// Registered with the existing toolRegistry so the LLM can ask Cyrene to
// perform a Live2D animation on herself. The handler validates the alias
// against the shared catalog and forwards the *resolved* target over IPC;
// the renderer never sees the raw alias, so it can never play something the
// catalog did not sanction.

import { LIVE2D_ACTIONS, findAction, type Live2DTarget } from "../../../shared/live2d-actions";
import { IPC } from "../../../shared/ipc-channels";
import type { ToolDefinition } from "../tool-registry";

export type PlayLive2DActionDeps = {
  /** Injected so we can unit-test without a real BrowserWindow. */
  sendToLive2DWindow: (channel: string, payload?: unknown) => void;
};

export type PlayLive2DActionResult =
  | { ok: true }
  | { ok: false; error: "unknown_action"; available: string[] }
  | { ok: false; error: "ipc_failed" };

/** Serialize a structured result to the JSON string the tool contract requires. */
function toJsonResult(r: PlayLive2DActionResult): string {
  return JSON.stringify(r);
}

const LEGACY_LOCALIZED_ALIASES: Readonly<Record<string, string>> = {
  "回正": "reset",
  "眨眨眼": "wink",
  "可爱一下": "act cute",
  "笑一笑": "smile",
  "戴墨镜": "sunglasses",
  "问号": "question mark",
  "闪闪发光": "sparkle",
  "星星眼": "starry eyes",
  "圈圈眼": "dizzy eyes",
  "开心眼": "happy eyes",
};

function findLocalizedAction(alias: string) {
  const englishAlias = LEGACY_LOCALIZED_ALIASES[alias.trim()];
  return englishAlias ? findAction(englishAlias) : undefined;
}

function availableEnglishAliases(): string[] {
  return LIVE2D_ACTIONS.map((action) => action.alias);
}

/**
 * Build the handler. Returns a function compatible with
 * `ToolDefinition.execute` (Promise<string>).
 */
export function createPlayLive2DActionHandler(deps: PlayLive2DActionDeps) {
  return async (
    args: Record<string, unknown>,
    _ctx?: unknown,
  ): Promise<string> => {
    const raw = args?.name;
    if (typeof raw !== "string" || raw.length === 0) {
      return toJsonResult({
        ok: false,
        error: "unknown_action",
        available: availableEnglishAliases(),
      });
    }
    // English aliases are model-facing. Legacy/localized aliases remain accepted
    // so multilingual user input and existing callers do not regress.
    const action = findAction(raw) ?? findLocalizedAction(raw);
    if (!action) {
      return toJsonResult({
        ok: false,
        error: "unknown_action",
        available: availableEnglishAliases(),
      });
    }
    try {
      deps.sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, action.target satisfies Live2DTarget);
      return toJsonResult({ ok: true });
    } catch (err) {
      console.warn("[play-live2d-action] IPC failed:", err);
      return toJsonResult({ ok: false, error: "ipc_failed" });
    }
  };
}

/** Build the description string from the catalog so adding an alias needs no prompt edits. */
function buildDescription(): string {
  const lines = LIVE2D_ACTIONS.map((a) => `- ${a.alias}: ${a.description}`).join("\n");
  return [
    "Make Cyrene perform an expression or body motion on her Live2D model.",
    "Use this tool when the user asks her to perform an action visible on screen.",
    "",
    "Available actions:",
    lines,
    "",
    "If the requested action is not listed, do not call this tool. Explain what Cyrene can do and optionally suggest the closest available action.",
    "Parameter: name (required; choose one English alias from the list above).",
  ].join("\n");
}

/** The fully wired ToolDefinition, ready for `toolRegistry.register()`. */
export function createPlayLive2DActionTool(deps: PlayLive2DActionDeps): ToolDefinition {
  return {
    id: "play_live2d_action",
    name: "Perform Live2D action",
    description: buildDescription(),
    enabled: true,
    risk: "input-control",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "English action alias, such as wink, sunglasses, or smile",
        },
      },
      required: ["name"],
    },
    execute: createPlayLive2DActionHandler(deps),
  };
}
