import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = { main?: unknown };

describe("Electron package entry", () => {
  it("uses the modern TypeScript runtime emitted under dist", () => {
    const repoRoot = process.cwd();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.main).toBe("dist/main/main/index.js");
    expect(String(manifest.main)).not.toBe("main.js");
  });

  it("includes the modern entry through the electron-builder dist rule", () => {
    const builderConfig = fs.readFileSync(
      path.join(process.cwd(), "electron-builder.yml"),
      "utf8",
    );

    expect(builderConfig).toMatch(/^\s*- dist\/\*\*\/\*\s*$/m);
  });
});
