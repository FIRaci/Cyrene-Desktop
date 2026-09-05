/**
 * Shiki code syntax highlighter singleton.
 *
 * Lifecycle:
 * - `initHighlighter()` runs asynchronously once during chat module initialization and returns a Promise.
 * - `codeToHtml(code, rawLang)` is synchronous: if highlighter is ready, calls `highlighter.codeToHtml()`;
 *   otherwise returns fallback HTML (safe plain text `<pre><code>`).
 * - Never await or loadLanguage in synchronous code paths.
 * - Preloads 15 whitelisted languages; unknown languages degrade to text.
 *
 * Theme strategy:
 * - Selects `github-dark` / `github-light` based on `document.documentElement.dataset.uiTheme`.
 * - Full rebuild triggered by chat render() upon theme switch.
 */

import { createHighlighter, type Highlighter } from "shiki";

import { normalizeLang } from "./language-normalizer";

/** Preloaded language allowlist */
const PRELOADED_LANGS = [
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
] as const;

/** Preloaded themes */
const PRELOADED_THEMES = ["github-dark", "github-light"] as const;

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighter: Highlighter | null = null;

/**
 * Asynchronously initialize Shiki highlighter singleton.
 * Called once during chat module load (without await); once initialized, `highlighter` is populated.
 */
export function initHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighter({
    themes: [...PRELOADED_THEMES],
    langs: [...PRELOADED_LANGS],
  });

  highlighterPromise
    .then((h) => {
      highlighter = h;
    })
    .catch((err) => {
      console.error("[Shiki] initialization failed:", err);
      highlighterPromise = null; // Allow retry
    });

  return highlighterPromise;
}

/** Check synchronously whether Shiki is ready */
export function isHighlighterReady(): boolean {
  return highlighter !== null;
}

/**
 * Get Shiki theme name based on active UI theme.
 */
function getCurrentThemeName(): string {
  const uiTheme = document.documentElement.dataset.uiTheme;
  return uiTheme === "pearl-white" ? "github-light" : "github-dark";
}

/**
 * Synchronously highlight code. If Shiki is not ready or highlighting fails, returns safe fallback HTML.
 *
 * Output format is `<pre class="shiki"><code>...</code></pre>` (including inline style).
 * Caller (markdown-renderer) is responsible for wrapping into `.code-block` wrapper + header.
 */
export function codeToHtml(code: string, rawLang: string | undefined): string {
  if (!highlighter) {
    return fallbackCodeHtml(code);
  }

  try {
    const lang = normalizeLang(rawLang);
    const theme = getCurrentThemeName();
    return highlighter.codeToHtml(code, { lang, theme });
  } catch (err) {
    console.warn("[Shiki] codeToHtml failed; falling back to plain text:", err);
    return fallbackCodeHtml(code);
  }
}

/**
 * Generate safe fallback code HTML.
 * Escapes code contents before inserting into `<pre><code>`.
 */
function fallbackCodeHtml(code: string): string {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="shiki"><code>${escaped}</code></pre>`;
}
