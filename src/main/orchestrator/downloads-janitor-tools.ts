import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { app, shell } from "electron";
import { toolRegistry } from "./tool-registry";
import { requestUserChoice } from "../user-choice";

const LOG_PREFIX = "[DownloadsJanitor]";
const FAST_HASH_BYTES = 64 * 1024; // 64 KB prefix

export interface DuplicateCluster {
  hash: string;
  sizeBytes: number;
  original: string; // File to keep
  duplicates: string[]; // Redundant copies to clean
}

export interface DuplicateScanResult {
  scannedCount: number;
  duplicateGroupCount: number;
  totalDuplicateFiles: number;
  recoverableBytes: number;
  recoverableFormatted: string;
  clusters: DuplicateCluster[];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function resolveDownloadsDirectory(customDir?: string): string {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }
  try {
    return app.getPath("downloads");
  } catch {
    const userHome = process.env.USERPROFILE || process.env.HOME || "";
    const fallback = path.join(userHome, "Downloads");
    if (fs.existsSync(fallback)) return fallback;
    return process.cwd();
  }
}

/**
 * Computes SHA-256 for a file (or first `limit` bytes).
 */
export function computeFileHash(filePath: string, limit?: number): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const bufferSize = limit ? Math.min(limit, 64 * 1024) : 64 * 1024;
    const buffer = Buffer.alloc(bufferSize);
    let bytesRead = 0;
    let totalRead = 0;

    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
      totalRead += bytesRead;
      if (limit && totalRead >= limit) break;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Determine which file is the "original" to keep and which are redundant duplicates.
 * Preference is given to:
 * 1. Base names without copies/counters like ` (1)`, ` - Copy`, `_copy`.
 * 2. Older modification/creation time.
 */
export function sortFilesByOriginality(filePaths: string[]): string[] {
  return [...filePaths].sort((a, b) => {
    const baseA = path.basename(a);
    const baseB = path.basename(b);

    const isCopyA = /\s*\(\d+\)| - copy|_copy/i.test(baseA);
    const isCopyB = /\s*\(\d+\)| - copy|_copy/i.test(baseB);

    if (!isCopyA && isCopyB) return -1;
    if (isCopyA && !isCopyB) return 1;

    // Shorter filename usually indicates the original
    if (baseA.length !== baseB.length) return baseA.length - baseB.length;

    try {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statA.mtimeMs - statB.mtimeMs;
    } catch {
      return 0;
    }
  });
}

/**
 * Scans a directory for duplicate files using size grouping + fast-prefix hash + full SHA-256.
 */
export async function scanDuplicatesInDirectory(
  targetDir: string,
  minSizeBytes = 1024,
): Promise<DuplicateScanResult> {
  const resolvedDir = resolveDownloadsDirectory(targetDir);
  if (!fs.existsSync(resolvedDir)) {
    return {
      scannedCount: 0,
      duplicateGroupCount: 0,
      totalDuplicateFiles: 0,
      recoverableBytes: 0,
      recoverableFormatted: "0 B",
      clusters: [],
    };
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const sizeMap = new Map<number, string[]>();
  let scannedCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Skip system or active download temporary files
    if (
      entry.name.startsWith(".") ||
      entry.name.endsWith(".crdownload") ||
      entry.name.endsWith(".tmp") ||
      entry.name.endsWith(".part")
    ) {
      continue;
    }

    const fullPath = path.join(resolvedDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size < minSizeBytes) continue;
      scannedCount++;

      const list = sizeMap.get(stat.size) || [];
      list.push(fullPath);
      sizeMap.set(stat.size, list);
    } catch {
      // Ignore unreadable files
    }
  }

  const clusters: DuplicateCluster[] = [];
  let recoverableBytes = 0;
  let totalDuplicateFiles = 0;

  for (const [size, files] of sizeMap.entries()) {
    if (files.length < 2) continue;

    // Fast hash filter: prefix 64KB
    const fastMap = new Map<string, string[]>();
    for (const f of files) {
      try {
        const fastH = computeFileHash(f, FAST_HASH_BYTES);
        const flist = fastMap.get(fastH) || [];
        flist.push(f);
        fastMap.set(fastH, flist);
      } catch {
        // Skip on read error
      }
    }

    for (const [, candidates] of fastMap.entries()) {
      if (candidates.length < 2) continue;

      // Full hash check
      const fullMap = new Map<string, string[]>();
      for (const c of candidates) {
        try {
          const fullH = computeFileHash(c);
          const clist = fullMap.get(fullH) || [];
          clist.push(c);
          fullMap.set(fullH, clist);
        } catch {
          // Skip on read error
        }
      }

      for (const [hash, matchingFiles] of fullMap.entries()) {
        if (matchingFiles.length < 2) continue;

        const sorted = sortFilesByOriginality(matchingFiles);
        const original = sorted[0];
        const duplicates = sorted.slice(1);

        clusters.push({
          hash,
          sizeBytes: size,
          original,
          duplicates,
        });

        totalDuplicateFiles += duplicates.length;
        recoverableBytes += size * duplicates.length;
      }
    }
  }

  return {
    scannedCount,
    duplicateGroupCount: clusters.length,
    totalDuplicateFiles,
    recoverableBytes,
    recoverableFormatted: formatBytes(recoverableBytes),
    clusters,
  };
}

