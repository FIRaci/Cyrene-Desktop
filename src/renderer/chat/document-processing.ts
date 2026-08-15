export const DOCUMENT_WAIT_MESSAGE = "This document is quite large, I'm reading through it carefully... Please give me a moment to review the key points before answering~";

export interface RetrievedDocumentChunk {
  text: string;
  score: number;
  fileName?: string;
  chunkIndex?: number;
  importId?: string;
}

export type ProcessedDocument =
  | { kind: "text"; name: string; text: string }
  | { kind: "indexed"; name: string; chunks: number; importId?: string; reason?: string; retrievedChunks?: RetrievedDocumentChunk[] }
  | { kind: "empty"; name: string; reason?: string }
  | { kind: "unsupported" | "error"; name: string; reason?: string }
  | { kind: "image" | "document"; name: string };

export async function processDocumentsWithWait<T>(params: {
  processDocuments: (filePaths: string[], query: string) => Promise<T[]>;
  filePaths: string[];
  query: string;
  onWaitStart: (message: string) => void;
  onWaitEnd: () => void;
  waitMs?: number;
}): Promise<T[]> {
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    params.onWaitStart(DOCUMENT_WAIT_MESSAGE);
  }, params.waitMs ?? 3500);

  try {
    return await params.processDocuments(params.filePaths, params.query);
  } finally {
    clearTimeout(timer);
    if (shown) params.onWaitEnd();
  }
}

function formatRetrievedChunks(chunks: RetrievedDocumentChunk[]): string {
  return chunks.map((chunk) => {
    const label = chunk.fileName
      ? `${chunk.fileName}${typeof chunk.chunkIndex === "number" ? ` #${chunk.chunkIndex + 1}` : ""}`
      : "Document snippet";
    return `- ${label}: ${chunk.text}`;
  }).join("\n");
}

export function buildDocumentContextLines(results: ProcessedDocument[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    if (result.kind === "indexed" && !result.reason) {
      lines.push(`Document ${result.name} has been indexed (${result.chunks} chunks).`);
      if (result.retrievedChunks?.length) {
        lines.push(`The following document snippets are relevant to this turn's question:\n${formatRetrievedChunks(result.retrievedChunks)}`);
      }
      continue;
    }

    if (result.kind === "unsupported" || result.kind === "empty" || result.kind === "error" || result.kind === "indexed") {
      const reason = result.reason || (result.kind === "empty" ? "Document is empty" : "Unsupported or unreadable");
      lines.push(`The user attached document ${result.name}, but document processing failed: ${reason}. Please honestly explain that you cannot analyze this document right now, and do not fabricate document content.`);
    }
  }
  return lines;
}
