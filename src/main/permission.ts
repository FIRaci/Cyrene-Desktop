// File/tool permission tiers — controls what the agent is permitted to execute
// Four tiers: read-only / scoped / per-action / full
// All sensitive tools pass through checkPermission

import { ipcMain, BrowserWindow } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { app } from "electron";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { IPC } from "../shared/ipc-channels";

const LOG_PREFIX = "[Permission]";

export type AgentFileAccessLevel = "read-only" | "scoped" | "per-action" | "full";

export const ACCESS_LEVEL_LABEL: Record<AgentFileAccessLevel, string> = {
  "read-only": "Read only",
  "scoped": "Selected folder",
  "per-action": "Ask each time",
  "full": "Full access",
};

// Tool risk tier: determines which permission tiers permit tool execution
// input-control (mouse/keyboard/screenshot) handled in same tier as shell: rejected in read-only/scoped, approved in per-action, allowed in full
export type ToolRiskLevel = "safe" | "fs-read" | "fs-write" | "shell" | "network" | "input-control";

/**
 * Given tier + tool risk tier -> returns authorization policy:
 *   - "allow"       Execute directly
 *   - "ask"         Prompt approval UI, executed only when user approves
 *   - "deny"        Reject directly (agent receives rejection reason)
 */
export function policyFor(level: AgentFileAccessLevel, risk: ToolRiskLevel): "allow" | "ask" | "deny" {
  // safe tools (pure calculation, local read-only retrieval) allowed in any tier
  if (risk === "safe") return "allow";

  switch (level) {
    case "read-only":
      return risk === "fs-read" || risk === "network" || risk === "input-control" ? "allow" : "deny";
    case "scoped":
      // scoped tier: fs operations allowed (path validation done inside tool), shell rejected
      if (risk === "fs-read" || risk === "fs-write" || risk === "network") return "allow";
      return "deny";
    case "per-action":
      // per-action: prompt approval for all non-safe tools
      return "ask";
    case "full":
      return "allow";
  }
}

// Cyrene is intentionally pinned to the companion-safe profile. It may observe,
// use the network, and control the companion UI, but it may not mutate files or
// launch arbitrary commands/processes.
const COMPANION_LEVEL: AgentFileAccessLevel = "read-only";

// ── In-memory cache for current tier (held by main process) ───────────────────
let currentLevel: AgentFileAccessLevel = COMPANION_LEVEL;
let allowedRoot: string | null = null;

export function getCurrentLevel(): AgentFileAccessLevel {
  return currentLevel;
}

export function getAllowedRoot(): string | null {
  return allowedRoot;
}

export function setCurrentLevel(level: AgentFileAccessLevel): void {
  if (level !== COMPANION_LEVEL) {
    console.warn(LOG_PREFIX, "Blocked permission escalation outside the companion-safe profile:", level);
    return;
  }
  if (currentLevel === level) return;
  console.log(LOG_PREFIX, "Level changed:", currentLevel, "->", level);
  currentLevel = level;
  persistLevel(level, allowedRoot);
}

export function setAllowedRoot(rootPath: string | null): void {
  allowedRoot = rootPath;
  console.log(LOG_PREFIX, "Set allowed directory:", allowedRoot);
  persistLevel(currentLevel, allowedRoot);
}

export function isPathWithinScopedRoot(targetPath: string): boolean {
  if (!allowedRoot) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(allowedRoot);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

// ── Persistence ────────────────────────────────────────────────

function getStorePath(): string {
  return path.join(app.getPath("userData"), "agent-permission.json");
}

function persistLevel(level: AgentFileAccessLevel, root: string | null): void {
  try {
    const filePath = getStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ level, allowedRoot: root }, null, 2), "utf8");
  } catch (err) {
    console.error(LOG_PREFIX, "Failed to persist permission level:", err);
  }
}

/**
 * Loads previously saved tier from disk at startup; defaults to read-only if absent.
 * Must be called after app.whenReady (depends on app.getPath).
 */
