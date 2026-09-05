// channels settings-store unit tests
// Validates safeStorage encrypt/decrypt boundary + private field persistence round-trip
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock Electron safeStorage (does not require real keychain)
const encState = new Map<string, string>(); // plaintext -> base64 ciphertext
let encryptCalls = 0;
let decryptCalls = 0;

vi.mock("electron", () => {
  return {
    app: {
      getPath: (_k: string) => os.tmpdir(),
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) => {
        encryptCalls++;
        const fake = Buffer.from("ENC(" + plain + ")").toString("base64");
        encState.set(plain, fake);
        return Buffer.from(fake, "base64");
      },
      decryptString: (buf: Buffer) => {
        decryptCalls++;
        const b64 = buf.toString("base64");
        // Reverse lookup plaintext
        for (const [plain, stored] of encState.entries()) {
          if (stored === b64) return plain;
        }
        throw new Error("mock decrypt failed");
      },
    },
  };
});

// Must import after mock
// eslint-disable-next-line import/first
import { loadChannelsSettings, saveChannelsSettings } from "./settings-store";

describe("channels/settings-store", () => {
  beforeEach(() => {
    // Clean up disk file before each test if present
    const p = path.join(os.tmpdir(), "channels-settings.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);
    encState.clear();
    encryptCalls = 0;
    decryptCalls = 0;
  });

  it("loadChannelsSettings: returns default values when non-existent", () => {
    const cfg = loadChannelsSettings();
    expect(cfg.wechat.enabled).toBe(false);
    expect(cfg.feishu.enabled).toBe(false);
    expect(cfg.rateLimitPerUser).toBe(10);
  });

  it("saveChannelsSettings + load: private fields encrypted on disk + decrypted on restore", () => {
    saveChannelsSettings({
      feishu: {
        enabled: true,
        appId: "cli_test_001",
        appSecret: "my-super-secret",
      },
    });
    // Disk content should have enc: prefix ciphertext
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).not.toContain("my-super-secret"); // Plaintext not saved on disk
    expect(raw).toContain("cli_test_001"); // Public field in plaintext
    expect(raw).toContain('"appSecret": "enc:'); // Sensitive field encrypted
    // Loading back restores plaintext
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appId).toBe("cli_test_001");
    expect(loaded.feishu.appSecret).toBe("my-super-secret");
  });

  it("saveChannelsSettings: omitting secret does not overwrite existing value", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "secret-1" } });
    // Second save without secret
    saveChannelsSettings({ feishu: { enabled: false, appId: "cli_002" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("secret-1"); // Preserved
    expect(loaded.feishu.appId).toBe("cli_002");
    expect(loaded.feishu.enabled).toBe(false);
  });

  it("saveChannelsSettings: passing new secret overwrites previous", () => {
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "old" } });
    saveChannelsSettings({ feishu: { enabled: true, appSecret: "new" } });
    const loaded = loadChannelsSettings();
    expect(loaded.feishu.appSecret).toBe("new");
  });

  it("saveChannelsSettings: persists the off tool sandbox", () => {
    saveChannelsSettings({ toolSandbox: "off" });
    expect(loadChannelsSettings().toolSandbox).toBe("off");
  });
});
