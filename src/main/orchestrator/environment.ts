// Step 1 - Environment injection
//
// Facts like "what date is today / what OS / where is Desktop / current permissions / what tools available"
// that the model would otherwise guess are supplied directly as a system section.
// This layer eliminates low-level hallucinations (e.g. not knowing real Desktop path),
// laying the foundation for subsequent intent detection + tool_choice fallbacks.
//
// Output format uses Markdown sections for easy field parsing by LLM;
// logs `[Env]` to terminal for troubleshooting.

import { app } from "electron";
import * as os from "os";
import { toolRegistry } from "./tool-registry";
import { listMcpServers } from "./mcp-manager";
import { ACCESS_LEVEL_LABEL, getCurrentLevel, policyFor } from "../permission";
import type { ToolRiskLevel } from "../permission";
import { getCapability } from "./vendors/capabilities";
import { resolveChatContextTimezone } from "../chat-time-context";

const LOG_PREFIX = "[Env]";

/** Current model info (used to check capabilities such as vision), optional. */
export interface ModelInfo {
  provider: string;
  model: string;
}

/** User info slice (injected by index.ts, avoiding circular dependencies). */
export interface UserInfoContext {
  nickname?: string;
  callPreference?: string;
  birthday?: string;
  defaultCity?: string;
  timezone?: string;
  gender?: string;
}

function safeGetPath(name: "desktop" | "documents" | "downloads" | "home"): string {
  try {
    return app.getPath(name);
  } catch (err) {
    console.warn(LOG_PREFIX, "getPath failed:", name, err);
    return "";
  }
}

/**
 * Assembles date components in timezone tz into fixed `YYYY-MM-DD Day HH:MM` format.
 * Does not rely on localized punctuation/order from Intl (unstable across Node/locales);
 * uses formatToParts for structured fields.
 */
