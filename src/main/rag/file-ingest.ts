import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { ImportedDocumentChunk, ImportedDocumentResult } from "./index";

// ── Public types ──
export type AttachmentKind = "text" | "indexed" | "empty" | "unsupported" | "image" | "document";

export type Attachment =
  | { kind: "text"; name: string; text: string; filePath?: string; mime?: string }
  | { kind: "indexed"; name: string; chunks: number; importId?: string; cached?: boolean; filePath?: string; mime?: string; reason?: string; retrievedChunks?: ImportedDocumentChunk[] }
  | { kind: "empty"; name: string; filePath?: string; mime?: string }
  | { kind: "unsupported"; name: string; reason: string; filePath?: string; mime?: string; status?: "error" }
  | { kind: "image"; name: string; filePath: string; mime?: string; status: "pending"; previewUrl?: string; caption?: string }
  | { kind: "document"; name: string; filePath: string; mime?: string; status: "pending" | "done" | "error" };

/** Callback signature for large file indexing in ingestOneFile. Injected by caller (importDocument). */
export type DocumentImportProgress = {
  status: "chunking" | "embedding" | "cached";
  completedChunks?: number;
  totalChunks?: number;
};
export type DocumentImportControl = {
  isCancelled?: () => boolean;
  onProgress?: (progress: DocumentImportProgress) => void;
};
export type ImportFn = (text: string, fileName: string, control?: DocumentImportControl) => Promise<ImportedDocumentResult>;
export type SearchImportedChunksFn = (query: string, importIds: string[], topK?: number) => Promise<ImportedDocumentChunk[]>;
export type DocumentImportOptions = {
  importDocument: ImportFn;
  getCachedImport?: (text: string) => Promise<Pick<ImportedDocumentResult, "importId" | "chunkCount"> | null>;
  putCachedImport?: (text: string, fileName: string, imported: ImportedDocumentResult) => Promise<void>;
  isCancelled?: () => boolean;
  onProgress?: (progress: DocumentImportProgress) => void;
};
export type DocumentImport = ImportFn | DocumentImportOptions;

// ── Thresholds ──
/** Threshold between small files and large files (-> RAG) in characters. */
export const SMALL_THRESHOLD = 30_000;

// ── Extension Routing ──
const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log",
  ".xml", ".yaml", ".yml",
  ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".c", ".cpp", ".cc", ".h", ".hpp",
  ".rs", ".go", ".rb", ".php", ".sh", ".bash",
  ".css", ".scss", ".sql",
  ".ini", ".conf", ".toml", ".env",
  ".svg", ".html", ".htm",
]);

export const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
]);

const UNSUPPORTED_EXTS = new Set([
  ".zip", ".7z", ".rar", ".tar", ".gz",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".class", ".jar", ".pyc",
  ".o", ".a", ".wasm",
]);

export function isTextExt(ext: string): boolean {
  return TEXT_EXTS.has(ext.toLowerCase());
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

export function getMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

export function isUnsupportedExt(ext: string): boolean {
  return UNSUPPORTED_EXTS.has(ext.toLowerCase());
}

export function isDocumentExt(ext: string): boolean {
  const normalized = ext.toLowerCase();
  return normalized === "" || isTextExt(normalized);
}

export const MAX_INGEST_FILE_SIZE = 50 * 1024 * 1024; // 50MB limit

export function describePendingAttachment(filePath: string): Attachment {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_INGEST_FILE_SIZE) {
      return {
        name,
        kind: "unsupported",
        filePath,
        status: "error",
        reason: `File size exceeds 50MB limit (${(stat.size / (1024 * 1024)).toFixed(1)}MB)`,
      };
    }
  } catch {
    // Stat failure will be handled during processing
  }

  if (isImageExt(ext)) {
    return {
      name,
      kind: "image",
      filePath,
      mime: getMimeFromExt(ext),
      previewUrl: pathToFileURL(filePath).toString(),
      status: "pending",
    };
  }
  if (isDocumentExt(ext)) {
    return {
      name,
      kind: "document",
      filePath,
      status: "pending",
    };
  }
  return {
    name,
    kind: "unsupported",
    filePath,
    status: "error",
    reason: `Unsupported file format ${ext || "(no extension)"}`,
  };
}

/**
 * Binary check: look for null bytes in the first 8KB.
 */
const BINARY_SCAN_BYTES = 8192;

export function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SCAN_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function indexLargeText(
  text: string,
  name: string,
  documentImport: DocumentImport,
): Promise<Attachment> {
  const options: DocumentImportOptions = typeof documentImport === "function"
    ? { importDocument: documentImport }
    : documentImport;

  if (options.isCancelled?.()) {
    return { name, kind: "indexed", chunks: 0, reason: "cancelled" };
  }

  if (options.getCachedImport) {
    try {
      const cached = await options.getCachedImport(text);
      if (cached) {
        options.onProgress?.({ status: "cached", completedChunks: cached.chunkCount, totalChunks: cached.chunkCount });
        return { name, kind: "indexed", chunks: cached.chunkCount, importId: cached.importId, cached: true };
      }
    } catch (err) {
      console.warn("[RAG] document cache lookup failed:", err);
    }
  }

  try {
    const control: DocumentImportControl = {
      isCancelled: options.isCancelled,
      onProgress: options.onProgress,
    };
    const imported = control.isCancelled || control.onProgress
      ? await options.importDocument(text, name, control)
      : await options.importDocument(text, name);
    if (options.isCancelled?.()) {
      return { name, kind: "indexed", chunks: 0, reason: "cancelled" };
    }
    if (options.putCachedImport) {
      try {
        await options.putCachedImport(text, name, imported);
      } catch (err) {
        console.warn("[RAG] document cache write failed:", err);
      }
    }
    return { name, kind: "indexed", chunks: imported.chunkCount, importId: imported.importId };
  } catch (err: any) {
    return { name, kind: "indexed", chunks: 0, reason: err?.message || String(err) };
  }
}

