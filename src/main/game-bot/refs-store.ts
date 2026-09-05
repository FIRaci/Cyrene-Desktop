// refs-store — reference image store. userData/game-bot/refs/<recipe>/<ref>.png.
// Only module touching electron (app.getPath); reads and writes via pure fs.
// Cropped reference images from bounding box editors are stored here, read by vlm_click at runtime.

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

/** Absolute path to reference images directory for a recipe. */
export function refsDirPath(recipeId: string): string {
  if (!isGameBotIdentifier(recipeId)) throw new TypeError("Invalid game-bot recipe identifier");
  return containedPath(refsRootPath(), recipeId);
}

/** Lists all reference image names for a recipe (excluding .png suffix). */
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

/** Reads reference image. Returns {base64, mime}; returns null if non-existent. */
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

// Note: reference images are placed by user into refsDirPath(recipeId) as <ref>.png.
// Backend is read-only.
