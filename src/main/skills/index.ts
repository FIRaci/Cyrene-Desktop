// Skill system startup entry + public API.
// Only module interacting with electron (app.getPath); scanSkills/registry/tools are pure logic or singletons.

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { scanSkills } from "./skill-scanner";
import { skillRegistry } from "./skill-registry";
import { registerSkillTools } from "./skill-tools";
import type { SkillEntry } from "./types";

const LOG_PREFIX = "[Skills]";

/** Skill enabled state persistence file (userData/skills-enabled.json). */
function enabledStatePath(): string {
  return path.join(app.getPath("userData"), "skills-enabled.json");
}

/** Read persisted enabled state (id -> bool). */
function loadEnabledState(): Record<string, boolean> {
  try {
    const p = enabledStatePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Startup entry: scan dual-source skills -> populate registry (user overrides builtin at dir-level + merge enabled state) -> register meta-tools.
 * Must be called after app.whenReady (depends on app.getPath).
 */
export function initSkills(): void {
  const builtinDir = path.join(app.getAppPath(), "skills");
  const userDir = path.join(app.getPath("userData"), "skills");

  const builtin = scanSkills(builtinDir, "builtin");
  const user = scanSkills(userDir, "user");

  // Merge: by id, user overrides builtin (directory-level wholesale override, per spec 4.1)
  const map = new Map<string, SkillEntry>();
  for (const s of builtin) map.set(s.id, s);
  for (const s of user) map.set(s.id, s);

  // Merge enabled state (persisted in settings.json overrides default true)
  const saved = loadEnabledState();
  for (const s of map.values()) {
    if (s.id in saved) s.enabled = saved[s.id];
    skillRegistry.register(s);
  }

  registerSkillTools();
  console.log(LOG_PREFIX, `Loaded ${map.size} skills:`, Array.from(map.keys()).join(", ") || "(none)");
}

/** Persist enabled state for a skill. */
export function setSkillEnabled(id: string, enabled: boolean): void {
  skillRegistry.setEnabled(id, enabled);
  try {
    const saved = loadEnabledState();
    saved[id] = enabled;
    fs.mkdirSync(path.dirname(enabledStatePath()), { recursive: true });
    fs.writeFileSync(enabledStatePath(), JSON.stringify(saved, null, 2), "utf8");
  } catch (err) {
    console.warn(LOG_PREFIX, "Failed to persist enabled state:", err);
  }
}

/** Return metadata for all skills (for UI consumption). */
export function listSkillsForUi() {
  return skillRegistry.getAll().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tools: s.tools ?? [],
    enabled: s.enabled,
    source: s.source,
    version: s.version,
    references: s.references,
  }));
}

export { skillRegistry } from "./skill-registry";
export { buildAutoInjectedSkillContext, buildAutoInjectedSoulContext, buildSkillCatalog } from "./skill-catalog";
export { parseSlashCommand } from "./skill-commands";
