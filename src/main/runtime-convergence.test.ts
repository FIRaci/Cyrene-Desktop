import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("single runtime convergence", () => {
  it("does not ship a parallel companion provider or preload", () => {
    expect(fs.existsSync(path.join(root, "src/main/companion/companion-channel.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/main/companion/companion-window.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "preload-companion.js"))).toBe(false);
  });

  it("starts the modern pet before registering runtime services", () => {
    const source = read("src/main/index.ts");
    const readyBlock = source.slice(source.indexOf("app.whenReady()"));
    expect(readyBlock).toContain("createWindow();");
    expect(readyBlock).not.toContain("createCompanionWindow");
    expect(readyBlock).not.toContain('ipcMain.on("companion:');
  });

  it("prevents concurrent app instances from sharing persistent state", () => {
    const source = read("src/main/index.ts");
    expect(source).toContain("app.requestSingleInstanceLock()");
    expect(source).toContain('app.on("second-instance"');
  });

  it("keeps legacy root launchers out of the packaged application", () => {
    const builder = read("electron-builder.yml");
    expect(builder).not.toMatch(/^\s*- main\.js\s*$/m);
    expect(builder).not.toMatch(/^\s*- preload\.js\s*$/m);
    expect(builder).not.toMatch(/^\s*- cyrene_companion\.html\s*$/m);
  });

  it("keeps the legacy companion reference free of removed mini-chat DOM access", () => {
    const legacyCompanion = read("cyrene_companion.html");
    const startup = legacyCompanion.slice(legacyCompanion.indexOf("document.addEventListener('DOMContentLoaded'"));
    expect(startup).not.toContain("document.getElementById('chat-input')");
    expect(startup).not.toContain("document.getElementById('chat-panel')");
    expect(startup).toContain("initLive2D();");
  });
});
