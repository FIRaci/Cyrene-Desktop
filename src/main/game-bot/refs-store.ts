// refs-store —— 参考图存储。userData/game-bot/refs/<recipe>/<ref>.png。
// 唯一碰 electron 的模块（app.getPath）；读写纯 fs。
// 红框标记编辑器裁出的小图存这里，运行时 vlm_click 按 ref 名读取。

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { isGameBotIdentifier } from "./settings-store";

function refsRootPath(): string {
  return path.resolve(app.getPath("userData"), "game-bot", "refs");
}

function containedPath(root: string, ...segments: string[]): string {
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (relative !== "" && (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative))) {
    throw new Error("Resolved game-bot path escapes its storage root");
  }
  // Resolve existing links as well: an otherwise valid ID must not reach a
  // junction/symlink planted below the refs root.
  if (fs.existsSync(root) && fs.existsSync(candidate)) {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalCandidate = fs.realpathSync(candidate);
    const canonicalRelative = path.relative(canonicalRoot, canonicalCandidate);
    if (canonicalRelative.startsWith(".." + path.sep) || canonicalRelative === ".." || path.isAbsolute(canonicalRelative)) {
      throw new Error("Canonical game-bot path escapes its storage root");
    }
  }
  return candidate;
}

/** 某 recipe 的参考图目录绝对路径。 */
export function refsDirPath(recipeId: string): string {
  if (!isGameBotIdentifier(recipeId)) throw new TypeError("Invalid game-bot recipe identifier");
  return containedPath(refsRootPath(), recipeId);
}

/** 列出某 recipe 下所有参考图名（不含 .png 后缀）。 */
export function listRefs(recipeId: string): string[] {
  try {
    const dir = refsDirPath(recipeId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith(".png") && isGameBotIdentifier(f.slice(0, -4)))
      .map(f => f.slice(0, -4));
  } catch {
    return [];
  }
}

/** 读取参考图。返回 {base64, mime}；不存在返回 null。 */
export function readRef(recipeId: string, refName: string): { base64: string; mime: string } | null {
  try {
    if (!isGameBotIdentifier(refName)) return null;
    const dir = refsDirPath(recipeId);
    const file = containedPath(dir, refName + ".png");
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    return { base64: buf.toString("base64"), mime: "image/png" };
  } catch {
    return null;
  }
}

// 说明：参考图由用户自行把裁好的小图（按 ref 命名 .png）放进 refsDirPath(recipeId) 目录。
// 不提供前端写入入口——后端只读。