export function initPermissionFromDisk(): void {
  try {
    const filePath = getStorePath();
    if (!fs.existsSync(filePath)) {
      console.log(LOG_PREFIX, "No persisted permission file; using companion-safe mode");
      return;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as { level?: unknown, allowedRoot?: string | null };
    if (isValidLevel(raw?.level)) {
      currentLevel = COMPANION_LEVEL;
      allowedRoot = null;
      if (raw.level !== COMPANION_LEVEL) persistLevel(COMPANION_LEVEL, null);
      console.log(LOG_PREFIX, "Loaded companion-safe permission profile");
    } else {
      console.warn(LOG_PREFIX, "Invalid permission level file, falling back to default");
    }
  } catch (err) {
    console.error(LOG_PREFIX, "Failed to load permission level:", err);
  }
}

// ── Approval modal (used under per-action tier) ─────────────────────
// Sends approval request via IPC to any focused window (typically chat or settings),
// renderer displays a card and sends back user decision.

interface PendingApproval {
  resolve: (allowed: boolean) => void;
  timer: NodeJS.Timeout;
  responderWebContentsIds: ReadonlySet<number>;
}

const pendingApprovals = new Map<string, PendingApproval>();

export interface PermissionIpcOptions {
  /** Only this renderer may change the persisted permission level. */
  canSetLevel?: (event: IpcMainInvokeEvent) => boolean;
  /** Approval requests are sent only to WebContents accepted by this policy. */
  isApprovalUi?: (webContents: WebContents) => boolean;
}

function hasRendererRoute(webContents: WebContents, route: "settings" | "chat"): boolean {
  try {
    const url = new URL(webContents.getURL());
    const isTrustedOrigin = url.protocol === "file:"
      || (url.protocol === "http:" && url.hostname === "localhost" && url.port === "5173");
    if (!isTrustedOrigin) return false;
    const normalizedPath = decodeURIComponent(url.pathname).replace(/\\/g, "/").toLowerCase();
    return normalizedPath.includes(`/${route}/`) || normalizedPath.endsWith(`/${route}/index.html`);
  } catch {
    return false;
  }
}

const defaultCanSetLevel = (event: IpcMainInvokeEvent): boolean => hasRendererRoute(event.sender, "settings");
const defaultIsApprovalUi = (webContents: WebContents): boolean => hasRendererRoute(webContents, "chat");
let approvalUiPolicy = defaultIsApprovalUi;

export interface ApprovalRequest {
  id: string;
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  risk: ToolRiskLevel;
}

/**
 * Prompts user with an approval request, waiting for allow/deny decision.
 * Automatically rejects if no response within 60 seconds.
 */
export function requestApproval(
  request: Omit<ApprovalRequest, "id">,
  isApprovalUi: (webContents: WebContents) => boolean = approvalUiPolicy,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = `approve-${randomUUID()}`;
    const recipients = BrowserWindow.getAllWindows()
      .map((win) => win.webContents)
      .filter((webContents) => !webContents.isDestroyed() && isApprovalUi(webContents));

    if (recipients.length === 0) {
      console.warn(LOG_PREFIX, "No trusted approval window available, automatically rejecting");
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      console.warn(LOG_PREFIX, "Approval timed out (60s no response), automatically rejecting:", request.toolId);
      resolve(false);
    }, 60_000);
    pendingApprovals.set(id, {
      resolve,
      timer,
      responderWebContentsIds: new Set(recipients.map((webContents) => webContents.id)),
    });

    const payload: ApprovalRequest = { id, ...request };
    console.log(LOG_PREFIX, "Sending approval request to renderer:", id, request.toolId);

    for (const webContents of recipients) {
      webContents.send(IPC.PERMISSION_APPROVAL_REQUEST, payload);
    }
  });
}

// ── IPC Registration ──────────────────────────────────────────────

