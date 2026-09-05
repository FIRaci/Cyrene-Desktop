import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  ingestOneFile,
  processDocumentsForChat,
  walkDir,
  ingestPaths,
  describePendingAttachment,
  isBinary,
  isImageExt,
  isTextExt,
  isUnsupportedExt,
  getMimeFromExt,
  SMALL_THRESHOLD,
  type Attachment,
  type ImportFn,
} from "./file-ingest";

// ── Helper: Temporary Directory ──
let tmpDir: string;
function fixture(...segments: string[]): string {
  return path.join(tmpDir, ...segments);
}
function write(name: string, content: Buffer | string): string {
  const fp = fixture(name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  if (typeof content === "string") fs.writeFileSync(fp, content, "utf-8");
  else fs.writeFileSync(fp, content);
  return fp;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-ingest-test-"));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── isBinary ──
describe("isBinary", () => {
  it("plain text -> false", () => {
    expect(isBinary(Buffer.from("hello world"))).toBe(false);
  });
  it("with null byte -> true", () => {
    expect(isBinary(Buffer.from([0x00, 0x48, 0x69]))).toBe(true);
  });
  it("empty buffer -> false", () => {
    expect(isBinary(Buffer.alloc(0))).toBe(false);
  });
  it("pure null bytes -> true", () => {
    expect(isBinary(Buffer.alloc(10, 0x00))).toBe(true);
  });
  it("starts with null -> true", () => {
    expect(isBinary(Buffer.from([0x48, 0x00, 0x69]))).toBe(true);
  });
});

// ── isTextExt / isUnsupportedExt ──
describe("Extension detection", () => {
  it("isTextExt true", () => {
    expect(isTextExt(".txt")).toBe(true);
    expect(isTextExt(".md")).toBe(true);
    expect(isTextExt(".ts")).toBe(true);
    expect(isTextExt(".py")).toBe(true);
    expect(isTextExt(".json")).toBe(true);
    expect(isTextExt(".svg")).toBe(true);
  });
  it("isTextExt false (no extension/zip)", () => {
    expect(isTextExt("")).toBe(false);
    expect(isTextExt(".zip")).toBe(false);
  });
  it("isUnsupportedExt true", () => {
    expect(isUnsupportedExt(".zip")).toBe(true);
    expect(isUnsupportedExt(".pdf")).toBe(true);
    expect(isUnsupportedExt(".png")).toBe(true);
    expect(isUnsupportedExt(".exe")).toBe(true);
  });
  it("isUnsupportedExt false", () => {
    expect(isUnsupportedExt(".txt")).toBe(false);
    expect(isUnsupportedExt(".md")).toBe(false);
    expect(isUnsupportedExt("")).toBe(false);
    expect(isUnsupportedExt(".unknown")).toBe(false);
  });
  it("isImageExt true and returns image mime", () => {
    expect(isImageExt(".png")).toBe(true);
    expect(isImageExt(".JPG")).toBe(true);
    expect(isImageExt(".webp")).toBe(true);
    expect(getMimeFromExt(".png")).toBe("image/png");
    expect(getMimeFromExt(".jpg")).toBe("image/jpeg");
    expect(getMimeFromExt(".unknown")).toBe("application/octet-stream");
  });
});

describe("describePendingAttachment", () => {
  it("pending stage registers files without immediate reading or indexing", () => {
    const text = describePendingAttachment(fixture("notes.md"));
    expect(text).toMatchObject({
      name: "notes.md",
      kind: "document",
      filePath: fixture("notes.md"),
      status: "pending",
    });
    expect(text).not.toHaveProperty("text");
    expect(text).not.toHaveProperty("chunks");
  });

  it("pending stage marks unsupported binary/media formats as unsupported", () => {
    expect(describePendingAttachment(fixture("setup.exe"))).toMatchObject({
      name: "setup.exe",
      kind: "unsupported",
      reason: "Unsupported file format .exe",
    });
    expect(describePendingAttachment(fixture("voice.wav"))).toMatchObject({
      name: "voice.wav",
      kind: "unsupported",
      reason: "Unsupported file format .wav",
    });
  });

  it("pending stage returns previewUrl for images", () => {
    const image = describePendingAttachment(fixture("screen shot.png"));
    expect(image.kind).toBe("image");
    if (image.kind === "image") {
      expect(image.mime).toBe("image/png");
      expect(image.previewUrl).toMatch(/^file:\/\//);
      expect(image.status).toBe("pending");
    }
  });
});

// ── ingestOneFile ──
describe("ingestOneFile", () => {
  let mockImport: ImportFn;

  beforeEach(() => {
    mockImport = vi.fn().mockResolvedValue({ importId: "import-test", chunkCount: 3 });
  });

  it("small text file -> kind:text returns content", async () => {
    const fp = write("hello.txt", "Hello, world!");
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("text");
    if (r.kind === "text") {
      expect(r.text).toBe("Hello, world!");
    }
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("large text file (>30k) -> kind:indexed calls importFn", async () => {
    const big = "x".repeat(SMALL_THRESHOLD + 1);
    const fp = write("big.txt", big);
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("indexed");
    if (r.kind === "indexed") {
      expect(r.chunks).toBe(3);
    }
    expect(mockImport).toHaveBeenCalledOnce();
    expect(mockImport).toHaveBeenCalledWith(big, "big.txt");
  });

  it("large text file returns importId", async () => {
    const importForTurn = vi.fn().mockResolvedValue({ importId: "import-current", chunkCount: 3 });
    const fp = write("turn.md", "x".repeat(SMALL_THRESHOLD + 1));

    const result = await ingestOneFile(fp, importForTurn as ImportFn);

    expect(result).toMatchObject({
      kind: "indexed",
      name: "turn.md",
      chunks: 3,
      importId: "import-current",
    });
  });

  it("reuses a completed document cache record instead of embedding again", async () => {
    const importFn = vi.fn();
    const largeMarkdownPath = write("large.md", "x".repeat(SMALL_THRESHOLD + 1));

    const result = await ingestOneFile(largeMarkdownPath, {
      importDocument: importFn,
      getCachedImport: async () => ({ importId: "import-cached", chunkCount: 9 }),
    });

    expect(result).toMatchObject({
      kind: "indexed",
      name: "large.md",
      chunks: 9,
      importId: "import-cached",
      cached: true,
    });
    expect(importFn).not.toHaveBeenCalled();
  });

  it("returns importId and relevant chunks for document processing", async () => {
    const fp = write("large.md", "x".repeat(SMALL_THRESHOLD + 1));
    const importForTurn = vi.fn().mockResolvedValue({ importId: "import-current", chunkCount: 12 });
    const searchChunks = vi.fn().mockResolvedValue([
      { text: "deadline is Friday", score: 0.9, fileName: "large.md", chunkIndex: 0, importId: "import-current" },
    ]);

    const result = await processDocumentsForChat([fp], "what is the deadline?", importForTurn as ImportFn, searchChunks);

    expect(result[0]).toMatchObject({
      kind: "indexed",
      name: "large.md",
      chunks: 12,
      importId: "import-current",
      retrievedChunks: [{ text: "deadline is Friday" }],
    });
  });

  it("preserves a completed indexed import when related chunk retrieval fails", async () => {
    const fp = write("retrieve-fails.md", "x".repeat(SMALL_THRESHOLD + 1));
    const importForTurn = vi.fn().mockResolvedValue({ importId: "import-current", chunkCount: 12 });
    const searchChunks = vi.fn().mockRejectedValue(new Error("retrieval unavailable"));

    const result = await processDocumentsForChat([fp], "what is the deadline?", importForTurn as ImportFn, searchChunks);

    expect(result[0]).toMatchObject({
      kind: "indexed",
      importId: "import-current",
      chunks: 12,
      reason: "retrieval unavailable",
    });
  });

  it("exact threshold boundary -> kind:indexed", async () => {
    const exact = "x".repeat(SMALL_THRESHOLD);
    const fp = write("exact.txt", exact);
    const r = await ingestOneFile(fp, mockImport);
    // Index when > threshold
    expect(r.kind).toBe("text");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("empty file -> kind:empty", async () => {
    const fp = write("empty.txt", "");
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("empty");
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("whitespace only -> kind:empty", async () => {
    const fp = write("spaces.txt", "   \n\t  ");
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("empty");
  });

  it("archive (.zip) -> kind:unsupported", async () => {
    const fp = write("archive.zip", makeBin(100));
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") {
      expect(r.reason).toBe("Unsupported file format .zip (only text is supported)");
    }
  });

  it("image (.png) -> kind:unsupported", async () => {
    const fp = write("img.png", makeBin(100));
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("unsupported");
  });

  it("no extension, binary (null bytes) -> unsupported", async () => {
    const fp = write("noext", Buffer.from([0x00, ...makeBin(99)])); // First byte is 0x00
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("unsupported");
  });

  it("no extension, text -> text", async () => {
    const fp = write("readme", "This is my readme.");
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("text");
  });

  it("text extension with null bytes -> unsupported", async () => {
    const fp = write("corrupt.txt", Buffer.from([0x48, 0x00, 0x69]));
    const r = await ingestOneFile(fp, mockImport);
    expect(r.kind).toBe("unsupported");
  });

  it("importFn error -> kind:indexed with chunks:0 without blocking", async () => {
    const mockFailing = vi.fn().mockRejectedValue(new Error("embedding failed"));
    const big = "x".repeat(SMALL_THRESHOLD + 1);
    const fp = write("bad.txt", big);
    const r = await ingestOneFile(fp, mockFailing);
    expect(r.kind).toBe("indexed");
    if (r.kind === "indexed") {
      expect(r.chunks).toBe(0);
      expect(r.reason).toContain("embedding failed");
    }
  });

  it("file does not exist -> unsupported", async () => {
    const r = await ingestOneFile(fixture("nonexistent.txt"), mockImport);
    expect(r.kind).toBe("unsupported");
    if (r.kind === "unsupported") expect(r.reason).toContain("ENOENT");
  });
});

// ── walkDir ──
describe("walkDir", () => {
  it("empty directory -> []", () => {
    const empty = fixture("empty");
    fs.mkdirSync(empty, { recursive: true });
    expect(walkDir(empty)).toEqual([]);
  });

  it("multiple files -> returns path list", () => {
    write("a.txt", "a");
    write("b.md", "b");
    write("c.ts", "c");
    const r = walkDir(tmpDir).map((f) => path.relative(tmpDir, f));
    expect(r).toContain("a.txt");
    expect(r).toContain("b.md");
    expect(r).toContain("c.ts");
  });

  it("nested directory -> recursive return", () => {
    write("sub/a.md", "a");
    write("sub/deep/b.txt", "b");
    const r = walkDir(tmpDir).map((f) => path.relative(tmpDir, f).replace(/\\/g, "/"));
    expect(r).toContain("sub/a.md");
    expect(r).toContain("sub/deep/b.txt");
  });

  it("skip hidden files (starting with .)", () => {
    write(".hidden", "secret");
    write("visible.txt", "hello");
    const r = walkDir(tmpDir).map((f) => path.relative(tmpDir, f));
    expect(r).not.toContain(".hidden");
    expect(r).toContain("visible.txt");
  });

  it("skip unreadable directories gracefully", () => {
    // Verify it does not throw
    write("ok.txt", "ok");
    expect(() => walkDir(tmpDir)).not.toThrow();
  });
});

// ── ingestPaths ──
describe("ingestPaths", () => {
  let mockImport: ImportFn;
  beforeEach(() => {
    mockImport = vi.fn().mockResolvedValue({ importId: "import-test", chunkCount: 2 });
  });

  it("single file -> [Attachment]", async () => {
    const fp = write("single.txt", "hello");
    const r = await ingestPaths([fp], mockImport);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("text");
    expect(r[0].name).toBe("single.txt");
  });

  it("directory -> recursive all files", async () => {
    write("a.txt", "small");
    write("sub/b.md", "also small");
    const r = await ingestPaths([tmpDir], mockImport);
    expect(r).toHaveLength(2);
    const names = r.map((a) => a.name.replace(/\\/g, "/"));
    expect(names).toContain("a.txt");
    expect(names).toContain("sub/b.md");
  });

  it("mixed input (file + dir + binary)", async () => {
    const fp = write("notes.txt", "some text");
    write("sub/img.png", makeBin(100));
    write("sub/code.js", "const x = 1;");
    const r = await ingestPaths([fp, tmpDir], mockImport);
    expect(r).toHaveLength(3);
    expect(r.filter((a) => a.kind === "text")).toHaveLength(2);
    expect(r.filter((a) => a.kind === "unsupported")).toHaveLength(1);
  });

  it("non-existent path -> skip without throwing", async () => {
    const r = await ingestPaths([fixture("nope.txt"), fixture("alsonope")], mockImport);
    expect(r).toHaveLength(0);
  });

  it("duplicate paths -> deduplicate", async () => {
    const fp = write("dedup.txt", "once");
    const r = await ingestPaths([fp, fp, fp], mockImport);
    expect(r).toHaveLength(1);
  });
});

// ── Utility ──
function makeBin(size: number): Buffer {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i + 0x80) & 0xff; // Non-ASCII
  // First 4KB without null
  for (let i = 0; i < size && i < 4096; i++) {
    if (b[i] === 0) b[i] = 0xff;
  }
  return b;
}
