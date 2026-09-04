// 文件/工具权限档位 — 控制 agent 能做什么
// 四档：read-only / scoped / per-action / full
// 未来 fetch_url、run_shell、install_mcp_server 等"危险工具"都要先过 checkPermission

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

// 工具危险等级：决定该工具在哪些档位下可用
// input-control（键鼠/截屏控制）按 shell 同档处理：read-only/scoped 拒绝，per-action 审批，full 允许
export type ToolRiskLevel = "safe" | "fs-read" | "fs-write" | "shell" | "network" | "input-control";

/**
 * 给定档位 + 工具危险等级 → 返回授权策略：
 *   - "allow"       直接放行
 *   - "ask"         弹审批 UI，用户点同意才放行
 *   - "deny"        直接拒绝（agent 会收到拒绝原因）
 */
export function policyFor(level: AgentFileAccessLevel, risk: ToolRiskLevel): "allow" | "ask" | "deny" {
  // safe 工具（纯计算、纯检索本地内置数据）任何档位都允许
  if (risk === "safe") return "allow";

  switch (level) {
    case "read-only":
      return risk === "fs-read" || risk === "network" || risk === "input-control" ? "allow" : "deny";
    case "scoped":
      // 指定目录档：fs 读写允许（具体路径校验在工具内部做），shell 拒绝
      if (risk === "fs-read" || risk === "fs-write" || risk === "network") return "allow";
      return "deny";
    case "per-action":
      // 每次审批：除 safe 外都弹审批
      return "ask";
    case "full":
      return "allow";
  }
}

// Cyrene is intentionally pinned to the companion-safe profile. It may observe,
// use the network, and control the companion UI, but it may not mutate files or
// launch arbitrary commands/processes.
const COMPANION_LEVEL: AgentFileAccessLevel = "read-only";

// ── 当前档位的内存缓存（main 进程持有） ───────────────────
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
  console.log(LOG_PREFIX, "档位切换:", currentLevel, "→", level);
  currentLevel = level;
  persistLevel(level, allowedRoot);
}

export function setAllowedRoot(rootPath: string | null): void {
  allowedRoot = rootPath;
  console.log(LOG_PREFIX, "设置授权目录:", allowedRoot);
  persistLevel(currentLevel, allowedRoot);
}

export function isPathWithinScopedRoot(targetPath: string): boolean {
  if (!allowedRoot) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(allowedRoot);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

// ── 持久化 ────────────────────────────────────────────────

function getStorePath(): string {
  return path.join(app.getPath("userData"), "agent-permission.json");
}

function persistLevel(level: AgentFileAccessLevel, root: string | null): void {
  try {
    const filePath = getStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ level, allowedRoot: root }, null, 2), "utf8");
  } catch (err) {
    console.error(LOG_PREFIX, "持久化档位失败:", err);
  }
}

/**
 * 启动时从磁盘加载上次保存的档位；不存在则用默认 read-only。
 * 必须在 app.whenReady 之后调用（依赖 app.getPath）。
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
      console.warn(LOG_PREFIX, "档位文件内容无效，回退默认");
    }
  } catch (err) {
    console.error(LOG_PREFIX, "加载档位失败:", err);
  }
}

// ── 审批弹窗（per-action 档位下使用） ─────────────────────
// 通过 IPC 把审批请求发到任意一个有焦点的窗口（一般是 chat 或 settings），
// 渲染端弹一个卡片，用户点同意/拒绝后回传结果。

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
 * 向用户发起一次审批请求，等用户点同意/拒绝。
 * 60 秒不响应自动拒绝。
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
      console.warn(LOG_PREFIX, "无可信审批窗口，自动拒绝");
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      console.warn(LOG_PREFIX, "审批超时（60s 未响应），自动拒绝:", request.toolId);
      resolve(false);
    }, 60_000);
    pendingApprovals.set(id, {
      resolve,
      timer,
      responderWebContentsIds: new Set(recipients.map((webContents) => webContents.id)),
    });

    const payload: ApprovalRequest = { id, ...request };
    console.log(LOG_PREFIX, "向渲染端发送审批请求:", id, request.toolId);

    for (const webContents of recipients) {
      webContents.send(IPC.PERMISSION_APPROVAL_REQUEST, payload);
    }
  });
}

// ── IPC 注册 ──────────────────────────────────────────────

export function registerPermissionIpc(options: PermissionIpcOptions = {}): void {
  const canSetLevel = options.canSetLevel ?? defaultCanSetLevel;
  const isApprovalUi = options.isApprovalUi ?? defaultIsApprovalUi;
  approvalUiPolicy = isApprovalUi;

  ipcMain.handle(IPC.PERMISSION_GET_LEVEL, () => {
    return { level: currentLevel };
  });

  ipcMain.handle(IPC.PERMISSION_SET_LEVEL, (event, level: AgentFileAccessLevel) => {
    if (!canSetLevel(event)) {
      console.warn(LOG_PREFIX, "拒绝非可信渲染端切换权限档位:", event.sender.id);
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

  // 渲染端审批 UI 回传结果
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
 * 一站式权限检查：根据当前档位 + 工具危险等级，决定执行/审批/拒绝。
 * - allow → 返回 true
 * - ask   → 触发审批，等用户回应
 * - deny  → 返回 false
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
    // 强制校验 scoped 文件路径
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
  // ask → 弹审批
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