export function registerPermissionIpc(options: PermissionIpcOptions = {}): void {
  const canSetLevel = options.canSetLevel ?? defaultCanSetLevel;
  const isApprovalUi = options.isApprovalUi ?? defaultIsApprovalUi;
  approvalUiPolicy = isApprovalUi;

  ipcMain.handle(IPC.PERMISSION_GET_LEVEL, () => {
    return { level: currentLevel };
  });

  ipcMain.handle(IPC.PERMISSION_SET_LEVEL, (event, level: AgentFileAccessLevel) => {
    if (!canSetLevel(event)) {
      console.warn(LOG_PREFIX, "Rejected untrusted renderer switching permission level:", event.sender.id);
      return { ok: false, error: "Permission level changes are only allowed from the trusted settings UI." };
    }
    if (!isValidLevel(level)) {
      return { ok: false, error: "Invalid permission level: " + String(level) };
    }
    if (level !== COMPANION_LEVEL) {
      return { ok: false, error: "Cyrene is locked to observation and app-provided tools; file writes and command execution are disabled." };
    }
    setCurrentLevel(level);
    return { ok: true, level: currentLevel };
  });

  // Renderer approval UI sends back result
  ipcMain.handle(IPC.PERMISSION_APPROVAL_RESOLVE, (event, payload: { id: string; allowed: boolean }) => {
    if (!payload || typeof payload.id !== "string" || typeof payload.allowed !== "boolean") {
      return { ok: false };
    }
    const pending = pendingApprovals.get(payload?.id);
    if (!pending) {
      console.warn(LOG_PREFIX, "Approval callback did not match any pending request:", payload?.id);
      return { ok: false };
    }
    if (!pending.responderWebContentsIds.has(event.sender.id) || !isApprovalUi(event.sender)) {
      console.warn(LOG_PREFIX, "Denied approval from non-designated renderer:", event.sender.id, payload?.id);
      return { ok: false };
    }
    clearTimeout(pending.timer);
    pendingApprovals.delete(payload.id);
    console.log(LOG_PREFIX, "Approval result:", payload.id, payload.allowed ? "Allowed" : "Denied");
    pending.resolve(Boolean(payload.allowed));
    return { ok: true };
  });

  console.log(LOG_PREFIX, "IPC handlers registered");
}

function isValidLevel(value: unknown): value is AgentFileAccessLevel {
  return value === "read-only" || value === "scoped" || value === "per-action" || value === "full";
}

/**
 * Unified permission check: determines execute / ask / deny based on current tier + risk.
 * - allow -> returns true
 * - ask   -> triggers approval, awaits user response
 * - deny  -> returns false
 */
export async function checkPermission(input: {
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  risk: ToolRiskLevel;
}): Promise<{ allowed: boolean; reason?: string }> {
  const level = currentLevel;
  const policy = policyFor(level, input.risk);
  console.log(LOG_PREFIX, "checkPermission:", input.toolId, "risk=" + input.risk, "level=" + level, "→", policy);

  if (policy === "allow") {
    // Enforce scoped file path validation
    if (level === "scoped" && (input.risk === "fs-read" || input.risk === "fs-write")) {
      const targetPath = (input.args.path as string) || (input.args.filePath as string);
      if (!targetPath) {
        return { allowed: false, reason: "In Scoped mode, tool execution requires an explicit path or filePath parameter." };
      }
      if (!isPathWithinScopedRoot(targetPath)) {
        return { allowed: false, reason: `Path [${targetPath}] exceeds current authorized workspace [${allowedRoot || "not configured"}].` };
      }
    }
    return { allowed: true };
  }
  if (policy === "deny") {
    return {
      allowed: false,
      reason: "Current level \"" + ACCESS_LEVEL_LABEL[level] + "\" does not permit this action (risk=" + input.risk + "). Please configure local file permissions in Settings.",
    };
  }
  // ask -> prompt approval
  const approved = await requestApproval({
    toolId: input.toolId,
    toolName: input.toolName,
    toolDescription: input.toolDescription,
    args: input.args,
    risk: input.risk,
  });
  if (approved) return { allowed: true };
  return { allowed: false, reason: "User denied this action." };
}
