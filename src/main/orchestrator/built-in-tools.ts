// 内置高危工具 — 给 agent 装上 fetch_url / run_shell / install_mcp_server 三件武器
// 全部走权限网关：fetch_url=network, run_shell=shell, install_mcp_server=fs-write

import { spawn } from "child_process";
import { toolRegistry } from "./tool-registry";
import { addMcpServer } from "./mcp-manager";
import { sendToLive2DWindow } from "../index";
import { createPlayLive2DActionTool } from "./tools/play-live2d-action";
import { resolveChatContextTimezone } from "../chat-time-context";

const LOG_PREFIX = "[BuiltinTools]";

/**
 * 工具侧统一 timezone 注入：index.ts 启动时调 setUserTimezoneConfig。
 * 任何工具要给模型格式化时间，统一走 `currentUserTimezone()`，禁止各自直接读 profile/Intl。
 */
let userTimezoneGetter: (() => string | undefined) | null = null;

export function setUserTimezoneConfig(timezoneGetter: () => string | undefined): void {
  userTimezoneGetter = timezoneGetter;
}

/** 当前用户的有效时区（缺/非法时回退 Asia/Shanghai）。统一封装，所有工具复用。 */
export function currentUserTimezone(): string {
  const raw = userTimezoneGetter?.();
  return resolveChatContextTimezone(raw);
}

// ── 工具 1：fetch_url ─────────────────────────────────────
// 拉一个 URL 的纯文本 / Markdown 形式的 body，给 agent 读 README 用

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 512 * 1024; // 单次最多 512KB，防止 LLM 上下文爆炸

// HTML → Markdown 清洗：用 turndown 转成 LLM 最易理解的 markdown 格式
// 保留标题层级/列表/代码块/表格/链接，比纯 strip 标签信息量大得多
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",        // <h1>→# <h2>→##
  codeBlockStyle: "fenced",   // <pre><code>→```围栏代码块（LLM 更认）
  bulletListMarker: "-",
  emDelimiter: "*",           // <em>→*斜体*
});

function stripHtml(html: string): string {
  // 先去 script/style/注释（turndown 不会自动去这些，留着会污染 markdown）
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // 转 markdown（保留结构），失败则退回纯 strip 标签
  try {
    const md = turndown.turndown(s);
    // 压缩多余空行（turndown 有时会留连续空行）
    return md.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // turndown 解析失败（畸形 HTML），退回原来的纯标签剥离
    s = s.replace(/<[^>]+>/g, " ");
    s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }
}

async function executeFetchUrl(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return "[Error] URL must start with http:// or https://.";
  }
  const asMarkdown = args.format === "markdown" || args.format === undefined;
  console.log(LOG_PREFIX, "fetch_url:", url, "format=" + (asMarkdown ? "markdown" : "raw"));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Cyrene Agent) Chrome/120 Safari/537.36",
        Accept: "text/html,text/markdown,text/plain,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!resp.ok) {
      return "[Error] HTTP " + resp.status + " " + resp.statusText;
    }
    const ctype = resp.headers.get("content-type") || "";
    const buf = await resp.arrayBuffer();
    const truncated = buf.byteLength > FETCH_MAX_BYTES;
    const slice = truncated ? buf.slice(0, FETCH_MAX_BYTES) : buf;
    let text = new TextDecoder("utf-8").decode(slice);
    if (asMarkdown && /text\/html|application\/xhtml/i.test(ctype)) {
      text = stripHtml(text);
    }
    const meta = "URL: " + url + "\nContent-Type: " + ctype + (truncated ? "\n[Truncated to " + FETCH_MAX_BYTES + " bytes]" : "") + "\n\n";
    return meta + text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Fetch failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

toolRegistry.register({
  id: "fetch_url",
  name: "Fetch URL",
  description:
    "Downloads a URL and returns its content. HTML is converted to structured Markdown while preserving headings, lists, code blocks, and tables.\n\n" +
    "Use when the user provides a specific URL, asks to read a link, needs a GitHub README or API document, or when a web search result needs closer inspection.\n" +
    "Do not use for keyword-only searches (use web_search), local files (use read_file), or general current-news questions (use web_search).\n\n" +
    "Parameters: url (required full HTTP(S) URL), format (optional markdown|raw; default markdown).",
  enabled: true,
  risk: "network",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full URL to fetch; must start with https:// or http://." },
      format: { type: "string", description: "markdown converts HTML to readable Markdown (default); raw returns the original response." },
    },
    required: ["url"],
  },
  execute: executeFetchUrl,
});

// ── 工具 2：run_shell ─────────────────────────────────────
// 在用户机器上跑一行命令，给 agent 装 MCP 时跑 git/npm/pip 等用
// 注意：不开 shell（spawn shell:false），命令必须是真正的可执行文件，避免 shell 注入

const SHELL_TIMEOUT_MS = 5 * 60_000; // 5 分钟兜底
const SHELL_MAX_OUTPUT = 16 * 1024;  // 单次最多 16KB stdout/stderr

interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/**
 * 把 args 规范化成 argv 数组。模型常把 "--version" 当字符串传（schema 要求数组），
 * 不容错的话 Array.isArray 判否 → cmdArgs=[] → 裸启动 python/node 的交互式 REPL，卡死。
 */
function normalizeArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string" && raw.trim()) return tokenizeArgs(raw);
  return [];
}

