/**
 * Language alias mapping + display names.
 *
 * Shiki accepts only valid language IDs (such as typescript / powershell / batch).
 * `cmd` / `bat` / `ps1` serve only as local aliases, not registered directly in Shiki.
 * Unknown languages gracefully degrade to `text`.
 */

/** Shiki valid language ID allowlist (consistent with preloaded list in code-highlighter.ts) */
const SHIKI_LANGS = new Set([
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "powershell",
  "bash",
  "batch",
  "json",
  "html",
  "css",
  "sql",
  "text",
]);

/** User-written aliases -> Shiki valid IDs */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",

  js: "javascript",
  javascript: "javascript",

  py: "python",
  python: "python",

  java: "java",

  c: "c",

  cpp: "cpp",
  "c++": "cpp",

  cs: "csharp",
  csharp: "csharp",
  "c#": "csharp",

  ps1: "powershell",
  pwsh: "powershell",
  powershell: "powershell",

  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",

  cmd: "batch",
  bat: "batch",
  batch: "batch",

  json: "json",

  html: "html",
  htm: "html",

  css: "css",

  sql: "sql",

  plaintext: "text",
  plain: "text",
  txt: "text",
  text: "text",
  "": "text",
};

/** Shiki valid IDs -> User-facing display names */
const DISPLAY_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  powershell: "PowerShell",
  bash: "Bash",
  batch: "CMD / Batch",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  text: "Code",
};

/**
 * Normalizes fence info string (e.g. `ts` / `c++` / `powershell`) to a valid Shiki ID.
 * Unknown or unlisted languages degrade to `text`.
 */
export function normalizeLang(input: string | undefined): string {
  const key = (input ?? "").trim().toLowerCase();
  const resolved = ALIASES[key];
  if (resolved && SHIKI_LANGS.has(resolved)) return resolved;
  return "text";
}

/**
 * Gets language display name. Input should be the return value of normalizeLang.
 */
export function getLanguageDisplayName(lang: string): string {
  return DISPLAY_NAMES[lang] ?? "Code";
}
