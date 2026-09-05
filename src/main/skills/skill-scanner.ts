// Skill scanner — frontmatter parser + directory scanner.
// Pure function module: parseSkillFrontmatter / scanSkills do not depend on electron, making unit testing straightforward.
// Electron specifics (app.getPath) are injected by the caller in initSkills.

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import type { ParsedSkill, SkillEntry, SkillManifest } from "./types";

function readManifest(skillDir: string, id: string): SkillManifest | undefined {
  const manifestPath = path.join(skillDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Partial<SkillManifest>;
    if (value.id !== id || typeof value.version !== "string" || typeof value.defaultEnabled !== "boolean"
      || typeof value.entry !== "string" || !Array.isArray(value.dependencies)) return undefined;
    return { ...value, dependencies: value.dependencies.map(String) } as SkillManifest;
  } catch {
    return undefined;
  }
}

/** Minimal structure for gray-matter parse results (avoids export = typing access issues). */
interface MatterResult {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Parse SKILL.md text: frontmatter (name/description/tools?/version?/autoInject?) + body.
 * Pure function, does not touch fs/electron.
 * Returns null on invalid format (missing name/description, tools not array, or no frontmatter).
 */
export function parseSkillFrontmatter(content: string): ParsedSkill | null {
  let parsed: MatterResult;
  try {
    parsed = matter(content) as unknown as MatterResult;
  } catch {
    return null;
  }
  const d = parsed.data ?? {};
  if (typeof d.name !== "string" || !d.name) return null;
  if (typeof d.description !== "string" || !d.description) return null;
  if (d.tools !== undefined && !Array.isArray(d.tools)) return null;
  return {
    name: d.name,
    description: d.description,
    tools: Array.isArray(d.tools) ? d.tools.map(String) : undefined,
    version: d.version !== undefined ? String(d.version) : undefined,
    body: parsed.content.trim(),
  };
}

/**
 * Scan a single skill root directory, returning a list of valid SkillEntry objects.
 * Pure function: only depends on passed directory path, does not touch electron.
 *
 * @param dir Skill root directory (each subdirectory is a skill)
 * @param source Source origin marker for this batch (builtin/user)
 *
 * Invalid skills (missing SKILL.md, frontmatter parse failure) are skipped with a warning without throwing errors.
 * enabled defaults to true, merged and overridden by initSkills with settings.json.
 * Cross-source override (user overrides builtin) is handled in initSkills during merge, not in this function.
 */
export function scanSkills(dir: string, source: "builtin" | "user"): SkillEntry[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];  // Directory does not exist or permission denied
  }
  const result: SkillEntry[] = [];
  for (const id of entries) {
    const skillDir = path.join(dir, id);
    const mdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(mdPath)) {
      console.warn("[Skills] Skipping directory without SKILL.md:", skillDir);
      continue;
    }
    let content: string;
    try {
      content = fs.readFileSync(mdPath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseSkillFrontmatter(content);
    if (!parsed) {
      console.warn("[Skills] Skipping invalid SKILL.md (missing name/description or frontmatter parse error):", mdPath);
      continue;
    }
    if (parsed.name !== id) {
      console.warn(`[Skills] name(${parsed.name}) ≠ directory name(${id}), using directory name as id`);
    }
    // List references filenames (excluding contents)
    let references: string[] = [];
    const refDir = path.join(skillDir, "references");
    try {
      if (fs.existsSync(refDir) && fs.statSync(refDir).isDirectory()) {
        references = fs.readdirSync(refDir).filter(f => fs.statSync(path.join(refDir, f)).isFile());
      }
    } catch {
      references = [];
    }
    const manifest = readManifest(skillDir, id);
    result.push({
      id,
      name: parsed.name,
      description: parsed.description,
      tools: parsed.tools ?? manifest?.dependencies,
      version: parsed.version ?? manifest?.version,
      dirPath: skillDir,
      bodyPath: mdPath,
      references,
      enabled: manifest?.defaultEnabled ?? true,
      source,
      manifest,
    });
  }
  return result;
}
