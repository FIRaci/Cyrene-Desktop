// User sticker storage management
// Manages CRUD for userData/sticker-manifest.json
// and image files under userData/stickers/

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { app } from "electron";
import { BUILT_IN_STICKER_FILES, BUILT_IN_STICKER_DESCRIPTIONS } from "./sticker-descriptions";
import { BUILT_IN_STICKER_IDS } from "../shared/sticker-types";
import type { UserStickerMeta, StickerConfigItem } from "../shared/sticker-types";
import { buildLocalStickerUrl } from "./sticker-protocol";

// ── Paths ──

export function getStickersDir(): string {
  return path.join(app.getPath("userData"), "stickers");
}

function getManifestPath(): string {
  return path.join(app.getPath("userData"), "sticker-manifest.json");
}

// ── Manifest I/O ──

interface ManifestFile {
  schemaVersion: number;
  stickers: Record<string, UserStickerMeta>;
}

export function loadUserStickerManifest(): Record<string, UserStickerMeta> {
  try {
    const filePath = getManifestPath();
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ManifestFile;
    return raw.stickers ?? {};
  } catch (err) {
    console.error("[stickers] load manifest failed:", err);
    return {};
  }
}

function saveUserStickerManifest(stickers: Record<string, UserStickerMeta>): void {
  const filePath = getManifestPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data: ManifestFile = { schemaVersion: 1, stickers };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── CRUD ──

/** Checks if id is already in use */
export function isStickerIdTaken(id: string): boolean {
  if (BUILT_IN_STICKER_IDS.includes(id as any)) return true;
  const manifest = loadUserStickerManifest();
  return id in manifest;
}

/** Adds user sticker: copy file + write to manifest */
export async function addUserSticker(
  sourceFilePath: string,
  id: string,
  description: string,
  phrases: string[],
): Promise<void> {
  // Check id
  if (isStickerIdTaken(id)) {
    throw new Error(`Sticker ID "${id}" already exists`);
  }

  // Get extension
  const ext = path.extname(sourceFilePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}`);
  }

  // Copy file to userData/stickers/
  const stickersDir = getStickersDir();
  fs.mkdirSync(stickersDir, { recursive: true });
  const destFile = `${id}${ext}`;
  const destPath = path.join(stickersDir, destFile);
  fs.copyFileSync(sourceFilePath, destPath);

  // Write to manifest
  const manifest = loadUserStickerManifest();
  manifest[id] = {
    id,
    file: destFile,
    description,
    phrases,
    createdAt: Date.now(),
  };
  saveUserStickerManifest(manifest);
}

/** Deletes user sticker: delete file + remove from manifest */
export async function deleteUserSticker(id: string): Promise<void> {
  // Built-in stickers cannot be deleted
  if (BUILT_IN_STICKER_IDS.includes(id as any)) {
    throw new Error(`Built-in sticker "${id}" cannot be deleted; it can only be disabled`);
  }

  const manifest = loadUserStickerManifest();
  const meta = manifest[id];
  if (!meta) throw new Error(`Sticker "${id}" does not exist`);

  // Delete file
  const filePath = path.join(getStickersDir(), meta.file);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File might have been deleted manually, ignore error
  }

  // Remove from manifest
  delete manifest[id];
  saveUserStickerManifest(manifest);
}

/** Gets configurations for all stickers (built-in + user) for manager/settings */
export function getAllStickerConfig(
  stickerSettings: Record<string, boolean>,
): StickerConfigItem[] {
  const items: StickerConfigItem[] = [];

  // Built-in
  for (const id of BUILT_IN_STICKER_IDS) {
    const file = BUILT_IN_STICKER_FILES[id];
    const desc = BUILT_IN_STICKER_DESCRIPTIONS[id];
    items.push({
      id,
      src: `/stickers/${file}`,
      enabled: stickerSettings[id] !== false,
      builtIn: true,
      description: desc ? desc.phrases.join("，") : id,
    });
  }

  // User added
  const manifest = loadUserStickerManifest();
  for (const [id, meta] of Object.entries(manifest)) {
    items.push({
      id,
      src: getLocalStickerUrl(meta.file),
      enabled: stickerSettings[id] !== false,
      builtIn: false,
      description: meta.phrases.length > 0 ? meta.phrases.join("，") : meta.description,
    });
  }

  return items;
}

/** Gets local protocol URL for user sticker image */
export function getLocalStickerUrl(file: string): string {
  return buildLocalStickerUrl(file);
}

/** Gets local disk path for user sticker file */
export function getUserStickerFilePath(file: string): string {
  return path.join(getStickersDir(), file);
}
