import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("pet drag lifecycle contract", () => {
  it("registers exactly one wheel listener so a canvas event applies one zoom step", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/renderer/main.ts"), "utf8");
    expect(source.match(/addTrackedEventListener\([^\n]+\"wheel\"/g) ?? []).toHaveLength(1);
    expect(source).toContain('addTrackedEventListener(window, "window:wheel"');
  });
  it("ends Alt-drag on every browser capture-loss path", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "main.ts"), "utf8");
    expect(source).toContain('"lostpointercapture"');
    expect(source).toContain('"window:blur"');
    expect(source).toContain('"visibilitychange"');
    expect(source).toMatch(/function finishDrag\(\): void \{\s*if \(!isDragging\) return;/);
  });
});
