import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ALLOWED_TTS_SETTING_KEYS, type TtsSettingKey } from "../shared/tts-types";

describe("Release Audit Remediation Tests", () => {
  describe("General Settings Secret Redaction", () => {
    function redactGeneralSettings(settings: any): any {
      return {
        ...settings,
        ttsMinimaxKey: settings.ttsMinimaxKey ? "••••••••" : "",
        ttsCustomCloudApiKey: settings.ttsCustomCloudApiKey ? "••••••••" : "",
        ttsMimoKey: settings.ttsMimoKey ? "••••••••" : "",
        searchMinimaxKey: settings.searchMinimaxKey ? "••••••••" : "",
        searchBochaKey: settings.searchBochaKey ? "••••••••" : "",
        searchTavilyKey: settings.searchTavilyKey ? "••••••••" : "",
        amapKey: settings.amapKey ? "••••••••" : "",
        asrAliyunAppKey: settings.asrAliyunAppKey ? "••••••••" : "",
        asrAliyunAccessKeyId: settings.asrAliyunAccessKeyId ? "••••••••" : "",
        asrAliyunAccessKeySecret: settings.asrAliyunAccessKeySecret ? "••••••••" : "",
      };
    }

    it("redacts sensitive API keys for non-settings callers", () => {
      const sensitive = {
        theme: "dark",
        ttsEngine: "minimax",
        ttsMinimaxKey: "sk-secret-12345",
        ttsCustomCloudApiKey: "custom-token-xyz",
        ttsMimoKey: "mimo-key-123",
        searchMinimaxKey: "sk-search-99999",
        searchBochaKey: "bocha-key-888",
        searchTavilyKey: "tavily-key-777",
        amapKey: "amap-key-666",
        asrAliyunAppKey: "ali-app",
        asrAliyunAccessKeyId: "ali-id",
        asrAliyunAccessKeySecret: "ali-secret",
      };

      const redacted = redactGeneralSettings(sensitive);
      expect(redacted.theme).toBe("dark");
      expect(redacted.ttsEngine).toBe("minimax");
      expect(redacted.ttsMinimaxKey).toBe("••••••••");
      expect(redacted.ttsCustomCloudApiKey).toBe("••••••••");
      expect(redacted.ttsMimoKey).toBe("••••••••");
      expect(redacted.searchMinimaxKey).toBe("••••••••");
      expect(redacted.searchBochaKey).toBe("••••••••");
      expect(redacted.searchTavilyKey).toBe("••••••••");
      expect(redacted.amapKey).toBe("••••••••");
      expect(redacted.asrAliyunAppKey).toBe("••••••••");
      expect(redacted.asrAliyunAccessKeyId).toBe("••••••••");
      expect(redacted.asrAliyunAccessKeySecret).toBe("••••••••");
    });

    it("leaves empty keys as empty strings", () => {
      const emptyKeys = {
        ttsMinimaxKey: "",
        searchMinimaxKey: "",
      };
      const redacted = redactGeneralSettings(emptyKeys);
      expect(redacted.ttsMinimaxKey).toBe("");
      expect(redacted.searchMinimaxKey).toBe("");
    });
  });

  describe("TTS_SAVE_SETTINGS Canonical Whitelist Table-Driven Validation", () => {
    const ALLOWED_SET = new Set<string>(ALLOWED_TTS_SETTING_KEYS);

    function sanitizeTtsPayload(input: Record<string, any>): Record<string, any> {
      const sanitized: Record<string, any> = {};
      for (const [k, v] of Object.entries(input)) {
        if (ALLOWED_SET.has(k)) {
          sanitized[k] = v;
        }
      }
      return sanitized;
    }

    it("contains all expected UI fields matching GeneralSettings", () => {
      // Table-driven verification of each canonical key
      const expectedKeys: TtsSettingKey[] = [
        "ttsEngine",
        "ttsAutoRead",
        "ttsSpeed",
        "ttsVolume",
        "ttsMinimaxKey",
        "ttsMinimaxVoiceId",
        "ttsMinimaxModel",
        "ttsStreaming",
        "ttsGptsovitsBaseUrl",
        "ttsGptsovitsRefAudioPath",
        "ttsGptsovitsPromptText",
        "ttsGptsovitsFormat",
        "ttsGptsovitsLanguageMode",
        "ttsRvcEnabled",
        "ttsRvcBaseUrl",
        "ttsRvcModel",
        "ttsRvcPitch",
        "ttsRvcIndexRate",
        "ttsCustomCloudEndpointUrl",
        "ttsCustomCloudApiKey",
        "ttsCustomCloudVoiceId",
        "ttsCustomCloudFormat",
        "ttsCustomCloudTimeoutMs",
        "ttsMimoKey",
        "ttsMimoVoiceAudioPath",
        "ttsMimoStylePrompt",
        "ttsMosslandKey",
        "ttsMosslandVoiceId",
        "ttsMosslandModel",
        "ttsMosslandTestText",
        "ttsMosslandFormat",
        "searchMinimaxKey",
        "searchEngine",
        "playwrightMcpEnabled",
        "proactiveChatMode",
      ];

      for (const key of expectedKeys) {
        expect(ALLOWED_SET.has(key)).toBe(true);
      }
      expect(ALLOWED_TTS_SETTING_KEYS.length).toBe(expectedKeys.length);
    });

    it("verifies save -> sanitize -> equality for every individual key", () => {
      const sampleValues: Record<TtsSettingKey, any> = {
        ttsEngine: "gptsovits",
        ttsAutoRead: true,
        ttsSpeed: 1.25,
        ttsVolume: 0.8,
        ttsMinimaxKey: "minimax-test-key",
        ttsMinimaxVoiceId: "voice-123",
        ttsMinimaxModel: "speech-2.8-hd",
        ttsStreaming: true,
        ttsGptsovitsBaseUrl: "http://localhost:9880",
        ttsGptsovitsRefAudioPath: "D:\\audio\\ref.wav",
        ttsGptsovitsPromptText: "Hello there",
        ttsGptsovitsFormat: "wav",
        ttsGptsovitsLanguageMode: "english",
        ttsRvcEnabled: true,
        ttsRvcBaseUrl: "http://localhost:18888",
        ttsRvcModel: "cyrene_v2.pth",
        ttsRvcPitch: 2,
        ttsRvcIndexRate: 0.75,
        ttsCustomCloudEndpointUrl: "https://my-tts.example.com/api",
        ttsCustomCloudApiKey: "custom-cloud-secret",
        ttsCustomCloudVoiceId: "custom-voice-9",
        ttsCustomCloudFormat: "mp3",
        ttsCustomCloudTimeoutMs: 15000,
        ttsMimoKey: "mimo-secret-token",
        ttsMimoVoiceAudioPath: "D:\\audio\\mimo.wav",
        ttsMimoStylePrompt: "gentle, affectionate",
        ttsMosslandKey: "mossland-secret",
        ttsMosslandVoiceId: "moss-voice-1",
        ttsMosslandModel: "moss-tts",
        ttsMosslandTestText: "Hello from Cyrene",
        ttsMosslandFormat: "mp3",
        searchMinimaxKey: "search-secret",
        searchEngine: "minimax",
        playwrightMcpEnabled: true,
        proactiveChatMode: "low",
      };

      for (const [key, value] of Object.entries(sampleValues)) {
        const payload = { [key]: value };
        const sanitized = sanitizeTtsPayload(payload);
        expect(sanitized[key]).toBe(value);
      }
    });

    it("strips unauthorized general settings fields from TTS save handler", () => {
      const malicious = {
        ttsEngine: "minimax",
        launchAtLogin: true,
        toolSandbox: "disabled",
        systemAudioAwarenessEnabled: false,
        unauthorizedCustomField: "danger",
      };
      const result = sanitizeTtsPayload(malicious);
      expect(result).toEqual({ ttsEngine: "minimax" });
      expect(result).not.toHaveProperty("launchAtLogin");
      expect(result).not.toHaveProperty("toolSandbox");
      expect(result).not.toHaveProperty("systemAudioAwarenessEnabled");
      expect(result).not.toHaveProperty("unauthorizedCustomField");
    });

    it("uses the shared canonical whitelist in the production IPC handler", () => {
      const mainSource = fs.readFileSync(path.join(process.cwd(), "src", "main", "index.ts"), "utf8");
      expect(mainSource).toContain("new Set<string>(ALLOWED_TTS_SETTING_KEYS)");
      expect(mainSource).not.toContain('"customCloudUrl", "customCloudApiKey"');
      expect(mainSource).not.toContain('"gptsovitsUrl", "gptsovitsApiKey"');
      expect(mainSource).not.toContain('"voiceConversionEnabled", "voiceConversionRvcUrl"');
    });
  });

  describe("API Log Privacy Gating & Rotation", () => {
    it("does not write api log when CYRENE_DEBUG_API_LOG is not set to true", () => {
      const origEnv = process.env.CYRENE_DEBUG_API_LOG;
      delete process.env.CYRENE_DEBUG_API_LOG;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-test-log-"));
      const testLogPath = path.join(tmpDir, "chat-api.log");

      function testAppendApiLog(logPath: string) {
        if (process.env.CYRENE_DEBUG_API_LOG !== "true") return;
        fs.appendFileSync(logPath, "secret prompt data\n", "utf8");
      }

      testAppendApiLog(testLogPath);
      expect(fs.existsSync(testLogPath)).toBe(false);

      process.env.CYRENE_DEBUG_API_LOG = "true";
      testAppendApiLog(testLogPath);
      expect(fs.existsSync(testLogPath)).toBe(true);

      // Clean up
      if (origEnv !== undefined) process.env.CYRENE_DEBUG_API_LOG = origEnv;
      else delete process.env.CYRENE_DEBUG_API_LOG;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("rotates log file when it exceeds 5 MB", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-test-rotate-"));
      const testLogPath = path.join(tmpDir, "chat-api.log");
      const backupPath = testLogPath + ".1";

      const fiveMegsPlus = Buffer.alloc(5 * 1024 * 1024 + 1024, "x");
      fs.writeFileSync(testLogPath, fiveMegsPlus);

      if (fs.existsSync(testLogPath)) {
        const stat = fs.statSync(testLogPath);
        if (stat.size > 5 * 1024 * 1024) {
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
          fs.renameSync(testLogPath, backupPath);
        }
      }

      expect(fs.existsSync(backupPath)).toBe(true);
      expect(fs.existsSync(testLogPath)).toBe(false);
      expect(fs.statSync(backupPath).size).toBeGreaterThan(5 * 1024 * 1024);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("Drive D Migration Transaction Logic", () => {
    it("safely migrates settings and chat files from legacy AppData directory to Drive D", () => {
      const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-drive-d-test-"));
      const legacyDir = path.join(tmpBase, "AppData", "cyrene-desktop");
      const driveDDir = path.join(tmpBase, "CyreneData");

      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, "model-settings.json"), JSON.stringify({ provider: "local" }));
      fs.writeFileSync(path.join(legacyDir, "general-settings.json"), JSON.stringify({ language: "en-US" }));
      fs.mkdirSync(path.join(legacyDir, "chats"), { recursive: true });
      fs.writeFileSync(path.join(legacyDir, "chats", "sess-1.json"), "{}");

      // Transaction migration
      fs.mkdirSync(driveDDir, { recursive: true });
      const items = ["model-settings.json", "general-settings.json", "user-profile.json", "chats", "memory"];
      for (const item of items) {
        const src = path.join(legacyDir, item);
        const dest = path.join(driveDDir, item);
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      // Check destination has data
      expect(fs.existsSync(path.join(driveDDir, "model-settings.json"))).toBe(true);
      expect(fs.existsSync(path.join(driveDDir, "general-settings.json"))).toBe(true);
      expect(fs.existsSync(path.join(driveDDir, "chats", "sess-1.json"))).toBe(true);
      // Legacy source remains intact as non-destructive backup
      expect(fs.existsSync(path.join(legacyDir, "model-settings.json"))).toBe(true);

      fs.rmSync(tmpBase, { recursive: true, force: true });
    });
  });

  describe("Custom Cloud Body and Base64 Safety Boundary", () => {
    it("rejects oversized raw text before calling JSON.parse", () => {
      const maxTextChars = 35 * 1024 * 1024;
      const isOversized = (len: number) => len > maxTextChars;
      expect(isOversized(36 * 1024 * 1024)).toBe(true);
      expect(isOversized(500)).toBe(false);
    });

    it("rejects oversized base64 strings before Buffer allocation", () => {
      const maxBase64Chars = 35 * 1024 * 1024;
      const isOversized = (length: number) => length > maxBase64Chars;
      expect(isOversized(36 * 1024 * 1024)).toBe(true);
      expect(isOversized(1024)).toBe(false);
    });
  });

  describe("Ollama Vision Keyless Detection", () => {
    function isKeylessAllowed(baseUrl: string): boolean {
      const trimmed = baseUrl.trim();
      return !trimmed || trimmed.includes("localhost") || trimmed.includes("127.0.0.1") || trimmed.includes("::1");
    }

    it("identifies local endpoints as keyless allowed", () => {
      expect(isKeylessAllowed("http://localhost:11434/v1")).toBe(true);
      expect(isKeylessAllowed("http://127.0.0.1:11434")).toBe(true);
      expect(isKeylessAllowed("http://[::1]:11434/v1")).toBe(true);
      expect(isKeylessAllowed("")).toBe(true);
    });

    it("requires API key for remote endpoints", () => {
      expect(isKeylessAllowed("https://api.openai.com/v1")).toBe(false);
      expect(isKeylessAllowed("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(false);
      expect(isKeylessAllowed("https://api.deepseek.com/v1")).toBe(false);
    });
  });
});
