// 文件系统工具组 — 给 agent 装上"读文件 / 列目录 / 写文件 / 读图片"四件武器
// 不绕 run_shell，直接用 fs API。每个工具都有 risk 字段交给权限网关判定。

import * as fs from "fs";
import * as path from "path";
import { toolRegistry } from "./tool-registry";
import { captionImage } from "./vision-captioner";
import type { ToolContext } from "./tool-context";

const LOG_PREFIX = "[FsTools]";

const READ_MAX_BYTES = 256 * 1024;       // 单文件最多读 256KB
const LIST_MAX_ENTRIES = 200;            // 单次目录列举最多 200 项
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 图片最多 5MB

// 图片扩展名集合，用于 list_dir 标注 [图片] 和汇总计数
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

function ensureAbsolute(p: string): string | null {
  if (!p) return null;
  if (!path.isAbsolute(p)) return null;
  return path.normalize(p);
}

function safeStat(p: string): fs.Stats | null {
  try { return fs.statSync(p); } catch { return null; }
}

function humanBytes(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + "GB";
}

// ── 工具 1：read_file ─────────────────────────────────────

async function executeReadFile(args: Record<string, unknown>): Promise<string> {
  const raw = String(args.path || "").trim();
  const filePath = ensureAbsolute(raw);
  if (!filePath) return "[Error] path must be absolute";

  const stat = safeStat(filePath);
  if (!stat) return "[Error] File does not exist or is inaccessible: " + filePath;
  if (!stat.isFile()) return "[Error] Path is not a file: " + filePath;

  const startLine = Math.max(1, Number(args.startLine) || 1);
  const maxLines = Math.max(1, Math.min(2000, Number(args.maxLines) || 500));

  console.log(LOG_PREFIX, "read_file:", filePath, "size=" + humanBytes(stat.size), "lines=" + startLine + "..+" + maxLines);

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Failed to read file: " + msg;
  }

  const truncatedSize = buf.length > READ_MAX_BYTES;
  const slice = truncatedSize ? buf.subarray(0, READ_MAX_BYTES) : buf;

  // 二进制启发：前 4KB 出现大量 \0 → 当作二进制
  const head = slice.subarray(0, Math.min(slice.length, 4096));
  let nullCount = 0;
  for (let i = 0; i < head.length; i++) if (head[i] === 0) nullCount++;
  if (nullCount > head.length * 0.05) {
    return "[Error] This appears to be a binary file. read_file supports text only; use read_image for images.\n" +
      "path: " + filePath + "\nsize: " + humanBytes(stat.size);
  }

  const text = slice.toString("utf8");
  const lines = text.split(/\r?\n/);
  const total = lines.length;
  const sliceLines = lines.slice(startLine - 1, startLine - 1 + maxLines);

  const head2 = "path: " + filePath + "\nsize: " + humanBytes(stat.size) +
    "\ntotal_lines: ~" + total + (truncatedSize ? "  [truncated at 256KB]" : "") +
    "\nshowing: line " + startLine + " ~ " + (startLine + sliceLines.length - 1) + "\n\n";

  // 带行号方便 agent 后续精确引用
  const numbered = sliceLines.map((line, i) => {
    const ln = startLine + i;
    return String(ln).padStart(5, " ") + " | " + line;
  }).join("\n");

  return head2 + numbered;
}

toolRegistry.register({
  id: "read_file",
  name: "Read file",
  description:
    "Read a local text file and return line-numbered content. Files larger than 256KB are truncated; use startLine and maxLines to page through content. " +
    "Use whenever an answer depends on the actual contents of a local file. Use read_image for images and list_dir for directories.\n\n" +
    "Parameters: path (required absolute path), startLine (optional, default 1), and maxLines (optional, default 500).",
  enabled: true,
  risk: "fs-read",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path of the text file, for example 'C:\\\\Users\\\\me\\\\notes.txt'" },
      startLine: { type: "number", description: "First line to return; defaults to 1" },
      maxLines: { type: "number", description: "Maximum lines to return; defaults to 500 and is capped at 2000" },
    },
    required: ["path"],
  },
  execute: executeReadFile,
});

