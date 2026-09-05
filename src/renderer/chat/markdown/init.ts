/**
 * Unified entry point for Markdown rendering module.
 *
 * main.ts imports only from `./markdown/init` without directly depending on internal modules.
 */

export { renderMarkdown, escapeHtml, getMd, MARKDOWN_PARSE_LIMIT, MESSAGE_CHAR_LIMIT, RENDER_VERSION } from "./markdown-renderer";
export { initCodeBlockController } from "./code-block-controller";
export { normalizeLang, getLanguageDisplayName } from "./language-normalizer";
export { createStreamingMarkdownSession } from "./streaming-markdown-session";
export type { StreamingMarkdownSession } from "./streaming-markdown-session";
export type { MarkdownRenderResult } from "./types";

import { initHighlighter, isHighlighterReady } from "./code-highlighter";
export { initHighlighter, isHighlighterReady };

import "./markdown.css";
import "katex/dist/katex.min.css";

/**
 * Initialize Markdown rendering system:
 * - Asynchronously start Shiki highlighter (no await, does not block chat)
 * - Code block copy button event delegation must be called separately by main.ts via initCodeBlockController
 */
export function initMarkdownRenderer(): void {
  void initHighlighter();
}