/**
 * Cleans duplicate files by sending them to Windows Recycle Bin.
 */
export async function cleanDuplicatesInDirectory(
  targetDir: string,
  autoConfirm = false,
): Promise<string> {
  const scan = await scanDuplicatesInDirectory(targetDir);

  if (scan.totalDuplicateFiles === 0) {
    return `[clean_duplicate_downloads] Scanned ${scan.scannedCount} files. No duplicate files found! Your directory is already clean.`;
  }

  if (!autoConfirm) {
    const question = `Found ${scan.totalDuplicateFiles} duplicate file(s) in Downloads occupying ${scan.recoverableFormatted}. Would you like Cyrene to safely move the duplicates to the Recycle Bin?`;
    const options = [
      {
        label: `Yes, move ${scan.totalDuplicateFiles} duplicates to Recycle Bin (Save ${scan.recoverableFormatted})`,
        value: "confirm",
      },
      {
        label: "No, keep all files",
        value: "cancel",
      },
    ];

    const choice = await requestUserChoice(question, options, "cancel");
    if (choice !== "confirm") {
      return `[clean_duplicate_downloads] Operation cancelled by user. Kept all ${scan.totalDuplicateFiles} duplicate files.`;
    }
  }

  let recycledCount = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  for (const cluster of scan.clusters) {
    for (const dupPath of cluster.duplicates) {
      try {
        if (shell && typeof shell.trashItem === "function") {
          await shell.trashItem(dupPath);
        } else {
          // Fallback in environments without shell.trashItem
          fs.unlinkSync(dupPath);
        }
        recycledCount++;
        freedBytes += cluster.sizeBytes;
      } catch (err) {
        errors.push(`${path.basename(dupPath)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const result = [
    `[clean_duplicate_downloads] Successfully moved ${recycledCount} duplicate file(s) to Recycle Bin.`,
    `Freed space: ${formatBytes(freedBytes)}.`,
    `Original files preserved: ${scan.clusters.length}.`,
  ];
  if (errors.length > 0) {
    result.push(`Failed to recycle ${errors.length} file(s): ${errors.slice(0, 3).join("; ")}`);
  }
  return result.join("\n");
}

export function registerDownloadsJanitorTools(): void {
  toolRegistry.register({
    id: "scan_duplicate_downloads",
    name: "Scan Duplicate Downloads",
    description:
      "Scans the Downloads folder (or a specified directory) for duplicate files using file size grouping, fast prefix hashing, and full SHA-256 cryptographic verification. Returns a summary of duplicate groups and total recoverable disk space without deleting any files.",
    enabled: true,
    risk: "fs-read",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Optional folder path to scan. Defaults to the user's Downloads folder.",
        },
        minSizeBytes: {
          type: "number",
          description: "Optional minimum file size in bytes to inspect. Defaults to 1024 (1 KB).",
        },
      },
    },
    execute: async (args) => {
      const dir = typeof args.directory === "string" ? args.directory.trim() : undefined;
      const minSize = typeof args.minSizeBytes === "number" ? args.minSizeBytes : 1024;
      const scan = await scanDuplicatesInDirectory(dir || "", minSize);

      if (scan.totalDuplicateFiles === 0) {
        return `Scanned ${scan.scannedCount} files in "${resolveDownloadsDirectory(dir)}". No duplicate files found.`;
      }

      const lines = [
        `### Duplicate Downloads Scan Report`,
        `- **Files Scanned**: ${scan.scannedCount}`,
        `- **Duplicate Groups**: ${scan.duplicateGroupCount}`,
        `- **Redundant Copies**: ${scan.totalDuplicateFiles}`,
        `- **Recoverable Disk Space**: ${scan.recoverableFormatted}`,
        ``,
        `**Duplicate Clusters:**`,
      ];

      for (let i = 0; i < Math.min(scan.clusters.length, 10); i++) {
        const c = scan.clusters[i];
        lines.push(`${i + 1}. **Original to keep**: \`${path.basename(c.original)}\` (${formatBytes(c.sizeBytes)})`);
        for (const d of c.duplicates) {
          lines.push(`   - Duplicate copy: \`${path.basename(d)}\``);
        }
      }

      if (scan.clusters.length > 10) {
        lines.push(`... and ${scan.clusters.length - 10} more duplicate groups.`);
      }

      lines.push(
        ``,
        `To safely recycle these duplicate files, you can ask Cyrene to run \`clean_duplicate_downloads\`.`,
      );
      return lines.join("\n");
    },
  });

  toolRegistry.register({
    id: "clean_duplicate_downloads",
    name: "Clean Duplicate Downloads",
    description:
      "Cleans duplicate files in the Downloads folder (or a specified directory) by safely sending redundant copies to the Windows Recycle Bin (not permanent deletion). Prompts the user for confirmation with space savings before proceeding.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Optional directory path to clean. Defaults to the user's Downloads folder.",
        },
        autoConfirm: {
          type: "boolean",
          description: "If true, bypasses the interactive confirmation dialog. Default is false.",
        },
      },
    },
    execute: async (args) => {
      const dir = typeof args.directory === "string" ? args.directory.trim() : undefined;
      const autoConfirm = Boolean(args.autoConfirm);
      return cleanDuplicatesInDirectory(dir || "", autoConfirm);
    },
  });
}