// ── 工具 2：list_dir ──────────────────────────────────────

async function executeListDir(args: Record<string, unknown>): Promise<string> {
  const raw = String(args.path || "").trim();
  const dirPath = ensureAbsolute(raw);
  if (!dirPath) return "[Error] path must be absolute";

  const stat = safeStat(dirPath);
  if (!stat) return "[Error] Directory does not exist or is inaccessible: " + dirPath;
  if (!stat.isDirectory()) return "[Error] Path is not a directory: " + dirPath;

  const showHidden = args.showHidden === true;
  const filter = typeof args.filter === "string" ? args.filter.trim() : "";
  console.log(LOG_PREFIX, "list_dir:", dirPath, "showHidden=" + showHidden);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Failed to read directory: " + msg;
  }

  if (!showHidden) {
    entries = entries.filter(e => !e.name.startsWith("."));
  }

  // 文件夹在前，文件在后；同类按名字排序
  entries.sort((a, b) => {
    const da = a.isDirectory() ? 0 : 1;
    const db = b.isDirectory() ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });

  const truncated = entries.length > LIST_MAX_ENTRIES;
  const slice = truncated ? entries.slice(0, LIST_MAX_ENTRIES) : entries;

  // 汇总图片数量，让模型不用逐个数就能回答"有几张图"
  const imageCount = entries.filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())).length;

  const lines: string[] = [];
  lines.push("dir: " + dirPath);
  lines.push(
    "count: " + entries.length +
    (imageCount > 0 ? " (images: " + imageCount + ")" : "") +
    (filter ? " (filter: " + filter + ")" : "") +
    (truncated ? " (showing first " + LIST_MAX_ENTRIES + " entries)" : ""),
  );
  lines.push("");

  for (const ent of slice) {
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      lines.push("[D] " + ent.name + "/");
    } else if (ent.isFile()) {
      const st = safeStat(full);
      const size = st ? "  " + humanBytes(st.size) : "";
      // 标注文件类型，重点让图片显式可见，模型才能数清"有几张图"
      const ext = path.extname(ent.name).toLowerCase();
      const tag = IMAGE_EXTS.has(ext) ? "  [image]" : "";
      lines.push("[F] " + ent.name + size + tag);
    } else if (ent.isSymbolicLink()) {
      lines.push("[L] " + ent.name);
    } else {
      lines.push("[?] " + ent.name);
    }
  }
  return lines.join("\n");
}

toolRegistry.register({
  id: "list_dir",
  name: "List directory",
  description:
    "List the files and subdirectories in a directory. Image files are tagged [image], and the count line includes an image total. " +
    "Use to inspect directory contents or check whether a file exists. Use read_file when a complete file path is already known.\n\n" +
    "Parameters: path (required absolute path) and showHidden (include dot-prefixed entries; default false).",
  enabled: true,
  risk: "fs-read",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path of the directory to list" },
      showHidden: { type: "boolean", description: "Include dot-prefixed entries; defaults to false" },
    },
    required: ["path"],
  },
  execute: executeListDir,
});

// ── 工具 3：write_file ────────────────────────────────────

async function executeWriteFile(args: Record<string, unknown>): Promise<string> {
  const raw = String(args.path || "").trim();
  const filePath = ensureAbsolute(raw);
  if (!filePath) return "[Error] path must be absolute";

  const content = typeof args.content === "string" ? args.content : "";
  const append = args.append === true;
  const createDirs = args.createDirs !== false; // 默认创建父目录

  console.log(LOG_PREFIX, "write_file:", filePath, "bytes=" + Buffer.byteLength(content, "utf8"), append ? "(append)" : "(overwrite)");

  if (createDirs) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return "[Error] Failed to create the parent directory: " + msg;
    }
  }

  try {
    if (append) {
      fs.appendFileSync(filePath, content, "utf8");
    } else {
      fs.writeFileSync(filePath, content, "utf8");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Failed to write file: " + msg;
  }

  const st = safeStat(filePath);
  return "[OK] " + (append ? "Appended to" : "Wrote") + ": " + filePath +
    (st ? "\nsize: " + humanBytes(st.size) : "");
}

