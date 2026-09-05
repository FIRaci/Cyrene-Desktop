// Skill registry — mirrors ToolRegistry Map + singleton pattern.
// Populated at startup by initSkills with scan results; getBody/getReference lazy load + cache.

import * as fs from "fs";
import * as path from "path";
import type { SkillEntry } from "./types";
import { parseSkillFrontmatter } from "./skill-scanner";

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();
  private bodyCache = new Map<string, string>();
  private availability = new Map<string, () => boolean>();

  register(skill: SkillEntry): void {
    this.skills.set(skill.id, skill);
  }

  getEnabled(): SkillEntry[] {
    return Array.from(this.skills.values()).filter(s => s.enabled && (this.availability.get(s.id)?.() ?? true));
  }

  getAll(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  getById(id: string): SkillEntry | undefined {
    return this.skills.get(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const s = this.skills.get(id);
    if (s) s.enabled = enabled;
  }

  setAvailability(id: string, probe: () => boolean): void {
    this.availability.set(id, probe);
  }

  isAvailable(id: string): boolean {
    return this.availability.get(id)?.() ?? true;
  }

  /**
   * Lazy-load SKILL.md body (stripping frontmatter) + cache.
   * Read-only at runtime, cache-safe (see spec 5.4: editing loaded skill body requires restart).
   * Returns null if skill does not exist or read fails.
   */
  getBody(id: string): string | null {
    const cached = this.bodyCache.get(id);
    if (cached !== undefined) return cached;
    const s = this.skills.get(id);
    if (!s) return null;
    try {
      const raw = fs.readFileSync(s.bodyPath, "utf8");
      // Reuse scanner gray-matter parse to strip frontmatter, avoiding regex divergences (BOM/multiline ---)
      const parsed = parseSkillFrontmatter(raw);
      const body = parsed ? parsed.body : raw.trim();
      this.bodyCache.set(id, body);
      return body;
    } catch {
      return null;
    }
  }

  /**
   * Read references attachment.
   * Path traversal protection: ref must match cached references list from scan stage and contain no path separators/..
   * Otherwise rejected (returns null). Does not directly concatenate raw ref into path.
   */
  getReference(id: string, ref: string): string | null {
    const s = this.skills.get(id);
    if (!s) return null;
    if (!s.references.includes(ref)) return null;
    if (ref.includes("/") || ref.includes("\\") || ref.includes("..")) return null;
    const refPath = path.join(s.dirPath, "references", ref);
    try {
      return fs.readFileSync(refPath, "utf8");
    } catch {
      return null;
    }
  }
}

// Global singleton
export const skillRegistry = new SkillRegistry();
