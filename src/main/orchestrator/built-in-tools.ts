// Builtin high-risk tools: fetch_url / run_shell / install_mcp_server
// Governed by permission gateway: fetch_url=network, run_shell=shell, install_mcp_server=fs-write

import { spawn } from "child_process";
import { toolRegistry } from "./tool-registry";
import { addMcpServer } from "./mcp-manager";
import { sendToLive2DWindow } from "../index";
import { createPlayLive2DActionTool } from "./tools/play-live2d-action";
import { resolveChatContextTimezone } from "../chat-time-context";

const LOG_PREFIX = "[BuiltinTools]";

/**
 * Unified timezone injection: index.ts calls setUserTimezoneConfig on startup.
 * Time formatting in tools must use `currentUserTimezone()`.
 */
let userTimezoneGetter: (() => string | undefined) | null = null;

export function setUserTimezoneConfig(timezoneGetter: () => string | undefined): void {
  userTimezoneGetter = timezoneGetter;
}

/** Current user valid timezone (defaults to Asia/Shanghai). */
export function currentUserTimezone(): string {
  const raw = userTimezoneGetter?.();
  return resolveChatContextTimezone(raw);
}

// -- Tool 1: fetch_url ------------------------------------
// Fetches URL plain text / Markdown body, used for reading READMEs etc.

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 512 * 1024; // Max 512KB to avoid context blowup

// HTML -> Markdown sanitization: converts HTML to markdown via turndown
// Preserves heading hierarchy/lists/code blocks/tables/links
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",        // <h1>→# <h2>→##
  codeBlockStyle: "fenced",   // <pre><code> -> fenced code block
  bulletListMarker: "-",
  emDelimiter: "*",           // <em> -> *italic*
});

function stripHtml(html: string): string {
  // Remove script/style/comments first to avoid polluting markdown
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Convert to markdown (preserving structure), fallback to strip tags on failure
  try {
    const md = turndown.turndown(s);
    // Compress redundant blank lines (turndown sometimes leaves consecutive blank lines)
    return md.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // turndown parsing failed (malformed HTML), fallback to pure tag stripping
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

// -- Tool 2: run_shell ------------------------------------
// Run command on user machine, used for installing MCP servers via git/npm/pip
// Note: shell:false; command must be a real executable to avoid shell injection

const SHELL_TIMEOUT_MS = 5 * 60_000; // 5 minute fallback
const SHELL_MAX_OUTPUT = 16 * 1024;  // Max 16KB stdout/stderr per execution

interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/**
 * Normalize args into argv array. Models often pass "--version" as string (schema requires array),
 * without tolerance Array.isArray is false -> cmdArgs=[] -> starts bare interactive REPL hanging indefinitely.
 */
function normalizeArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === "string" && raw.trim()) return tokenizeArgs(raw);
  return [];
}

/** Simple argv tokenizer: respects single/double quotes, escaped spaces. Avoids shell invocation. */
function tokenizeArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** Reliably kill process tree. On Windows child.kill("SIGKILL") only terminates direct child. */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    // /T=tree /F=force kill entire process tree to prevent orphan processes
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
    });
  } else {
    try { child.kill("SIGKILL"); } catch { /* Ignore if already exited */ }
  }
}