toolRegistry.register({
  id: "write_file",
  name: "Write file",
  description:
    "Write or append UTF-8 text to a local file, creating parent directories by default. Use for new files or complete rewrites; " +
    "use apply_patch for localized edits to existing files and dedicated tools for structured documents.\n\n" +
    "Parameters: path (absolute path), content, append (default false), and createDirs (default true).",
  enabled: true,
  risk: "fs-write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute destination path" },
      content: { type: "string", description: "UTF-8 text to write" },
      append: { type: "boolean", description: "Append when true; overwrite when false (default)" },
      createDirs: { type: "boolean", description: "Create missing parent directories; defaults to true" },
    },
    required: ["path", "content"],
  },
  execute: executeWriteFile,
});

// ── 工具 4：read_image ────────────────────────────────────
// 资源访问层：读图片→base64→交 vision-captioner 看图→返回文字。
// 不懂视觉，看图的活外包给 captioner。

// loadVisionConfig 在 index.ts，但 index.ts 也 import 本文件（副作用注册），形成循环。
// 用懒加载规避：运行时才 require，此时 index.ts 已初始化完。
function loadVisionConfigLazy() {
  const mod = require("../index") as { loadVisionConfig: () => import("./vision-captioner").VisionConfig | null };
  return mod.loadVisionConfig();
}

async function executeReadImage(
  args: Record<string, unknown>,
  ctx?: ToolContext,
): Promise<string> {
  const raw = String(args.path || "").trim();
  const filePath = ensureAbsolute(raw);
  if (!filePath) return "[Error] path must be absolute";

  const stat = safeStat(filePath);
  if (!stat) return "[Error] File does not exist or is inaccessible: " + filePath;
  if (!stat.isFile()) return "[Error] Path is not a file: " + filePath;
  if (stat.size > IMAGE_MAX_BYTES) {
    return "[Error] Image exceeds the " + humanBytes(IMAGE_MAX_BYTES) + " limit; current size: " + humanBytes(stat.size);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };
  const mime = mimeMap[ext];
  if (!mime) {
    return "[Error] Unsupported image format: " + ext + " (supported: png, jpg, jpeg, gif, webp, bmp, svg)";
  }

  console.log(LOG_PREFIX, "read_image:", filePath, "mime=" + mime, "size=" + humanBytes(stat.size));

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Failed to read image: " + msg;
  }

  // 查视觉模型配置（统一判断入口，不再有调度层门控）
  const visionConfig = loadVisionConfigLazy();
  if (!visionConfig) {
    return "[Configuration error] Vision is not enabled. Configure an OpenAI-compatible vision model in Settings → API Settings → Vision Model.";
  }

  // 调视觉模型看图，用户问题从 ToolContext 来
  const userQuery = ctx?.userQuery ?? "";
  const result = await captionImage(
    { base64: buf.toString("base64"), mime },
    userQuery,
    visionConfig,
  );
  return result;
}

toolRegistry.register({
  id: "read_image",
  name: "Read image",
  description:
    "Read a local image, analyze it with the configured vision model, and return a text description. " +
    "Supports png, jpg, jpeg, gif, webp, bmp, and svg up to 5MB. Use read_file for text and call this tool once per image. " +
    "If vision is not configured, report the configuration error to the user.\n\n" +
    "Parameter: path (required absolute path).",
  enabled: true,
  risk: "fs-read",
  needsContext: true,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute path of the image file" },
    },
    required: ["path"],
  },
  execute: executeReadImage,
});

console.log(LOG_PREFIX, "Registered: read_file / list_dir / write_file / read_image");
