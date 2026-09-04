// Step 1 — 环境注入
//
// 把"今天是几号 / 系统是什么 / 桌面在哪 / 当前权限档位 / 哪些工具可用"
// 这些模型本来要靠猜的事实，直接以 system 段落的形式喂给它。
// 这一层不解决"模型想不想调工具"，但能消掉"模型不知道桌面真实路径"
// 这一类低级幻觉，给后续的意图识别 + tool_choice 兜底打底。
//
// 输出格式刻意选择 Markdown 小节，方便 LLM 抓字段；同时在终端打印
// `[Env]` 日志便于排障。

import { app } from "electron";
import * as os from "os";
import { toolRegistry } from "./tool-registry";
import { listMcpServers } from "./mcp-manager";
import { ACCESS_LEVEL_LABEL, getCurrentLevel, policyFor } from "../permission";
import type { ToolRiskLevel } from "../permission";
import { getCapability } from "./vendors/capabilities";
import { resolveChatContextTimezone } from "../chat-time-context";

const LOG_PREFIX = "[Env]";

/** 当前模型信息（用于查 capability 判断视觉等能力），可选。 */
export interface ModelInfo {
  provider: string;
  model: string;
}

/** 用户信息片段（由 index.ts 注入，避免循环依赖）。 */
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
 * 把 d 在 tz 时区下的"年月日 星期 时分"按 part 类型固定组装成 `YYYY-MM-DD 周X HH:MM`。
 * 不依赖 Intl 本地化字符串的标点/顺序（不同 Node/locale 下 `format()` 输出不稳定），
 * 因此走 `formatToParts` 拿结构化字段，再固定拼装。
 * 注：short weekday 在 zh-CN 下通常是"周一"等，否则按 JS Date.getDay() 兜底映射。
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
  // zh-CN short weekday 形如"周一"；其它 locale 兜底按 d.getUTCDay() 映射
  // （注意：getUTCDay 对 tz 不是 tz 本地日，下方回退仅在 Intl 异常路径使用）。
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
 * 构造环境上下文，作为 system prompt 的尾段拼入。
 *
 * 注意：这里只读取既有运行时状态，不做任何副作用；调用方负责 try/catch
 * 拼接失败的情况，避免环境注入炸掉聊天主流程。
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
  // 用户时区（profile.timezone 缺/非法时由 resolver 回退 Asia/Shanghai），不再读系统时区。
  const tz = resolveChatContextTimezone(userInfo?.timezone);
  const dateStr = formatDate(new Date(), tz);

  // 工具清单：按"启用 + 当前档位放行"两个维度过滤，让模型只看到当下能用的
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

  // MCP server 状态
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

  // 模型能力边界：把"你当前这个模型能不能看图"作为事实告诉模型，
  // 让它遇到图片问题时敢于说"我看不了"，而不是硬编。
  // 没传 modelInfo（比如降级路径）时保守地告诉它"看不了"。
  let supportsVision = false;
  if (modelInfo) {
    const cap = getCapability(modelInfo.provider);
    supportsVision = cap?.supportsVision ?? false;
  }
  lines.push(`- Current model image support: ${supportsVision ? "supported (use read_image)" : "unsupported (state this honestly and never invent image content)"}`);
  lines.push("");

  // 用户信息：昵称、称呼偏好、生日、默认城市等。让模型知道"在和谁说话、用户在哪"，
  // 避免每次问天气/位置都要反问用户。默认城市尤其重要——天气工具会用到。
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
    // 时区≠地点：明确告知模型 timezone 与 defaultCity 是两个独立维度，不得交叉推断。
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