/** 简易 argv 分词：尊重单/双引号，处理转义空格。不引 shell（避免注入）。 */
function tokenizeArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** 可靠终止进程树。Windows 上 child.kill("SIGKILL") 只杀直接子进程，杀不掉孙进程。 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    // /T=含整棵子树  /F=强制  砍掉进程树，避免孙进程成为孤儿
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    });
  } else {
    try { child.kill("SIGKILL"); } catch { /* 已退出则忽略 */ }
  }
}

function runShellOnce(command: string, args: string[], cwd?: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd || undefined,
      shell: false,
      windowsHide: true,
      env: process.env,
      // stdin→/dev/null(NUL)：误启动交互式进程(python/node REPL)时让它读到 EOF 立即退出，
      // 不再卡在"等 stdin 输入"上耗满超时。stdout/stderr 仍 pipe 来收集输出。
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const timeoutTimer = setTimeout(() => {
      console.warn(LOG_PREFIX, "run_shell timed out; terminating process tree:", command);
      killTree(child);
    }, SHELL_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < SHELL_MAX_OUTPUT) {
        stdout += chunk.toString("utf8");
        if (stdout.length > SHELL_MAX_OUTPUT) {
          stdout = stdout.slice(0, SHELL_MAX_OUTPUT);
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < SHELL_MAX_OUTPUT) {
        stderr += chunk.toString("utf8");
        if (stderr.length > SHELL_MAX_OUTPUT) {
          stderr = stderr.slice(0, SHELL_MAX_OUTPUT);
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeoutTimer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + "\n[spawn error] " + err.message,
        truncated,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeoutTimer);
      resolve({ exitCode: code, stdout, stderr, truncated });
    });
  });
}

async function executeRunShell(args: Record<string, unknown>): Promise<string> {
  const cmd = String(args.command || "").trim();
  // 容错：模型常把 args 当字符串传（如 "--version"），normalizeArgs 会自动拆成 argv 数组
  const cmdArgs = normalizeArgs(args.args);
  const cwd = args.cwd ? String(args.cwd) : undefined;
  if (!cmd) return "[Error] command cannot be empty.";

  console.log(LOG_PREFIX, "run_shell:", cmd, JSON.stringify(cmdArgs), cwd ? "cwd=" + cwd : "");
  const result = await runShellOnce(cmd, cmdArgs, cwd);
  console.log(LOG_PREFIX, "run_shell completed exitCode=" + result.exitCode + " stdout.len=" + result.stdout.length + " stderr.len=" + result.stderr.length);

  const lines: string[] = [];
  lines.push("$ " + cmd + (cmdArgs.length ? " " + cmdArgs.join(" ") : ""));
  if (cwd) lines.push("(cwd: " + cwd + ")");
  lines.push("exitCode: " + result.exitCode);
  if (result.stdout) lines.push("--- stdout ---\n" + result.stdout.trimEnd());
  if (result.stderr) lines.push("--- stderr ---\n" + result.stderr.trimEnd());
  if (result.truncated) lines.push("[Output truncated]");
  return lines.join("\n");
}

toolRegistry.register({
  id: "run_shell",
  name: "Run command",
  description:
    "Runs a command directly on the user's computer without a shell and returns exitCode, stdout, and stderr. Use for Git, package-manager, development, and environment-inspection commands, or when the user explicitly asks to run a command.\n\n" +
    "Do not use to read files, list directories, fetch URLs, or perform work covered by a safer dedicated tool.\n\n" +
    "High risk: commands can modify the user's system and may require permission. Parameters: command, args as an argv array, and optional cwd.",
  enabled: true,
  risk: "shell",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name such as git or npm, or an absolute executable path." },
      args: { type: "array", description: "Command-line arguments as an argv array, for example ['clone', 'https://...']." },
      cwd: { type: "string", description: "Optional absolute working-directory path." },
    },
    required: ["command"],
  },
  execute: executeRunShell,
});

// ── 工具 3：install_mcp_server ────────────────────────────
// 把一个 {command, args, env} 注册成新的 MCP server。
// agent 读完 README 的 mcpServers 配置后，调这个工具一次性写盘 + 启动 + 发现工具

