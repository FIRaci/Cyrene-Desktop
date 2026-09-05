import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_WAIT_MESSAGE,
  buildDocumentContextLines,
  processDocumentsWithWait,
} from "./document-processing";

describe("document send flow", () => {
  it("shows a deterministic assistant wait message when document processing exceeds 3500ms", async () => {
    vi.useFakeTimers();
    const processDocuments = vi.fn(() => new Promise<never>(() => undefined));
    const onWaitStart = vi.fn();

    void processDocumentsWithWait({
      processDocuments,
      filePaths: ["C:\\tmp\\large.md"],
      query: "Please summarize this document",
      onWaitStart,
      onWaitEnd: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(3500);

    expect(onWaitStart).toHaveBeenCalledWith(DOCUMENT_WAIT_MESSAGE);
    vi.useRealTimers();
  });

  it("removes the deterministic wait message before continuing", async () => {
    vi.useFakeTimers();
    let resolve!: (value: []) => void;
    const processing = new Promise<[]>((done) => { resolve = done; });
    const onWaitEnd = vi.fn();
    const result = processDocumentsWithWait({
      processDocuments: vi.fn(() => processing),
      filePaths: ["C:\\tmp\\large.md"],
      query: "Please summarize this document",
      onWaitStart: vi.fn(),
      onWaitEnd,
    });
    await vi.advanceTimersByTimeAsync(3500);
    resolve([]);

    await expect(result).resolves.toEqual([]);
    expect(onWaitEnd).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("combines indexed document and image context without overwriting either one", () => {
    const documentLines = buildDocumentContextLines([
      {
        kind: "indexed",
        name: "large.md",
        chunks: 12,
        importId: "import-current",
        retrievedChunks: [{ text: "deadline is Friday", score: 0.9, fileName: "large.md", chunkIndex: 0 }],
      },
    ]);
    const context = [...documentLines, "- flow.png: The image contains a flowchart."].join("\n\n");

    expect(context).toContain("Document large.md has been indexed (12 chunks).");
    expect(context).toContain("deadline is Friday");
    expect(context).toContain("The image contains a flowchart.");
  });
});
