/**
 * Markdown rendering discriminated union result.
 *
 * - `html`: Rendering succeeded, `content` is a DOMPurify-sanitized HTML string safe for innerHTML.
 * - `text`: Rendering failed (markdown-it / KaTeX / DOMPurify exception), `content` is raw Markdown text,
 *   caller must use textContent and must not write to innerHTML.
 */
export type MarkdownRenderResult =
  | { mode: "html"; content: string }
  | { mode: "text"; content: string };
