/**
 * Streaming Markdown block parser.
 *
 * Uses markdown-it.parse() to extract top-level blocks from tokens,
 * computing character offsets for each block in the original text.
 *
 * Top-level block definition: nesting=0 block-level token groups (such as heading, paragraph_open/close, fence, list_open/close, etc.).
 * Keeps the last N blocks as mutable tail, marking previous ones as committed.
 */

import MarkdownIt from "markdown-it";

export type StreamMarkdownBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "blockquote"
  | "table"
  | "fence"
  | "code"
  | "hr"
  | "other";

export interface StreamMarkdownBlock {
  /** Unique identifier (type + index) for cross-revision tracking */
  key: string;
  type: StreamMarkdownBlockType;
  /** Starting character offset in raw text */
  startOffset: number;
  /** Ending character offset in raw text (exclusive) */
  endOffset: number;
  /** Raw markdown text of this block */
  raw: string;
  /** Whether fenced code block has closing fence */
  closed: boolean;
  /** Fingerprint (type + raw) used for dirty checking */
  fingerprint: string;
}

/**
 * Parses raw markdown text into a list of top-level blocks.
 *
 * @param md markdown-it instance
 * @param raw Raw markdown text
 * @returns List of top-level blocks in appearance order
 */
export function parseStreamingBlocks(md: MarkdownIt, raw: string): StreamMarkdownBlock[] {
  if (!raw.trim()) return [];

  const tokens = md.parse(raw, {});
  if (tokens.length === 0) return [];

  // Precompute line index -> character offset map
  const lineOffsets = computeLineOffsets(raw);

  const blocks: StreamMarkdownBlock[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Skip non-block-level tokens (e.g. inline)
    if (token.level > 0 || token.type === "inline") {
      i++;
      continue;
    }

    // Identify block type
    const blockInfo = identifyBlock(tokens, i);
    if (!blockInfo) {
      i++;
      continue;
    }

    const { type, endIndex, closed } = blockInfo;

    // Calculate offsets
    const startLine = token.map?.[0] ?? 0;
    const endToken = tokens[endIndex];
    const endLine = endToken.map?.[1] ?? startLine + 1;

    const startOffset = lineOffsets[startLine] ?? 0;
    const endOffset = endLine < lineOffsets.length ? lineOffsets[endLine] : raw.length;

    // Raw text (including trailing newline)
    let blockRaw = raw.slice(startOffset, endOffset);
    // If last block without trailing newline, include through end of raw
    if (endIndex >= tokens.length - 1) {
      blockRaw = raw.slice(startOffset);
    }

    blocks.push({
      key: `${type}-${blockIndex}`,
      type,
      startOffset,
      endOffset: startOffset + blockRaw.length,
      raw: blockRaw,
      closed,
      fingerprint: `${type}:${blockRaw}`,
    });

    blockIndex++;
    i = endIndex + 1;
  }

  return blocks;
}

/**
 * Identifies block type and closing token index starting at index i.
 */
function identifyBlock(
  tokens: MarkdownIt.Token[],
  i: number,
): { type: StreamMarkdownBlockType; endIndex: number; closed: boolean } | null {
  const token = tokens[i];
  const type = token.type;

  // fence: single token with content and info
  if (type === "fence") {
    return { type: "fence", endIndex: i, closed: true };
  }

  // code_block: indented code
  if (type === "code_block") {
    return { type: "code", endIndex: i, closed: true };
  }

  // hr
  if (type === "hr") {
    return { type: "hr", endIndex: i, closed: true };
  }

  // heading_open ... heading_close
  if (type === "heading_open") {
    return findClose(tokens, i, "heading_close", "heading");
  }

  // paragraph_open ... paragraph_close
  if (type === "paragraph_open") {
    return findClose(tokens, i, "paragraph_close", "paragraph");
  }

  // blockquote_open ... blockquote_close
  if (type === "blockquote_open") {
    return findClose(tokens, i, "blockquote_close", "blockquote");
  }

  // bullet_list_start / ordered_list_start ... list end
  if (type === "bullet_list_open" || type === "ordered_list_open") {
    const closeType = type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close";
    return findClose(tokens, i, closeType, "list");
  }

  // table_open ... table_close
  if (type === "table_open") {
    return findClose(tokens, i, "table_close", "table");
  }

  // html_block: single token
  if (type === "html_block") {
    return { type: "other", endIndex: i, closed: true };
  }

  // Other unknown block tokens
  return { type: "other", endIndex: i, closed: true };
}

/**
 * Finds matching close token (handling nested blocks).
 * If close token not found (unclosed), returns last token.
 */
function findClose(
  tokens: MarkdownIt.Token[],
  startIndex: number,
  closeType: string,
  blockType: StreamMarkdownBlockType,
): { type: StreamMarkdownBlockType; endIndex: number; closed: boolean } {
  let depth = 1;
  for (let j = startIndex + 1; j < tokens.length; j++) {
    if (tokens[j].type === tokens[startIndex].type) depth++;
    if (tokens[j].type === closeType) {
      depth--;
      if (depth === 0) {
        return { type: blockType, endIndex: j, closed: true };
      }
    }
  }
  // Unclosed
  return { type: blockType, endIndex: tokens.length - 1, closed: false };
}

/**
 * Precomputes character start offset for each line.
 * lineOffsets[0] = 0, lineOffsets[n] = start offset of line n.
 */
function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Splits block list into committed blocks and mutable tail.
 *
 * @param blocks All parsed blocks
 * @param mutableCount Number of blocks reserved as mutable (default 2)
 * @returns { committed: StreamMarkdownBlock[], mutable: StreamMarkdownBlock[] }
 */
export function splitCommittedAndMutable(
  blocks: StreamMarkdownBlock[],
  mutableCount = 2,
): { committed: StreamMarkdownBlock[]; mutable: StreamMarkdownBlock[] } {
  if (blocks.length <= mutableCount) {
    return { committed: [], mutable: blocks };
  }
  const splitIndex = blocks.length - mutableCount;
  return {
    committed: blocks.slice(0, splitIndex),
    mutable: blocks.slice(splitIndex),
  };
}
