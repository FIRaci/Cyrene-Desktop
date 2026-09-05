// Behavioral tests for settings-store when safeStorage is unavailable.
// Core verification: When safeStorage is unavailable, secrets are preserved via machine fingerprint XOR obfuscation.
//
// Note: vi.mock("electron") is isolated per file in vitest (independent worker per file),
// but settings-store module is an ESM singleton where isSafeStorageAvailable is a module-level memo,
// so this file assumes the mock is read when the module is imported.
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Use independent subdirectory to isolate from settings-store.test.ts (which uses os.tmpdir())
const FALLBACK_TMP = path.join(os.tmpdir(), "cyrene-fallback-test");
fs.mkdirSync(FALLBACK_TMP, { recursive: true });

// Mock electron: safeStorage.isEncryptionAvailable -> false
// app.getPath -> our subdirectory; app.getName -> fixed string
vi.mock("electron", () => {
  return {
    app: {
      getPath: (_k: string) => FALLBACK_TMP,
      getName: () => "live2d-cyrene",
    },
    safeStorage: {
      isEncryptionAvailable: () => false, // Simulate Linux/headless sandbox environment
      encryptString: (_plain: string) => {
        throw new Error("safeStorage is unavailable - should not be called");
      },
      decryptString: (_buf: Buffer) => {
        throw new Error("safeStorage is unavailable - should not be called");
      },
    },
  };
});

// eslint-disable-next-line import/first
import { loadChannelsSettings, saveChannelsSettings } from "./settings-store";

describe("settings-store: safeStorage unavailable fallback", () => {
  beforeEach(() => {
    const p = path.join(FALLBACK_TMP, "channels-settings.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it("fallback test environment ready: FALLBACK_TMP exists and settings file absent", () => {
    expect(fs.existsSync(FALLBACK_TMP)).toBe(true);
    expect(fs.existsSync(path.join(FALLBACK_TMP, "channels-settings.json"))).toBe(false);
  });

  it("save + load round-trip restores plaintext in fallback mode (obfuscation succeeds)", () => {
    saveChannelsSettings({
      feishu: { enabled: true, appSecret: "fallback-roundtrip" },
    });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("fallback-roundtrip");
  });

  it("save does not leave plaintext secret on disk (either enc: or obf:)", () => {
    saveChannelsSettings({
      feishu: { enabled: true, appSecret: "obscured-secret-123" },
    });
    const raw = fs.readFileSync(path.join(FALLBACK_TMP, "channels-settings.json"), "utf8");
    expect(raw).not.toContain("obscured-secret-123");
    expect(raw).toMatch(/"appSecret":\s*"(enc|obf):/);
  });

  it("secondary save does not overwrite existing secret", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "first-secret" } });
    saveChannelsSettings({ feishu: { enabled: false, appId: "cli_002" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("first-secret");
    expect(loaded.feishu.appId).toBe("cli_002");
    expect(loaded.feishu.enabled).toBe(false);
  });

  it("pre-writing an obf: field to disk restores plaintext on load", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "preboot-secret" } });
    const raw = fs.readFileSync(path.join(FALLBACK_TMP, "channels-settings.json"), "utf8");
    expect(raw).toContain('"appSecret": "obf:');

    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("preboot-secret");
  });
});