import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("sidebar-contract", () => {
  const root = process.cwd();

  it("sidebar/index.html unlocks status and feeling without 'Please enable in settings'", () => {
    const html = fs.readFileSync(path.join(root, "src/renderer/sidebar/index.html"), "utf8");
    expect(html).not.toContain("Please enable in settings");
    expect(html).toContain('id="status-label">Accompanying<');
    expect(html).toContain('id="feeling-label">Calm<');
    expect(html).toContain('panel-card--status');
    expect(html).toContain('panel-card--feeling');
  });

  it("sidebar/sidebar.ts does not suppress runtime state behind applyRuntimeDisabled", () => {
    const ts = fs.readFileSync(path.join(root, "src/renderer/sidebar/sidebar.ts"), "utf8");
    expect(ts).not.toContain("applyRuntimeDisabled");
    expect(ts).not.toContain("Please enable in settings");
    expect(ts).toContain("window.sidebar?.openSettings");
  });
});
