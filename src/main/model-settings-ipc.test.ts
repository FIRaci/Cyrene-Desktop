import { describe, expect, it } from "vitest";
import { applyModelSecretPatch, redactModelSettings } from "./model-settings-ipc";

const stored = {
  provider: "cloud",
  apiKey: "top-secret",
  perProvider: {
    cloud: { baseUrl: "https://api.test", model: "m", apiKey: "cloud-secret" },
    local: { baseUrl: "http://127.0.0.1:11434/v1", model: "q", apiKey: "" },
  },
  vision: { baseUrl: "https://vision.test", model: "v", apiKey: "vision-secret" },
};

describe("model settings IPC secret contract", () => {
  it("redacts top-level, provider and vision keys while exposing hasKey", () => {
    const dto = redactModelSettings(stored) as any;
    expect(dto.apiKey).toBe("");
    expect(dto.hasKey).toBe(true);
    expect(dto.perProvider.cloud).toMatchObject({ apiKey: "", hasKey: true });
    expect(dto.perProvider.local).toMatchObject({ apiKey: "", hasKey: false });
    expect(dto.vision).toMatchObject({ apiKey: "", hasKey: true });
    expect(JSON.stringify(dto)).not.toContain("secret");
  });

  it("retains secrets on blank redacted saves", () => {
    const patched = applyModelSecretPatch({
      provider: "cloud", apiKey: "", perProvider: { cloud: { apiKey: "", model: "m2" } }, vision: { apiKey: "", model: "v2" },
    }, stored) as any;
    expect(patched.apiKey).toBe("cloud-secret");
    expect(patched.perProvider.cloud.apiKey).toBe("cloud-secret");
    expect(patched.vision.apiKey).toBe("vision-secret");
  });

  it("replaces nonblank keys and clears only with an explicit flag", () => {
    expect((applyModelSecretPatch({ provider: "cloud", apiKey: "new" }, stored) as any).apiKey).toBe("new");
    expect((applyModelSecretPatch({ provider: "cloud", apiKey: "", clearApiKey: true }, stored) as any).apiKey).toBe("");
  });

  it("retains the selected provider key independently when switching profiles", () => {
    const patched = applyModelSecretPatch({
      provider: "local",
      apiKey: "",
      perProvider: {
        cloud: { apiKey: "", model: "cloud-next" },
        local: { apiKey: "", model: "local-next" },
      },
    }, stored) as any;
    expect(patched.apiKey).toBe("");
    expect(patched.perProvider.cloud.apiKey).toBe("cloud-secret");
    expect(patched.perProvider.local.apiKey).toBe("");
  });

  it("clears vision independently without changing the main provider key", () => {
    const patched = applyModelSecretPatch({
      provider: "cloud",
      apiKey: "",
      vision: { apiKey: "", clearApiKey: true },
    }, stored) as any;
    expect(patched.apiKey).toBe("cloud-secret");
    expect(patched.vision.apiKey).toBe("");
    expect(patched.vision).not.toHaveProperty("clearApiKey");
  });
});
