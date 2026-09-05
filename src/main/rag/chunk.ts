// ── Sliding Window Chunking ──
// Slides by token count with overlap coverage.
// Automatically recognizes Markdown headings and prepends heading prefixes.

export interface Chunk {
  id: string;
  text: string;
  source: string;       // Source: filename or "memory"
  index: number;        // Chunk index
  metadata?: Record<string, unknown>;
}

export const DOCUMENT_CHUNK_SIZE = 512;
export const DOCUMENT_CHUNK_OVERLAP = 128;

// ── Token Estimation ──
// Estimation used to determine chunk boundaries; sliding window overlap provides tolerance.
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherTokens = text
    .replace(/[\u4e00-\u9fff]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return chineseChars + otherTokens;
}

// ── Text Position Index ──
// Positions boundaries at character level proportionally based on estimated token count.

interface CharSpan {
  start: number;   // Character index (inclusive)
  end: number;     // Character index (exclusive)
  text: string;
}

/** Find next sentence boundary from pos (period/question/exclamation/newline). Returns -1 if none. */
function findNextSentenceBoundary(text: string, pos: number): number {
  for (let i = pos; i < text.length; i++) {
    const c = text[i];
    if (c === "\u3002" || c === "\uff01" || c === "\uff1f" || c === "\n" || c === "." || c === "!" || c === "?") {
      // Skip consecutive punctuation
      let j = i + 1;
      while (j < text.length && "\u3002\uff01\uff1f\n.!?".includes(text[j])) j++;
      return j;
    }
  }
  return -1;
}

function* iterateSlidingWindowChars(
  text: string,
  chunkSize: number,
  overlap: number,
): Generator<CharSpan> {
  if (!text || !text.trim()) return;

  const totalChars = text.length;
  // If total tokens <= chunkSize, no split needed
  if (estimateTokens(text) <= chunkSize) {
    yield { start: 0, end: totalChars, text };
    return;
  }

  let previousSpan: CharSpan | null = null;
  const step = chunkSize - overlap;  // Step forward per window in tokens
  const totalTokens = estimateTokens(text);
  // Average characters per token
  const tokensPerChar = totalTokens / totalChars;

  let posStart = 0;  // Character start position
  let chunkIndex = 0;

  while (posStart < totalChars) {
    // Target token start position for current window
    const startToken = Math.round(posStart * tokensPerChar);
    const endToken = startToken + chunkSize;
    let posEndChar = Math.min(totalChars, Math.round(endToken / tokensPerChar));

    // Merge remaining content into previous chunk if < 1/3 chunkSize
    if (chunkIndex > 0 && (totalChars - posStart) < chunkSize * tokensPerChar * 0.33) {
      // Append remainder to previous chunk
      if (previousSpan) {
        previousSpan.text = text.slice(previousSpan.start);
        previousSpan.end = totalChars;
      }
      break;
    }

    // ── Sentence boundary protection ──
    // If posEndChar falls mid-sentence, extend to next sentence boundary.
    // Allow up to 20% of chunkSize extension to prevent long sentences from blowing up limit.
    const maxExtend = posEndChar + Math.round(chunkSize * 0.2 * tokensPerChar);
    const boundary = findNextSentenceBoundary(text, posEndChar);
    if (boundary !== -1 && boundary <= Math.min(maxExtend, totalChars)) {
      posEndChar = boundary;
    }

    if (previousSpan) yield previousSpan;
    previousSpan = {
      start: Math.round(posStart),
      end: posEndChar,
      text: text.slice(Math.round(posStart), posEndChar),
    };

    chunkIndex++;
    posStart += step / tokensPerChar;
  }

  if (previousSpan) yield previousSpan;
}

// ── Heading Prefix Extraction ──
interface TitleRecord {
  level: number;     // 1=#, 2=##, 3=###
  title: string;     // e.g. "3.1 Architecture"
  tokenPos: number;  // Estimated token position
}

function extractTitles(text: string): TitleRecord[] {
  const titles: TitleRecord[] = [];
  const lines = text.split("\n");
  let tokenPos = 0;

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      titles.push({
        level: match[1].length,
        title: match[2].trim(),
        tokenPos,
      });
    }
    tokenPos += estimateTokens(line + "\n");
  }

  return titles;
}

/** Generate heading prefix for a token position based on heading list */
function getTitlePrefix(tokenPos: number, titles: TitleRecord[]): string {
  // Find heading chain closest to current position
  const active: TitleRecord[] = [];
  for (const t of titles) {
    if (t.tokenPos > tokenPos) break;
    // Overwrite at same level
    while (active.length > 0 && active[active.length - 1].level >= t.level) {
      active.pop();
    }
    active.push(t);
  }

  if (active.length === 0) return "";
  return active.map((t) => t.title).join(" > ");
}

// ── Main Function ──
export function chunkText(
  text: string,
  source: string,
  chunkSize = DOCUMENT_CHUNK_SIZE,
  overlap = DOCUMENT_CHUNK_OVERLAP,
): Chunk[] {
  return Array.from(iterateDocumentChunks(text, source, chunkSize, overlap));
}

export function* iterateDocumentChunks(
  text: string,
  source: string,
  chunkSize = DOCUMENT_CHUNK_SIZE,
  overlap = DOCUMENT_CHUNK_OVERLAP,
): Generator<Chunk> {
  // Pre-extract headings (single scan)
  const titles = extractTitles(text);
  const hasTitles = titles.length > 0;

  // Sliding window chunking
  let i = 0;
  for (const span of iterateSlidingWindowChars(text, chunkSize, overlap)) {
    let chunkTextContent = span.text.trim();
    if (!chunkTextContent) continue;

    // Prepend heading prefix if available
    if (hasTitles) {
      // Calculate prefix using span start position
      const startTokenPos = Math.round(estimateTokens(text.slice(0, span.start)));
      const prefix = getTitlePrefix(startTokenPos, titles);
      if (prefix) {
        chunkTextContent = `【${prefix}】${chunkTextContent}`;
      }
    }

    yield {
      id: `${source}_${i}`,
      text: chunkTextContent,
      source,
      index: i,
    };
    i += 1;
  }
}