async function executeInstallMcp(args: Record<string, unknown>): Promise<string> {
  const id = (String(args.id || "").trim()) || ("mcp-" + Date.now());
  const name = String(args.name || "").trim() || id;
  const command = String(args.command || "").trim();
  if (!command) return "[Error] command cannot be empty.";

  const cmdArgs = Array.isArray(args.args) ? (args.args as unknown[]).map((x) => String(x)) : [];
  let env: Record<string, string> | undefined;
  if (args.env && typeof args.env === "object") {
    env = {};
    for (const [k, v] of Object.entries(args.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }
  const cwd = args.cwd ? String(args.cwd) : undefined;

  console.log(LOG_PREFIX, "install_mcp_server:", id, name, command, JSON.stringify(cmdArgs).slice(0, 200));
  if (env) console.log(LOG_PREFIX, "  env keys:", Object.keys(env).join(","));
  if (cwd) console.log(LOG_PREFIX, "  cwd:", cwd);

  try {
    const result = await addMcpServer({
      id,
      name,
      transport: "stdio",
      command,
      args: cmdArgs,
      env,
      cwd,
    });
    if (!result.ok) {
      return "[Error] Installation failed: " + (result.error || "Unknown error");
    }
    const tools = result.toolIds || [];
    return (
      "✅ MCP server \"" + name + "\" connected\n" +
      "id: " + id + "\n" +
      "command: " + command + (cmdArgs.length ? " " + cmdArgs.join(" ") : "") + "\n" +
      "Discovered " + tools.length + " tool(s)" + (tools.length ? ":\n  - " + tools.join("\n  - ") : "") + "\n" +
      "These tools are now available for use."
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Installation error: " + msg;
  }
}

toolRegistry.register({
  id: "install_mcp_server",
  name: "Install MCP server",
  description:
    "Adds an MCP server to Cyrene's tool registry by saving its configuration, starting it, and discovering its tools.\n\n" +
    "Use when the user explicitly asks to install an MCP server or supplies its repository/configuration. Read its README with fetch_url first, then pass the documented command, args, and env here.\n" +
    "Do not use for routine tool calls or general system-software installation.\n\n" +
    "Parameters: optional id, display name, executable command, args array, environment variables, and optional cwd.",
  enabled: true,
  risk: "fs-write",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Unique identifier; generated automatically when omitted." },
      name: { type: "string", description: "Display name, for example mail-mcp." },
      command: { type: "string", description: "Executable command such as node, pythonw, or npx." },
      args: { type: "array", description: "Command-line argument array." },
      env: { type: "object", description: "Environment-variable key-value pairs." },
      cwd: { type: "string", description: "Optional absolute working-directory path." },
    },
    required: ["command"],
  },
  execute: executeInstallMcp,
});

console.log(LOG_PREFIX, "Registered: fetch_url / run_shell / install_mcp_server");

// ── 工具 4：weather（天气查询）─────────────────────────────
// 查指定城市的实时天气。城市参数可选——没传就读用户信息的默认城市。
// 支持两个天气源：
//   - open-meteo（免配置默认，海外开源 API）
//   - amap（高德天气，国内数据准，需填 key）
// 默认城市/天气源/高德key 通过 setWeatherConfig 注入（避免 import index.ts 造成循环依赖）。

const WEATHER_TIMEOUT_MS = 15_000;

/** 注入的配置获取器（由 index.ts 启动时调 setWeatherConfig 设置）。 */
let weatherCityGetter: (() => string) | null = null;
let weatherSourceGetter: (() => string) | null = null;
let amapKeyGetter: (() => string) | null = null;
let weatherEnabledGetter: (() => boolean) | null = null;

/** 天气卡片数据回调：工具拿到结构化数据后调这个，由桥层发 Custom 事件给渲染端。 */
let weatherCardCallback: ((card: WeatherCardData) => void) | null = null;

/** 天气卡片结构化数据（发给渲染端渲染 MBE 卡片用）。 */
export interface WeatherForecastDay {
  date: string;       // "7月29日"
  weekDay: string;    // "周二"
  textDay: string;    // "多云"
  textNight: string;  // "晴"
  hi: number;         // 最高温
  lo: number;         // 最低温
  windDir: string;    // 风向
  windScale: string;  // 风力
}

export interface WeatherCardData {
  city: string;
  adm: string;
  temp: number;
  feelsLike?: number;
  text: string;
  icon: string;
  hi?: number;
  lo?: number;
  humidity: number;
  windDir: string;
  windScale: string;
  precip?: number;
  pressure?: number;
  visibility?: number;
  uv?: number;
  aqi?: number;
  aqiText?: string;
  source: string;
  updateTime: string;
  forecast?: WeatherForecastDay[];
}

/** WMO 天气代码 → emoji 图标。 */
function weatherIconFromCode(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "⛅";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67)) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

/** 高德天气文字 → emoji 图标。 */
function weatherIconFromText(text: string): string {
  if (/晴/.test(text)) return "☀️";
  if (/雷/.test(text)) return "⛈️";
  if (/大雨|暴雨/.test(text)) return "🌧️";
  if (/雨/.test(text)) return "🌦️";
  if (/大雪|暴雪/.test(text)) return "❄️";
  if (/雪/.test(text)) return "🌨️";
  if (/雾|霾/.test(text)) return "🌫️";
  if (/阴/.test(text)) return "☁️";
  if (/云|多云/.test(text)) return "⛅";
  if (/风/.test(text)) return "💨";
  return "🌤️";
}

/** Translate Amap's Chinese weather payload while retaining its raw-input compatibility. */
function translateAmapWeatherText(text: string): string {
  const exact: Record<string, string> = {
    "晴": "Clear", "少云": "Mostly clear", "晴间多云": "Mostly clear", "多云": "Cloudy", "阴": "Overcast",
    "阵雨": "Rain showers", "雷阵雨": "Thunderstorms", "小雨": "Light rain", "中雨": "Rain",
    "大雨": "Heavy rain", "暴雨": "Torrential rain", "小雪": "Light snow", "中雪": "Snow",
    "大雪": "Heavy snow", "暴雪": "Blizzard", "雾": "Fog", "霾": "Haze", "雨夹雪": "Sleet",
  };
  return exact[text.trim()] ?? "Unknown";
}