// ── Core Routing: Process Single File ──

/**
 * Ingest a single file.
 * @param filePath Absolute path
 * @param importFn Ingestion callback for large files (typically importDocument)
 */
export async function ingestOneFile(
  filePath: string,
  documentImport: DocumentImport,
): Promise<Attachment> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (err: any) {
    return { name: path.basename(filePath), kind: "unsupported", reason: err?.code || String(err) };
  }
  if (!stat.isFile()) {
    return { name: path.basename(filePath), kind: "unsupported", reason: "Target is not a regular file" };
  }
  if (stat.size > MAX_INGEST_FILE_SIZE) {
    return {
      name: path.basename(filePath),
      kind: "unsupported",
      reason: `File size exceeds 50MB limit (${(stat.size / (1024 * 1024)).toFixed(1)}MB)`,
    };
  }

  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Explicitly unsupported formats
  if (isUnsupportedExt(ext)) {
    return { name, kind: "unsupported", reason: `Unsupported file format ${ext} (only text is supported)` };
  }

  // Read file
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err: any) {
    return { name, kind: "unsupported", reason: err?.code || String(err) };
  }

  // Type detection and content extraction
  // Text extension
  if (isTextExt(ext)) {
    // Binary fallback: text extension but contains null bytes
    if (isBinary(buf)) {
      return { name, kind: "unsupported", reason: `File ${ext} contains binary data, not supported for text ingestion` };
    }
    const text = buf.toString("utf-8");
    if (!text.trim()) {
      return { name, kind: "empty" };
    }
    if (text.length > SMALL_THRESHOLD) {
      // Large text -> Index into Vector DB
      return indexLargeText(text, name, documentImport);
    }
    return { name, kind: "text", text };
  }

  // Unknown extension: detect via null bytes
  if (isBinary(buf)) {
    return { name, kind: "unsupported", reason: "Binary file, not currently supported" };
  }
  // Text file without extension
  const text = buf.toString("utf-8");
  if (!text.trim()) {
    return { name, kind: "empty" };
  }
  if (text.length > SMALL_THRESHOLD) {
    return indexLargeText(text, name, documentImport);
  }
  return { name, kind: "text", text };
}

// ── Directory Traversal ──

/**
 * Recursively traverse directory, returning absolute paths of all non-hidden files.
 */
export function walkDir(dirPath: string): string[] {
  const result: string[] = [];
  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      // Skip hidden files/directories (starting with .)
      if (item.startsWith(".")) continue;
      const fullPath = path.join(dirPath, item);
      try {
        const s = fs.statSync(fullPath);
        if (s.isDirectory()) {
          result.push(...walkDir(fullPath));
        } else if (s.isFile()) {
          result.push(fullPath);
        }
      } catch {
        // No permission / deleted -> skip
      }
    }
  } catch {
    // No permission to list directory -> skip
  }
  return result;
}

// ── Batch Ingest ──

/**
 * Batch ingest multiple paths (files or directories).
 * Directories expanded via walkDir; deduplicated via realpath.
 */
export async function ingestPaths(
  paths: string[],
  documentImport: DocumentImport,
): Promise<Attachment[]> {
  // Expand directory and track relative display names
  const filesWithPaths: Array<{ absPath: string; displayName: string }> = [];
  for (const p of paths) {
    try {
      const s = fs.statSync(p);
      if (s.isDirectory()) {
        const children = walkDir(p);
        for (const child of children) {
          filesWithPaths.push({ absPath: child, displayName: path.relative(p, child) });
        }
      } else if (s.isFile()) {
        filesWithPaths.push({ absPath: p, displayName: path.basename(p) });
      }
    } catch {
      // Does not exist -> skip
    }
  }

  // Deduplicate via realpath
  const seen = new Set<string>();
  const unique: Array<{ absPath: string; displayName: string }> = [];
  for (const entry of filesWithPaths) {
    try {
      const real = fs.realpathSync(entry.absPath);
      if (!seen.has(real)) {
        seen.add(real);
        unique.push({ ...entry, absPath: real });
      }
    } catch {
      // Broken symlink -> skip
    }
  }

  const results: Attachment[] = [];
  for (const { absPath, displayName } of unique) {
    const att = await ingestOneFile(absPath, documentImport);
    // Override basename with display name preserving relative path
    results.push({ ...att, name: displayName, filePath: absPath });
  }
  return results;
}

export async function processDocumentsForChat(
  filePaths: string[],
  query: string,
  documentImport: DocumentImport,
  searchImportedChunks: SearchImportedChunksFn,
): Promise<Attachment[]> {
  const results: Attachment[] = [];
  for (const filePath of filePaths) {
    try {
      const processed = await ingestPaths([filePath], documentImport);
      if (processed.length === 0) {
        results.push({
          name: path.basename(filePath),
          kind: "unsupported",
          filePath,
          status: "error",
          reason: "File does not exist or cannot be read",
        });
        continue;
      }

      for (const attachment of processed) {
        if (attachment.kind === "indexed" && attachment.importId && query.trim()) {
          try {
            attachment.retrievedChunks = await searchImportedChunks(query, [attachment.importId]);
          } catch (err: any) {
            attachment.reason = err?.message || String(err);
          }
        }
        results.push(attachment);
      }
    } catch (err: any) {
      results.push({
        name: path.basename(filePath),
        kind: "unsupported",
        filePath,
        status: "error",
        reason: err?.message || String(err),
      });
    }
  }
  return results;
}
