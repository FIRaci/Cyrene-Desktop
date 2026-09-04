/**
 * Streaming block renderer.
 *
 * Two modes: committed blocks receive the full rendering pipeline once;
 * mutable blocks use a lightweight repeatable pipeline.
 *
 * Committed output is appended to stableRoot; the mutable tail replaces activeRoot.
 */

import DOMPurify from "dompurify";
import type MarkdownIt from "markdown-it";
import { codeToHtml } from "./code-highlighter";
import { normalizeLang, getLanguageDisplayName } from "./language-normalizer";
import { escapeHtml } from "./markdown-renderer";
import type { StreamMarkdownBlock } from "./streaming-block-parser";

/**
 * Render committed blocks with Shiki and KaTeX, returning sanitized HTML.
 */
export function renderCommittedBlock(md: MarkdownIt, block: StreamMarkdownBlock): string {
  try {
    // The shared Markdown instance already includes KaTeX, Shiki, and sanitization.
    const html = md.render(block.raw);
    return DOMPurify.sanitize(html);
  } catch (err) {
    console.error("[streaming-renderer] Failed to render committed block:", err);
    return `<pre>${escapeHtml(block.raw)}</pre>`;
  }
}

/**
 * Render the mutable tail with the lightweight pipeline and return sanitized HTML.
 *
 * During streaming, fenced code uses a plain wrapper without Shiki.
 */
export function renderMutableTail(md: MarkdownIt, blocks: StreamMarkdownBlock[]): string {
  if (blocks.length === 0) return "";

  try {
    // Combine the raw text of mutable blocks.
    const raw = blocks.map(b => b.raw).join("");

    // Reuse the shared renderer with a lightweight fence path.
    const html = renderWithStreamingFence(md, raw, blocks);
    return DOMPurify.sanitize(html);
  } catch (err) {
    console.error("[streaming-renderer] Failed to render mutable tail:", err);
    // Fall back to plain text.
    return blocks.map(b => `<pre>${escapeHtml(b.raw)}</pre>`).join("");
  }
}

/**
 * Render the mutable tail with the streaming fence renderer.
 *
 * Fenced blocks use an escaped plain code wrapper; other blocks use Markdown.
 *
 * Incomplete formulas remain readable until the block is committed.
 */
function renderWithStreamingFence(
  md: MarkdownIt,
  raw: string,
  blocks: StreamMarkdownBlock[],
): string {
  // Render each block independently; fenced blocks use the streaming wrapper.
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === "fence") {
      // Extract the language and source code.
      const lines = block.raw.split("\n");
      const firstLine = lines[0] ?? "";
      const langMatch = firstLine.match(/^```(\w*)/);
      const rawLang = langMatch?.[1] ?? "";
      const lang = normalizeLang(rawLang);
      const displayName = getLanguageDisplayName(lang);

      // Remove the opening and closing fences.
      const codeLines = lines.slice(1);
      if (codeLines.length > 0 && codeLines[codeLines.length - 1].trim().startsWith("```")) {
        codeLines.pop();
      }
      const code = codeLines.join("\n").replace(/\n$/, "");

      parts.push(
        `<div class="code-block code-block--streaming" data-language="${lang}">` +
        `<header class="code-block__header">` +
        `<span class="code-block__language">${displayName}</span>` +
        `<button type="button" class="code-block__copy">Copy</button>` +
        `</header>` +
        `<div class="code-block__code"><pre><code>${escapeHtml(code)}</code></pre></div>` +
        `</div>`,
      );
    } else {
      // Non-fenced blocks use Markdown; incomplete formulas are tolerated.
      try {
        parts.push(md.render(block.raw));
      } catch {
        parts.push(`<pre>${escapeHtml(block.raw)}</pre>`);
      }
    }
  }

  return parts.join("");
}

/**
 * Return whether a changed fingerprint requires re-rendering.
 */
export function blockChanged(
  oldBlock: StreamMarkdownBlock | undefined,
  newBlock: StreamMarkdownBlock,
): boolean {
  if (!oldBlock) return true;
  return oldBlock.fingerprint !== newBlock.fingerprint;
}