function translateAmapWindDirection(text: string): string {
  const exact: Record<string, string> = {
    "无风向": "Variable", "北": "N", "东北": "NE", "东": "E", "东南": "SE",
    "南": "S", "西南": "SW", "西": "W", "西北": "NW",
  };
  const normalized = text.replace(/风$/, "").trim();
  return exact[normalized] ?? "Variable";
}

/** AQI → 等级文字 + 颜文字。 */
function aqiKaomoji(aqi: number): { text: string; kaomoji: string } {
  if (aqi <= 50) return { text: "Good", kaomoji: "(◕‿◕)" };
  if (aqi <= 100) return { text: "Moderate", kaomoji: "(´ー`)" };
  if (aqi <= 150) return { text: "Unhealthy for sensitive groups", kaomoji: "(´-ω-`)" };
  if (aqi <= 200) return { text: "Unhealthy", kaomoji: "(；´д`)" };
  return { text: "Very unhealthy", kaomoji: "(╥﹏╥)" };
}

/** 紫外线指数 → 文字。 */
function uvText(uv: number): string {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}

/**
 * index.ts 启动时调用，注入默认城市/天气源/高德key/卡片回调 的读取器。
 * source: "open-meteo"（免配置默认）| "amap"（高德）
 */
export function setWeatherConfig(
  cityGetter: () => string,
  sourceGetter: () => string,
  amapKeyFn: () => string,
  cardCb?: (card: WeatherCardData) => void,
  enabledGetter?: () => boolean,
): void {
  weatherCityGetter = cityGetter;
  weatherSourceGetter = sourceGetter;
  amapKeyGetter = amapKeyFn;
  weatherEnabledGetter = enabledGetter ?? null;
  if (cardCb) weatherCardCallback = cardCb;
}

// ── Open-Meteo 实现（免 key 免配置）──

interface OMCity { name: string; latitude: number; longitude: number; country: string; admin1?: string }

/** Open-Meteo 城市查询（Geocoding API，免费免 key）。 */
async function omResolveCity(city: string): Promise<OMCity | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: OMCity[] };
    if (!data.results || data.results.length === 0) return null;
    return data.results[0];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Open-Meteo 实时天气查询（免费免 key）。 */