function formatDate(d: Date, tz: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
  } catch (err) {
    console.warn(LOG_PREFIX, "formatToParts failed; using system-local time:", err);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const week = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${week} ${hh}:${min}`;
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const weekdayRaw = get("weekday");
  // Maps weekday; fallback uses d.getDay()
  const weekMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const week = weekdayRaw || weekMap[d.getDay()];
  const hh = get("hour");
  const min = get("minute");
  return `${yyyy}-${mm}-${dd} ${week} ${hh}:${min}`;
}

function platformLabel(): string {
  const p = process.platform;
  if (p === "win32") return `Windows (${os.release()})`;
  if (p === "darwin") return `macOS (${os.release()})`;
  if (p === "linux") return `Linux (${os.release()})`;
  return `${p} (${os.release()})`;
}

/**
 * Constructs environment context, appended to system prompt.
 *
 * Note: only reads existing runtime state with no side effects;
 * callers handle try/catch to avoid disrupting main chat flow.
 */
export function buildEnvironmentContext(modelInfo?: ModelInfo, userInfo?: UserInfoContext): string {
  const level = getCurrentLevel();
  const levelLabel = ACCESS_LEVEL_LABEL[level];

  const desktop = safeGetPath("desktop");
  const documents = safeGetPath("documents");
  const downloads = safeGetPath("downloads");
  const home = safeGetPath("home");
  let username = "Unknown User";
  try {
    username = os.userInfo().username;
  } catch (err) {
    console.warn(LOG_PREFIX, "os.userInfo() lookup failed:", err);
  }
  // User timezone (defaults to Asia/Shanghai when profile.timezone is missing/invalid); does not read system timezone.
  const tz = resolveChatContextTimezone(userInfo?.timezone);
  const dateStr = formatDate(new Date(), tz);

  // Tool catalog: filtered by enabled + current permission level, so model only sees currently usable tools
  const allEnabled = toolRegistry.getEnabledTools();
  const allowedTools: string[] = [];
  const askTools: string[] = [];
  const deniedTools: string[] = [];
  for (const t of allEnabled) {
    const risk: ToolRiskLevel = t.risk ?? "safe";
    const verdict = policyFor(level, risk);
    if (verdict === "allow") allowedTools.push(`${t.id}(${risk})`);
    else if (verdict === "ask") askTools.push(`${t.id}(${risk})`);
    else deniedTools.push(`${t.id}(${risk})`);
  }

  // MCP server status
  let mcpLine = "No MCP servers connected";
  try {
    const servers = listMcpServers();
    if (servers.length > 0) {
      mcpLine = servers
        .map((s) => `${s.name}[${s.connected ? "connected" : "disconnected"}, ${s.toolCount} tools]`)
        .join(", ");
    }
  } catch (err) {
    console.warn(LOG_PREFIX, "Failed to list MCP servers:", err);
  }

  const lines: string[] = [];
  lines.push("## Runtime environment (actual machine state; do not guess)");
  lines.push("");
  lines.push(`- Current time: ${dateStr} (time zone ${tz})`);
  lines.push(`- Operating system: ${platformLabel()}`);
  lines.push(`- Current username: ${username}`);
  if (home) lines.push(`- Home directory: ${home}`);
  if (desktop) lines.push(`- Desktop path: ${desktop}`);
  if (documents) lines.push(`- Documents path: ${documents}`);
  if (downloads) lines.push(`- Downloads path: ${downloads}`);
  lines.push("");
  lines.push(`- File permission level: ${levelLabel} (${level})`);
  lines.push(`- Tools allowed without approval: ${allowedTools.length > 0 ? allowedTools.join(", ") : "(none)"}`);
  if (askTools.length > 0) {
    lines.push(`- Tools requiring approval: ${askTools.join(", ")}`);
  }
  if (deniedTools.length > 0) {
    lines.push(`- Tools denied at this permission level: ${deniedTools.join(", ")}`);
  }
  lines.push(`- MCP services: ${mcpLine}`);
  lines.push("");

  // Model capabilities: informs model whether it supports images,
  // so it honestly declines when unsupported rather than hallucinating.
  // Conservatively marks unsupported when modelInfo is absent.
  let supportsVision = false;
  if (modelInfo) {
    const cap = getCapability(modelInfo.provider);
    supportsVision = cap?.supportsVision ?? false;
  }
  lines.push(`- Current model image support: ${supportsVision ? "supported (use read_image)" : "unsupported (state this honestly and never invent image content)"}`);
  lines.push("");

  // User info: nickname, preferred address, birthday, default city, etc.
  // Avoids asking the user location/weather every time. Default city is used by weather tools.
  if (userInfo) {
    lines.push("## User information");
    lines.push("");
    if (userInfo.callPreference) {
      lines.push(`- Preferred form of address: ${userInfo.callPreference}`);
    } else if (userInfo.nickname) {
      lines.push(`- Nickname: ${userInfo.nickname}`);
    }
    if (userInfo.birthday) lines.push(`- Birthday: ${userInfo.birthday}`);
    if (userInfo.defaultCity) lines.push(`- Default city: ${userInfo.defaultCity} (use for weather or location requests when no other city is specified)`);
    if (userInfo.gender === "male") lines.push("- Gender: male");
    else if (userInfo.gender === "female") lines.push("- Gender: female");
    const preferredAddress = userInfo.callPreference?.trim() || userInfo.nickname?.trim();
    if (preferredAddress) {
      lines.push(`- Address usage: use "${preferredAddress}" naturally for an important question or confirmation, but not in every sentence.`);
    }
    if (userInfo.gender === "male") {
      lines.push("- Gender constraint: do not use feminine forms of address. Gender is only for avoiding misgendering; do not mention it proactively.");
    } else if (userInfo.gender === "female") {
      lines.push("- Gender constraint: do not use masculine forms of address. Gender is only for avoiding misgendering; do not mention it proactively.");
    } else {
      lines.push("- Gender constraint: when gender is unknown or private, use neutral address and never infer it from a nickname, avatar, or tone.");
    }
    lines.push("");
    // Timezone != location: explicitly instructs model that timezone and defaultCity are independent dimensions.
    lines.push("> The user's time zone is only for time calculations and does not reveal their location. Never infer a city from it. Use the default city only for tools that need a location, such as weather.");
    lines.push("");
  }

  lines.push(
    "When the user mentions Desktop, Documents, or Downloads without an absolute path, resolve it from the real paths above before using file tools. Do not use `~/Desktop` or a hard-coded drive letter.",
  );

  const text = lines.join("\n");

  console.log(
    LOG_PREFIX,
    `level=${level}`,
    `desktop=${desktop || "?"}`,
    `allowed=${allowedTools.length}`,
    `ask=${askTools.length}`,
    `deny=${deniedTools.length}`,
    `mcp=${mcpLine.startsWith("No MCP") ? "none" : "active"}`,
    `vision=${supportsVision}`,
  );

  return text;
}