function runShellOnce(command: string, args: string[], cwd?: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: cwd || undefined,
      shell: false,
      windowsHide: true,
      env: process.env,
      // stdin -> NUL: when interactive REPL is started accidentally, EOF causes immediate exit,
      // preventing timeout hangs waiting for stdin. stdout/stderr remain piped for output.
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
  // Tolerance: models often pass args as string (e.g. "--version"), normalizeArgs splits to argv array
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

// -- Tool 3: install_mcp_server ---------------------------
// Register {command, args, env} as new MCP server.
// Agent calls this tool to persist config + launch + discover tools in one step

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

// -- Tool 4: weather --------------------------------------
// Query real-time weather for specified city. City is optional--defaults to user default city.
// Supports two weather sources:
//   - open-meteo (zero-config default open-source API)
//   - amap (Amap weather, requires key)
// Default city / weather source / amapKey injected via setWeatherConfig (avoids circular deps).

const WEATHER_TIMEOUT_MS = 15_000;

/** Injected config getter (set by setWeatherConfig on startup). */
let weatherCityGetter: (() => string) | null = null;
let weatherSourceGetter: (() => string) | null = null;
let amapKeyGetter: (() => string) | null = null;
let weatherEnabledGetter: (() => boolean) | null = null;

/** Weather card callback: bridge sends Custom event to renderer with structured data. */
let weatherCardCallback: ((card: WeatherCardData) => void) | null = null;

/** Structured weather card data (used by renderer). */
export interface WeatherForecastDay {
  date: string;       // e.g. "Jul 29"
  weekDay: string;    // e.g. "Tue"
  textDay: string;    // e.g. "Cloudy"
  textNight: string;  // e.g. "Clear"
  hi: number;         // High temp
  lo: number;         // Low temp
  windDir: string;    // Wind direction
  windScale: string;  // Wind scale
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

/** WMO weather code -> emoji icon. */
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

/** Weather text -> emoji icon. */
function weatherIconFromText(text: string): string {
  if (/\b(?:clear|sunny)\b/i.test(text) || /\u6674/.test(text)) return "☀️";
  if (/\b(?:thunder|thunderstorm|lightning)\b/i.test(text) || /\u96f7/.test(text)) return "⛈️";
  if (/\b(?:heavy rain|torrential|shower)\b/i.test(text) || /\u5927\u96e8|\u66b4\u96e8/.test(text)) return "🌧️";
  if (/\b(?:rain|drizzle)\b/i.test(text) || /\u96e8/.test(text)) return "🌦️";
  if (/\b(?:blizzard|heavy snow)\b/i.test(text) || /\u5927\u96ea|\u66b4\u96ea/.test(text)) return "❄️";
  if (/\b(?:snow|sleet)\b/i.test(text) || /\u96ea/.test(text)) return "🌨️";
  if (/\b(?:fog|haze|mist)\b/i.test(text) || /\u96fe|\u973e/.test(text)) return "🌫️";
  if (/\b(?:overcast)\b/i.test(text) || /\u9634/.test(text)) return "☁️";
  if (/\b(?:cloud|cloudy)\b/i.test(text) || /\u4e91|\u591a\u4e91/.test(text)) return "⛅";
  if (/\b(?:wind|windy)\b/i.test(text) || /\u98ce/.test(text)) return "💨";
  return "🌤️";
}

/** Translate Amap's Chinese weather payload while retaining its raw-input compatibility. */
function translateAmapWeatherText(text: string): string {
  const exact: Record<string, string> = {
    "\u6674": "Clear", "\u5c11\u4e91": "Mostly clear", "\u6674\u95f4\u591a\u4e91": "Mostly clear", "\u591a\u4e91": "Cloudy", "\u9634": "Overcast",
    "\u9635\u96e8": "Rain showers", "\u96f7\u9635\u96e8": "Thunderstorms", "\u5c0f\u96e8": "Light rain", "\u4e2d\u96e8": "Rain",
    "\u5927\u96e8": "Heavy rain", "\u66b4\u96e8": "Torrential rain", "\u5c0f\u96ea": "Light snow", "\u4e2d\u96ea": "Snow",
    "\u5927\u96ea": "Heavy snow", "\u66b4\u96ea": "Blizzard", "\u96fe": "Fog", "\u973e": "Haze", "\u96e8\u5939\u96ea": "Sleet",
    "Clear": "Clear", "Mostly clear": "Mostly clear", "Cloudy": "Cloudy", "Overcast": "Overcast",
    "Rain showers": "Rain showers", "Thunderstorms": "Thunderstorms", "Light rain": "Light rain", "Rain": "Rain",
    "Heavy rain": "Heavy rain", "Torrential rain": "Torrential rain", "Light snow": "Light snow", "Snow": "Snow",
    "Heavy snow": "Heavy snow", "Blizzard": "Blizzard", "Fog": "Fog", "Haze": "Haze", "Sleet": "Sleet",
  };
  return exact[text.trim()] ?? "Unknown";
}

function translateAmapWindDirection(text: string): string {
  const exact: Record<string, string> = {
    "\u65e0\u98ce\u5411": "Variable", "\u5317": "N", "\u4e1c\u5317": "NE", "\u4e1c": "E", "\u4e1c\u5357": "SE",
    "\u5357": "S", "\u897f\u5357": "SW", "\u897f": "W", "\u897f\u5317": "NW",
    "Variable": "Variable", "N": "N", "NE": "NE", "E": "E", "SE": "SE",
    "S": "S", "SW": "SW", "W": "W", "NW": "NW",
  };
  const normalized = text.replace(/(?:\u98ce|wind)$/i, "").trim();
  return exact[normalized] ?? "Variable";
}

/** AQI -> description text + kaomoji. */
function aqiKaomoji(aqi: number): { text: string; kaomoji: string } {
  if (aqi <= 50) return { text: "Good", kaomoji: "(◕‿◕)" };
  if (aqi <= 100) return { text: "Moderate", kaomoji: "(´ー`)" };
  if (aqi <= 150) return { text: "Unhealthy for sensitive groups", kaomoji: "(´-ω-`)" };
  if (aqi <= 200) return { text: "Unhealthy", kaomoji: "(；´д`)" };
  return { text: "Very unhealthy", kaomoji: "(╥﹏╥)" };
}

/** UV index -> description text. */
function uvText(uv: number): string {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very high";
  return "Extreme";
}

/**
 * Called on startup to inject default city / weather source / amapKey / card callback getters.
 * source: "open-meteo" (zero-config default) | "amap"
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

// -- Open-Meteo implementation (keyless, zero config) --

interface OMCity { name: string; latitude: number; longitude: number; country: string; admin1?: string }

/** Open-Meteo city geocoding query. */
async function omResolveCity(city: string): Promise<OMCity | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
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

/** Open-Meteo real-time weather query. */
async function omFetchWeather(city: string): Promise<string> {
  const loc = await omResolveCity(city);
  if (!loc) {
    return `[Error] City "${city}" was not found. Please check the city name (e.g. Hanoi, Tokyo, London).`;
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

    // Parse 3-day forecast (today + next 2 days)
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

    // Send weather card data to renderer
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

/** WMO weather code -> description text. */
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

/** Wind direction angle -> compass text. */
function omWindDir(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// -- Amap weather implementation (requires key) --

interface AmapDistrict { adcode: string; name: string; level: string }

/** Amap district query: city name -> adcode. */
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

/** Amap real-time weather query. */
async function amapFetchWeather(city: string, key: string): Promise<string> {
  const district = await amapResolveAdcode(city, key);
  if (!district) {
    return `[Error] City "${city}" was not found. Check the city name; Chinese city names are supported.`;
  }

  // Request live + forecast in parallel
  const baseUrl = `https://restapi.amap.com/v3/weather/weatherInfo?city=${district.adcode}&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
  try {
    const [baseResp, forecastResp] = await Promise.all([
      fetch(`${baseUrl}&extensions=base`, { signal: ctrl.signal }),
      fetch(`${baseUrl}&extensions=all`, { signal: ctrl.signal }),
    ]);

    // Parse live weather
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

    // Parse forecast
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

    // Send weather card data to renderer
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

  // City: argument preferred, fallback to user default city
  let city = String(args.city ?? "").trim();
  if (!city) {
    city = (weatherCityGetter?.() ?? "").trim();
  }
  // City resolution log to check user city parameters.
  // Sanitized: only city name and source tag recorded; no credentials.
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
    city = "Hanoi";
  }
  if (!city) {
    return "[Notice] No city was provided and no default city is configured. Ask the user to set one under Settings > Plugins > Weather or provide a city name.";
  }

  // Branch by weather source
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

  // Unknown weather source
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

// -- Tool 5: web_search -----------------------------------
// Web search: takes keywords, returns title/link/snippet structured data.
// key injected via setSearchConfig (avoids circular dependencies).

const SEARCH_TIMEOUT_MS = 20_000;

/** Injected search config getter. */
let searchEngineGetter: (() => string) | null = null;
let searchBochaKeyGetter: (() => string) | null = null;
let searchTavilyKeyGetter: (() => string) | null = null;

/**
 * Called on startup to inject search engine and API key getters.
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

/** Unified search result structure */
interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

/** Unified search output structure */
interface WebSearchOutput {
  success: true;
  query: string;
  resultCount: number;
  results: WebSearchResult[];
}

/** Max snippet length */
const MAX_SNIPPET_LEN = 500;
/** Max projection items */
const MAX_PROJECTION_RESULTS = 8;

/** Truncate snippet */
function truncateSnippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_SNIPPET_LEN ? clean.slice(0, MAX_SNIPPET_LEN) + "..." : clean;
}

/** Bocha search: calls /v1/web-search, returns structured JSON. */
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

/** Tavily search: calls /search, returns structured JSON. */
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

/** DuckDuckGo free search: keyless direct search. */
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

// -- Tool: todo_write -------------------------------------
// Task decomposition tool allowing complex tasks to be displayed in structured steps.
// Overwrites entire list on invocation. Persisted + forwards CUSTOM event to renderer.

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

    // Empty list = clear (task complete)
    if (items.length === 0) {
      clearTodos();
      return "[todo_write] Task list cleared; the task is finished.";
    }

    const state = setTodos(items);

    // Short summary returned to LLM (conserves tokens)
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

// Exposed to index.ts on startup to avoid tree-shaking
export { loadTodos, onTodosChange, getTodos as getCurrentTodos } from "./todo-store";

// -- Tool: ask_user_choice (disambiguation) ----------------
// Shows choice card when user requirements are ambiguous.
// Blocks until user selects an option, returning chosen value.
// Generic design for options across documents and assets.

import { requestUserChoice, type ChoiceOption } from "../user-choice";
import { runSubAgent, setDelegateSettings } from "./sub-agent";

export { setDelegateSettings };
// Delegate heavy task to isolated sub-agent FC loop.
// Returns structured summary without polluting main conversation.
toolRegistry.register({
  id: "delegate_task",
  name: "Delegate task",
  description:
    "Delegates a multi-step tool task to an isolated sub-agent and returns a structured summary with status, artifacts, and key facts. Use when at least two tool steps can run without user confirmation or when large intermediate data should stay out of the main conversation. Do not use for single-step work, tasks requiring user interaction, or simple spreadsheet generation. Parameter: task, a complete standalone description.",
  enabled: true,
  risk: "safe",
  hideInPlanMode: true,  // Sub-agent uses separate loop
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

// -- Tool: ask_user_choice (disambiguation) ----------------
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
    // Find selected option, return label + value for LLM comprehension
    const selected = options.find(o => o.value === userChoice);
    if (selected) {
      return `[ask_user_choice] The user selected ${selected.label} (${userChoice}). Continue with this choice.`;
    }
    // Custom user input (value not in preset options)
    return `[ask_user_choice] The user provided a custom choice: ${userChoice}. Follow this request.`;
  },
});

toolRegistry.register(createPlayLive2DActionTool({ sendToLive2DWindow }));