async function omFetchWeather(city: string): Promise<string> {
  const loc = await omResolveCity(city);
  if (!loc) {
    return `[Error] City "${city}" was not found. Check the city name; Chinese names and pinyin are supported.`;
  }
  const currentParams = [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature",
    "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m",
    "surface_pressure", "uv_index", "visibility",
  ].join(",");
  const dailyParams = ["temperature_2m_max", "temperature_2m_min", "weather_code", "wind_speed_10m_max", "wind_direction_10m_dominant"].join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=${currentParams}&daily=${dailyParams}&timezone=auto`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return `[Error] Weather lookup failed: HTTP ${resp.status}`;
    const data = await resp.json() as {
      current?: {
        temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number;
        precipitation: number; weather_code: number; wind_speed_10m: number;
        wind_direction_10m: number; surface_pressure: number;
        uv_index: number; visibility: number;
      };
      daily?: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        weather_code: number[];
        wind_speed_10m_max: number[];
        wind_direction_10m_dominant: number[];
      };
    };
    const c = data.current;
    if (!c) return "[Error] Weather lookup failed: Open-Meteo returned no data.";
    const wmoText = omWeatherCodeText(c.weather_code);
    const windDir = omWindDir(c.wind_direction_10m);
    const adm = loc.admin1 ? `${loc.admin1}` : loc.country;
    const icon = weatherIconFromCode(c.weather_code);

    // 解析 3 天预报（今天 + 未来 2 天）
    const weekNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const forecast: WeatherForecastDay[] = [];
    if (data.daily?.time) {
      const d = data.daily;
      const count = Math.min(d.time.length, 3);
      for (let i = 0; i < count; i++) {
        const dt = new Date(d.time[i] + "T00:00:00");
        forecast.push({
          date: `${dt.getMonth() + 1}/${dt.getDate()}`,
          weekDay: i === 0 ? "Today" : weekNames[dt.getDay()],
          textDay: omWeatherCodeText(d.weather_code[i]),
          textNight: omWeatherCodeText(d.weather_code[i]),
          hi: Math.round(d.temperature_2m_max[i]),
          lo: Math.round(d.temperature_2m_min[i]),
          windDir: omWindDir(d.wind_direction_10m_dominant[i]),
          windScale: `${Math.round(d.wind_speed_10m_max[i])}km/h`,
        });
      }
    }

    const weatherData = {
      city: loc.name,
      region: adm,
      weather: wmoText,
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windDirection: windDir,
      windSpeed: `${c.wind_speed_10m}km/h`,
      precipitation: c.precipitation,
      pressure: Math.round(c.surface_pressure),
      uv: c.uv_index,
      visibility: Math.round(c.visibility / 1000), // m → km
      source: "Open-Meteo",
      updateTime: new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: currentUserTimezone() }),
    };

    // 发送天气卡片数据给渲染端
    if (weatherCardCallback) {
      weatherCardCallback({
        city: weatherData.city, adm: weatherData.region, temp: weatherData.temperature,
        feelsLike: weatherData.feelsLike, text: weatherData.weather, icon,
        humidity: weatherData.humidity, windDir: weatherData.windDirection,
        windScale: weatherData.windSpeed, precip: weatherData.precipitation,
        pressure: weatherData.pressure, uv: weatherData.uv, visibility: weatherData.visibility,
        source: weatherData.source, updateTime: weatherData.updateTime,
        hi: forecast[0]?.hi, lo: forecast[0]?.lo,
        forecast,
      });
    }

    return JSON.stringify(weatherData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Weather lookup failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

/** WMO 天气代码 → 中文描述（Open-Meteo 用 WMO 标准代码）。 */
function omWeatherCodeText(code: number): string {
  const map: Record<number, string> = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Heavy freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Heavy freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers", 81: "Heavy rain showers", 82: "Violent rain showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
  };
  return map[code] ?? `Unknown (code ${code})`;
}

/** 风向角度 → 中文方位。 */
function omWindDir(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── 高德天气实现（需 key，国内数据准）──

interface AmapDistrict { adcode: string; name: string; level: string }

/** 高德行政区查询：城市名 → adcode。 */
async function amapResolveAdcode(city: string, key: string): Promise<AmapDistrict | null> {
  const url = `https://restapi.amap.com/v3/config/district?keywords=${encodeURIComponent(city)}&subdistrict=0&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json() as { status?: string; districts?: AmapDistrict[] };
    if (data.status !== "1" || !data.districts || data.districts.length === 0) return null;
    return data.districts[0];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 高德实时天气查询。 */
async function amapFetchWeather(city: string, key: string): Promise<string> {
  const district = await amapResolveAdcode(city, key);
  if (!district) {
    return `[Error] City "${city}" was not found. Check the city name; Chinese city names are supported.`;
  }

  // 并行请求实况 + 预报
  const baseUrl = `https://restapi.amap.com/v3/weather/weatherInfo?city=${district.adcode}&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  try {
    const [baseResp, forecastResp] = await Promise.all([
      fetch(`${baseUrl}&extensions=base`, { signal: ctrl.signal }),
      fetch(`${baseUrl}&extensions=all`, { signal: ctrl.signal }),
    ]);

    // 解析实况
    if (!baseResp.ok) return `[Error] Weather lookup failed: HTTP ${baseResp.status}`;
    const baseData = await baseResp.json() as { status?: string; lives?: Array<{
      province: string; city: string; weather: string; temperature: string;
      winddirection: string; windpower: string; humidity: string; reporttime: string;
    }> };
    if (baseData.status !== "1" || !baseData.lives || baseData.lives.length === 0) {
      return `[Error] Weather lookup failed: Amap returned status=${baseData.status ?? "?"}.`;
    }
    const w = baseData.lives[0];
    const icon = weatherIconFromText(w.weather);

    // 解析预报
    const forecast: WeatherForecastDay[] = [];
    if (forecastResp.ok) {
      const fcData = await forecastResp.json() as { status?: string; forecasts?: Array<{
        city: string; adcode: string; province: string;
        casts: Array<{
          date: string; week: string; dayweather: string; nightweather: string;
          daytemp: string; nighttemp: string; daywind: string; nightwind: string;
          daypower: string; nightpower: string;
        }>;
      }> };
      if (fcData.status === "1" && fcData.forecasts?.[0]?.casts) {
        const weekMap: Record<string, string> = { "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday" };
        const today = new Date().toISOString().slice(0, 10);
        for (const c of fcData.forecasts[0].casts) {
          const dt = new Date(c.date + "T00:00:00");
          forecast.push({
            date: `${dt.getMonth() + 1}/${dt.getDate()}`,
            weekDay: c.date === today ? "Today" : (weekMap[c.week] ?? `Day ${c.week}`),
            textDay: translateAmapWeatherText(c.dayweather),
            textNight: translateAmapWeatherText(c.nightweather),
            hi: Number(c.daytemp),
            lo: Number(c.nighttemp),
            windDir: translateAmapWindDirection(c.daywind),
            windScale: `Force ${c.daypower}`,
          });
        }
      }
    }

    const weatherData = {
      city: w.city,
      region: w.province,
      weather: translateAmapWeatherText(w.weather),
      temperature: Number(w.temperature),
      humidity: Number(w.humidity),
      windDirection: translateAmapWindDirection(w.winddirection),
      windSpeed: `Force ${w.windpower}`,
      source: "Amap Weather",
      updateTime: w.reporttime.slice(11, 16) || new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    };

    // 发送天气卡片数据给渲染端
    if (weatherCardCallback) {
      weatherCardCallback({
        city: weatherData.city, adm: weatherData.region, temp: weatherData.temperature,
        text: weatherData.weather, icon,
        humidity: weatherData.humidity, windDir: weatherData.windDirection,
        windScale: weatherData.windSpeed,
        source: weatherData.source, updateTime: weatherData.updateTime,
        hi: forecast[0]?.hi, lo: forecast[0]?.lo,
        forecast,
      });
    }

    return JSON.stringify(weatherData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Weather lookup failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

async function executeWeather(args: Record<string, unknown>): Promise<string> {
  if (weatherEnabledGetter && !weatherEnabledGetter()) {
    return "[Error] Weather feature is disabled. Please enable it in Settings.";
  }

  const source = weatherSourceGetter?.() ?? "open-meteo";

  // 城市：参数优先，没传读用户信息默认城市
  let city = String(args.city ?? "").trim();
  if (!city) {
    city = (weatherCityGetter?.() ?? "").trim();
  }
  // 城市解析日志：用于确认模型是否仍自行传入"上海"。
  // 脱敏：仅记城市名（公开地理名）+ 来源标签；不带用户 ID/任何凭证。
  const argsCityRaw = String(args.city ?? "").trim();
  const defaultCityRaw = (weatherCityGetter?.() ?? "").trim();
  const source2: "arg" | "default" | "none" = argsCityRaw
    ? "arg"
    : defaultCityRaw
      ? "default"
      : "none";
  console.log(
    `[Weather] city resolution: argsCity=${argsCityRaw || "(empty)"} defaultCity=${defaultCityRaw || "(empty)"} final=${city || "(empty)"} source=${source2}`,
  );
  if (!city) {
    return "[Notice] No city was provided and no default city is configured. Ask the user to set one under Settings > Profile or provide a city name.";
  }

  // 按天气源分支
  if (source === "open-meteo") {
    return omFetchWeather(city);
  }
  if (source === "amap") {
    const amapKey = amapKeyGetter?.() ?? "";
    if (!amapKey) {
      return "[Error] No Amap Weather key is configured. Add one under Settings > Plugins > Weather, or switch to Open-Meteo.";
    }
    return amapFetchWeather(city, amapKey);
  }

  // 未知天气源
  return `[Error] Unknown weather source "${source}". Select Open-Meteo or Amap Weather under Settings > Plugins > Weather.`;
}

toolRegistry.register({
  id: "weather",
  name: "Weather",
  description:
    "Gets current weather for a city, including temperature, apparent temperature, humidity, wind, precipitation, AQI, and UV data. Use for current conditions, clothing or umbrella advice, and short-range outdoor planning. Do not use for historical weather or precise hourly forecasts. The optional city may be supplied in any supported language or pinyin; when omitted, the configured default city is used.",
  enabled: true,
  risk: "network",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "Optional city name in any supported language or pinyin; defaults to the user's configured city." },
    },
    required: [],
  },
  soulActionLabel: "Checking weather",
  soulProjection: {
    projector: "entity_detail",
    source: "trusted_internal",
    fields: {
      title: "city",
      region: "region",
      weather: "weather",
      temperature: "temperature",
      feelsLike: "feelsLike",
      humidity: "humidity",
      windDirection: "windDirection",
      windSpeed: "windSpeed",
    },
  },
  completionEvidence: [
    { kind: "tool_succeeded" },
  ],
  execute: executeWeather,
});

// ── 工具 5：web_search（博查搜索）─────────────────────────
// 联网搜索：给关键词，返回搜索结果（标题/链接/摘要）。博查 API 返回 AI 友好的结构化数据。
// key 通过 setSearchConfig 注入（避免 import index.ts 造成循环依赖）。

const SEARCH_TIMEOUT_MS = 20_000;

/** 注入的搜索配置获取器。 */
let searchEngineGetter: (() => string) | null = null;
let searchBochaKeyGetter: (() => string) | null = null;
let searchTavilyKeyGetter: (() => string) | null = null;

/**
 * index.ts 启动时调用，注入搜索引擎/各源key 的读取器。
 * engine: "off" | "bocha" | "tavily" | "volcano" | "minimax"
 */
export function setSearchConfig(
  engineGetter: () => string,
  bochaKeyGetter: () => string,
  tavilyKeyGetter: () => string,
): void {
  searchEngineGetter = engineGetter;
  searchBochaKeyGetter = bochaKeyGetter;
  searchTavilyKeyGetter = tavilyKeyGetter;
}

interface BochaResult {
  name: string;
  url: string;
  snippet: string;
  summary?: string;
  siteName?: string;
}

/** 搜索结果统一结构 */
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

/** 搜索输出统一结构（ToolCallResult.output 的 JSON） */
interface WebSearchOutput {
  success: true;
  query: string;
  resultCount: number;
  results: WebSearchResult[];
}

/** snippet 最大长度 */
const MAX_SNIPPET_LEN = 500;
/** projection 最大条数 */
const MAX_PROJECTION_RESULTS = 8;

/** 截断 snippet */
function truncateSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_SNIPPET_LEN ? clean.slice(0, MAX_SNIPPET_LEN) + "..." : clean;
}

/** 博查搜索：调 /v1/web-search，返回结构化 JSON。 */
async function bochaSearch(query: string, key: string): Promise<string> {
  const url = "https://api.bochaai.com/v1/web-search";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        count: 8,
        summary: true,
      }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const raw = await resp.json() as {
      webPages?: { value?: BochaResult[] };
      data?: { webPages?: { value?: BochaResult[] } };
    };
    const bochaResults = raw.data?.webPages?.value ?? raw.webPages?.value ?? [];
    const results: WebSearchResult[] = bochaResults.map((r) => ({
      title: r.name,
      url: r.url,
      snippet: truncateSnippet(r.summary || r.snippet || ""),
      ...(r.siteName ? { source: r.siteName } : {}),
    }));
    const output: WebSearchOutput = {
      success: true,
      query,
      resultCount: results.length,
      results,
    };
    return JSON.stringify(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Search failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Tavily 搜索：调 /search，返回结构化 JSON。 */
async function tavilySearch(query: string, key: string): Promise<string> {
  const url = "https://api.tavily.com/search";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 8,
        include_answer: true,
      }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };
    const tavilyResults = data.results ?? [];
    const results: WebSearchResult[] = tavilyResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: truncateSnippet(data.answer && r.content ? `${data.answer}\n${r.content}` : r.content || ""),
    }));
    const output: WebSearchOutput = {
      success: true,
      query,
      resultCount: results.length,
      results,
    };
    return JSON.stringify(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Search failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** DuckDuckGo 免费搜索：无需 API Key，零门槛直连。 */
async function duckduckgoSearch(query: string): Promise<string> {
  const url = "https://html.duckduckgo.com/html/";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${encodeURIComponent(query)}`,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const html = await resp.text();
    const results: WebSearchResult[] = [];
    const blocks = html.split(/class=["']result\s+results_links/i);
    for (let i = 1; i < blocks.length; i++) {
      if (results.length >= 8) break;
      const block = blocks[i];
      const titleMatch = block.match(/class=["']result__title["'][\s\S]*?<a[^>]*class=["']result__a["'][^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>/i) || block.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\//i);
      const urlMatch = block.match(/class=["']result__url["'][^>]*href=["']([^"']*)["']/i) || block.match(/class=["']result__a["'][^>]*href=["']([^"']*)["']/i);
      if (titleMatch) {
        let title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        let resultUrl = urlMatch ? urlMatch[1].trim() : "";
        if (resultUrl.includes("uddg=")) {
          const match = resultUrl.match(/uddg=([^&]+)/);
          if (match) resultUrl = decodeURIComponent(match[1]);
        }
        if (resultUrl.includes("duckduckgo.com/y.js") || resultUrl.includes("ad_provider=")) {
          continue;
        }
        if (title && resultUrl) {
          results.push({
            title,
            url: resultUrl,
            snippet: truncateSnippet(snippet),
            source: "DuckDuckGo",
          });
        }
      }
    }
    const output: WebSearchOutput = {
      success: true,
      query,
      resultCount: results.length,
      results,
    };
    return JSON.stringify(output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Search failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

async function executeWebSearch(args: Record<string, unknown>): Promise<string> {
  const engine = searchEngineGetter?.() ?? "off";
  if (engine === "off") {
    throw new Error("E_SEARCH_NOT_ENABLED");
  }

  const query = String(args.query ?? "").trim();
  if (!query) {
    throw new Error("E_SEARCH_QUERY_EMPTY");
  }

  if (engine === "ddg" || engine === "duckduckgo") {
    return duckduckgoSearch(query);
  }

  if (engine === "bocha") {
    const key = searchBochaKeyGetter?.() ?? "";
    if (!key) {
      throw new Error("E_SEARCH_KEY_MISSING");
    }
    return bochaSearch(query, key);
  }

  if (engine === "tavily") {
    const key = searchTavilyKeyGetter?.() ?? "";
    if (!key) {
      throw new Error("E_SEARCH_KEY_MISSING");
    }
    return tavilySearch(query, key);
  }

  throw new Error(`E_SEARCH_ENGINE_NOT_SUPPORTED:${engine}`);
}

toolRegistry.register({
  id: "web_search",
  name: "Web search",
  description:
    "Searches the web for current information and returns result titles, URLs, and snippets. Use for news, prices, events, recent technology, or keyword queries without a specific URL. Use fetch_url when the user already supplied a URL, and use file tools for local files. Parameter: query (required search terms).",
  enabled: true,
  risk: "network",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
    },
    required: ["query"],
  },
  soulActionLabel: "Searching the web",
  soulProjection: {
    projector: "entity_list",
    source: "external_untrusted",
    itemsPath: "results",
    fields: {
      title: "title",
      url: "url",
      snippet: "snippet",
      source: "source",
    },
    maxItems: MAX_PROJECTION_RESULTS,
  },
  soulErrorMessages: {
    E_SEARCH_NOT_ENABLED: "Web search is disabled.",
    E_SEARCH_KEY_MISSING: "The search API key is not configured.",
    E_SEARCH_QUERY_EMPTY: "The search query is empty.",
  },
  completionEvidence: [
    { kind: "tool_succeeded" },
  ],
  execute: executeWebSearch,
});

// ── 工具：todo_write ──────────────────────────────────────
// 任务拆解可视化工具。让昔涟能像 Claude Code 一样把复杂任务拆成步骤展示给用户。
// 每次调用整体覆盖当前清单（不是增量）。store 持久化 + 通知主进程转发 CUSTOM 事件。

import { setTodos, getTodos, clearTodos, type TodoItem } from "./todo-store";

toolRegistry.register({
  id: "todo_write",
  name: "Task list",
  description:
    "Replaces the current task list so complex work can be shown as executable steps. For multi-step work, create the list before starting. Each call replaces the entire list; statuses are pending, in_progress, or completed. Mark the active step in_progress, completed steps completed, and send an empty list when the task is finished. Do not use for simple questions or casual conversation.",
  enabled: true,
  risk: "safe",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "Complete replacement task list. An empty array clears the list when work is finished.",
        items: {
          type: "object",
          properties: {
            id:       { type: "string", description: "Unique task identifier, such as 1, 2, or 3." },
            content:  { type: "string", description: "Task description." },
            status:   { type: "string", description: "Status: pending, in_progress, or completed." },
            priority: { type: "string", description: "Optional priority: high, medium, or low." },
          },
        },
      },
    },
    required: ["todos"],
  },
  execute: async (args) => {
    const items = (args.todos || []) as TodoItem[];

    // 空列表 = 清空（任务结束）
    if (items.length === 0) {
      clearTodos();
      return "[todo_write] Task list cleared; the task is finished.";
    }

    const state = setTodos(items);

    // 返回给 LLM 的简短摘要，不返回全部内容（避免 token 浪费）
    const counts = items.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return "[todo_write] Task list updated: " + items.length + " total; " +
      "in progress " + (counts.in_progress || 0) + " / " +
      "completed " + (counts.completed || 0) + " / " +
      "pending " + (counts.pending || 0) +
      ". updatedAt=" + state.updatedAt;
  },
});

// 暴露给 index.ts 在 startup 调用，避免 tree-shake 掉
export { loadTodos, onTodosChange, getTodos as getCurrentTodos } from "./todo-store";

// ── 工具：ask_user_choice（歧义消解器）─────────────────────
// 当用户需求模糊（"美观""好看""专业"）时，弹卡片让用户从选项中选择。
// 阻塞工具执行，等用户选完返回选中的 value 给 LLM。
// 通用设计：question + options 结构不绑死 Excel，PPT/Word/图片生成都能用。

import { requestUserChoice, type ChoiceOption } from "../user-choice";
import { runSubAgent, setDelegateSettings } from "./sub-agent";

export { setDelegateSettings };
// 把重任务委托给独立 FC 循环执行，子代理有自己的 conversation（用完即弃）。
// 执行完只返回结构化摘要给主 agent，不被重工具的过程数据（skill 正文、XML 文件等）污染。
toolRegistry.register({
  id: "delegate_task",
  name: "Delegate task",
  description:
    "Delegates a multi-step tool task to an isolated sub-agent and returns a structured summary with status, artifacts, and key facts. Use when at least two tool steps can run without user confirmation or when large intermediate data should stay out of the main conversation. Do not use for single-step work, tasks requiring user interaction, or simple spreadsheet generation. Parameter: task, a complete standalone description.",
  enabled: true,
  risk: "safe",
  hideInPlanMode: true,  // 子代理走旧 FC Loop，避免在 Plan 步骤里降级
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Complete standalone task description with enough detail for the sub-agent to execute independently." },
    },
    required: ["task"],
  },
  execute: async (args) => {
    const task = String(args.task || "");
    if (!task) return "[Error] task cannot be empty.";

    console.log(LOG_PREFIX, "delegate_task:", task.slice(0, 100));
    const result = await runSubAgent(task);

    if (result.status === "success") {
      let output = `[delegate_task] Sub-agent completed successfully: ${result.summary}`;
      if (result.artifacts && result.artifacts.length > 0) {
        output += `\nArtifacts: ${result.artifacts.join(", ")}`;
      }
      if (result.key_facts) {
        output += `\nKey facts: ${JSON.stringify(result.key_facts)}`;
      }
      return output;
    }

    let output = `[delegate_task] Sub-agent failed: ${result.summary}`;
    if (result.recoverable) {
      output += "\nRecoverable: try a different approach or use the relevant tool directly.";
    }
    return output;
  },
});

console.log(LOG_PREFIX, "Registered: fetch_url / run_shell / install_mcp_server / weather / web_search / ask_user_choice / delegate_task");

// ── 工具：ask_user_choice（歧义消解器）─────────────────────
toolRegistry.register({
  id: "ask_user_choice",
  name: "Ask user to choose",
  description:
    "Shows a choice card when the user's request has multiple reasonable interpretations and waits for a selection. Do not use when the request is already clear or when the user asks you to decide. Parameters: question, 2-5 options containing label/value/optional description, and an optional default value for timeout.",
  enabled: true,
  risk: "safe",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "Question to show the user, for example: Choose an Excel style." },
      options: {
        type: "array",
        description: "Array of 2-5 options, each with label, value, and an optional description.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "User-facing option label." },
            value: { type: "string", description: "Returned option value, such as simple-business." },
            description: { type: "string", description: "Optional explanation of the option." },
          },
        },
      },
      default: { type: "string", description: "Optional default value used after the 120-second timeout." },
    },
    required: ["question", "options"],
  },
  execute: async (args) => {
    const question = String(args.question || "");
    const options = (args.options || []) as ChoiceOption[];
    const defaultValue = args.default ? String(args.default) : undefined;

    if (!question) return "[Error] question cannot be empty.";
    if (!Array.isArray(options) || options.length < 2) {
      return "[Error] options must contain at least two choices.";
    }

    console.log(LOG_PREFIX, "ask_user_choice:", question, options.length + " options");
    const userChoice = await requestUserChoice(question, options, defaultValue);
    console.log(LOG_PREFIX, "User selected:", userChoice);

    if (!userChoice) {
      return "[ask_user_choice] The user did not select an option before timeout. Continue with the default approach.";
    }
    // 找到用户选的选项，返回 label + value 方便 LLM 理解
    const selected = options.find(o => o.value === userChoice);
    if (selected) {
      return `[ask_user_choice] The user selected ${selected.label} (${userChoice}). Continue with this choice.`;
    }
    // 用户自定义输入（value 不在预设选项里）
    return `[ask_user_choice] The user provided a custom choice: ${userChoice}. Follow this request.`;
  },
});

toolRegistry.register(createPlayLive2DActionTool({ sendToLive2DWindow }));
