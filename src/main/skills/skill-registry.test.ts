import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SkillRegistry } from "./skill-registry";
import type { SkillEntry } from "./types";

function entry(id: string, overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id,
    name: id,
    description: "d-" + id,
    dirPath: "/tmp/" + id,
    bodyPath: "/tmp/" + id + "/SKILL.md",
    references: [],
    enabled: true,
    source: "builtin",
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  let reg: SkillRegistry;
  beforeEach(() => { reg = new SkillRegistry(); });

  it("register / getById / getEnabled / getAll", () => {
    reg.register(entry("a"));
    reg.register(entry("b", { enabled: false }));
    expect(reg.getById("a")?.id).toBe("a");
    expect(reg.getEnabled().map(s => s.id)).toEqual(["a"]);
    expect(reg.getAll().map(s => s.id).sort()).toEqual(["a", "b"]);
  });

  it("toggles setEnabled", () => {
    reg.register(entry("a", { enabled: false }));
    reg.setEnabled("a", true);
    expect(reg.getById("a")?.enabled).toBe(true);
    expect(reg.getEnabled().map(s => s.id)).toEqual(["a"]);
  });

  it("excludes an enabled Skill when its runtime availability gate is closed", () => {
    reg.register(entry("music"));
    reg.setAvailability("music", () => false);

    expect(reg.getEnabled()).toEqual([]);
    expect(reg.getAll()[0].enabled).toBe(true);
  });

  it("lazy loads getBody + caches (disk changes do not refresh)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const mdPath = path.join(tmp, "SKILL.md");
    fs.writeFileSync(mdPath, "---\nname: a\ndescription: d\n---\nBody v1", "utf8");
    reg.register(entry("a", { bodyPath: mdPath }));
    expect(reg.getBody("a")).toBe("Body v1");
    // Modify disk, cache should return previous content (lazy cache semantics, per spec 5.4)
    fs.writeFileSync(mdPath, "---\nname: a\ndescription: d\n---\nBody v2", "utf8");
    expect(reg.getBody("a")).toBe("Body v1");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when getBody target does not exist", () => {
    expect(reg.getBody("nope")).toBeNull();
  });

  it("getBody strips frontmatter and returns body only", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const mdPath = path.join(tmp, "SKILL.md");
    fs.writeFileSync(mdPath, "---\nname: a\ndescription: d\ntools: [x]\n---\n# Body\nCall tools", "utf8");
    reg.register(entry("a", { bodyPath: mdPath }));
    const body = reg.getBody("a");
    expect(body).toBe("# Body\nCall tools");
    expect(body).not.toContain("description");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads getReference only when matching catalog list", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const refDir = path.join(tmp, "references");
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, "ok.md"), "ref", "utf8");
    reg.register(entry("a", { dirPath: tmp, references: ["ok.md"] }));
    expect(reg.getReference("a", "ok.md")).toBe("ref");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects getReference ref outside list (path traversal defense)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    reg.register(entry("a", { dirPath: tmp, references: ["ok.md"] }));
    expect(reg.getReference("a", "../../../etc/passwd")).toBeNull();
    expect(reg.getReference("a", "not-in-list.md")).toBeNull();
    expect(reg.getReference("a", "ok.md/../../etc")).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when getReference skill does not exist", () => {
    expect(reg.getReference("nope", "x.md")).toBeNull();
  });

  it("returns null when getBody bodyPath does not exist", () => {
    reg.register(entry("a", { bodyPath: "/nonexistent/path/SKILL.md" }));
    expect(reg.getBody("a")).toBeNull();
  });

  it("returns null when getReference file was deleted", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reg-"));
    const refDir = path.join(tmp, "references");
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, "ok.md"), "ref", "utf8");
    reg.register(entry("a", { dirPath: tmp, references: ["ok.md"] }));
    fs.unlinkSync(path.join(refDir, "ok.md"));
    expect(reg.getReference("a", "ok.md")).toBeNull();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
