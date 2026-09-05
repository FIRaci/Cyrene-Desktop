import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseSkillFrontmatter, scanSkills } from "./skill-scanner";

describe("parseSkillFrontmatter", () => {
  it("parses valid SKILL.md", () => {
    const md = `---
name: write-expense-report
description: Generate expense report
tools: [query_expense, write_excel]
version: 1.0.0
---

# Write expense report

Call query_expense to fetch data.`;
    const r = parseSkillFrontmatter(md);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("write-expense-report");
    expect(r!.description).toBe("Generate expense report");
    expect(r!.tools).toEqual(["query_expense", "write_excel"]);
    expect(r!.version).toBe("1.0.0");
    expect(r!.body).toContain("# Write expense report");
    expect(r!.body).not.toContain("description:");
  });

  it("parses without tools/version", () => {
    const md = `---
name: plain
description: Pure instruction
---
Body`;
    const r = parseSkillFrontmatter(md);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("plain");
    expect(r!.description).toBe("Pure instruction");
    expect(r!.tools).toBeUndefined();
    expect(r!.version).toBeUndefined();
    expect(r!.body).toBe("Body");
  });

  it("returns null when name is missing", () => {
    const md = `---
description: Missing name
---
Body`;
    expect(parseSkillFrontmatter(md)).toBeNull();
  });

  it("returns null when description is missing", () => {
    const md = `---
name: x
---
Body`;
    expect(parseSkillFrontmatter(md)).toBeNull();
  });

  it("returns null when tools is not an array", () => {
    const md = `---
name: x
description: d
tools: query_expense
---
Body`;
    expect(parseSkillFrontmatter(md)).toBeNull();
  });

  it("returns null when frontmatter is missing", () => {
    expect(parseSkillFrontmatter("pure body without frontmatter")).toBeNull();
  });
});

/** Create temporary skill directory. */
function makeSkillDir(root: string, id: string, md: string, refs: string[] = []): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), md, "utf8");
  if (refs.length > 0) {
    const rdir = path.join(dir, "references");
    fs.mkdirSync(rdir, { recursive: true });
    for (const r of refs) fs.writeFileSync(path.join(rdir, r), "ref content", "utf8");
  }
}

describe("scanSkills", () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-")); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("scans valid skills and lists references filenames", () => {
    makeSkillDir(tmp, "write-expense-report",
      "---\nname: write-expense-report\ndescription: Generate expense report\ntools: [query_expense]\n---\nBody",
      ["col-spec.md", "examples.json"]);
    const r = scanSkills(tmp, "builtin");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("write-expense-report");
    expect(r[0].references).toEqual(expect.arrayContaining(["col-spec.md", "examples.json"]));
    expect(r[0].references).not.toContain("SKILL.md");
    expect(r[0].source).toBe("builtin");
    expect(r[0].enabled).toBe(true);
    expect(r[0].dirPath).toBe(path.join(tmp, "write-expense-report"));
  });

  it("skips invalid skill (no description)", () => {
    makeSkillDir(tmp, "bad", "---\nname: bad\n---\nBody");
    const r = scanSkills(tmp, "builtin");
    expect(r).toHaveLength(0);
  });

  it("skips directories without SKILL.md", () => {
    fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
    const r = scanSkills(tmp, "builtin");
    expect(r).toHaveLength(0);
  });

  it("records skill even if name differs from dir name, using dir name as id", () => {
    makeSkillDir(tmp, "real-id", "---\nname: other-name\ndescription: x\n---\nBody");
    const r = scanSkills(tmp, "builtin");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("real-id");
    expect(r[0].name).toBe("other-name");
    expect(r[0].dirPath).toBe(path.join(tmp, "real-id"));
    expect(r[0].bodyPath).toBe(path.join(tmp, "real-id", "SKILL.md"));
  });

  it("returns empty array if directory does not exist", () => {
    const r = scanSkills(path.join(tmp, "nope"), "builtin");
    expect(r).toHaveLength(0);
  });

  it("returns empty array for empty root directory", () => {
    const emptyRoot = path.join(tmp, "empty-root");
    fs.mkdirSync(emptyRoot, { recursive: true });
    const r = scanSkills(emptyRoot, "builtin");
    expect(r).toHaveLength(0);
  });

  it("returns empty array for references when directory is absent", () => {
    makeSkillDir(tmp, "no-refs", "---\nname: no-refs\ndescription: x\n---\nBody");
    const r = scanSkills(tmp, "builtin");
    expect(r[0].references).toEqual([]);
  });

  it("excludes subdirectories under references, listing only files", () => {
    makeSkillDir(tmp, "with-refs", "---\nname: with-refs\ndescription: x\n---\nBody");
    const refDir = path.join(tmp, "with-refs", "references");
    fs.mkdirSync(path.join(refDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(refDir, "note.md"), "n", "utf8");
    fs.writeFileSync(path.join(refDir, "sub", "inner.md"), "i", "utf8");
    const r = scanSkills(tmp, "builtin");
    expect(r[0].references).toEqual(["note.md"]);
  });

  it("scans multiple skills with correct source marker", () => {
    makeSkillDir(tmp, "a", "---\nname: a\ndescription: x\n---\nBody");
    makeSkillDir(tmp, "b", "---\nname: b\ndescription: y\n---\nBody");
    const r = scanSkills(tmp, "user");
    expect(r.map(s => s.id).sort()).toEqual(["a", "b"]);
    expect(r.every(s => s.source === "user")).toBe(true);
  });

  it("reads compound Skill dependencies and default switch from manifest.json", () => {
    makeSkillDir(tmp, "music", "---\nname: music\ndescription: d\n---\nBody");
    fs.writeFileSync(path.join(tmp, "music", "manifest.json"), JSON.stringify({
      id: "music",
      version: "1.0.0",
      defaultEnabled: false,
      entry: "index.ts",
      dependencies: ["music_search", "music_play_track"],
      autoPlayPolicy: "explicit_selection_or_delegate",
      autoInject: true,
    }), "utf8");

    const [skill] = scanSkills(tmp, "builtin");

    expect(skill.enabled).toBe(false);
    expect(skill.manifest?.dependencies).toEqual(["music_search", "music_play_track"]);
    expect(skill.manifest?.entry).toBe("index.ts");
    expect(skill.manifest?.autoInject).toBe(true);
  });
});
