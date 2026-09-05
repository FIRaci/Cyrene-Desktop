import { describe, expect, test } from "vitest";
import { authHeaderFor } from "./auth";
import type { ProviderCapability } from "./types";

const baseCap: ProviderCapability = {
  id: "test",
  displayName: "Test Provider",
  transport: "openai",
  baseUrl: "https://e.test/v1",
  authStyle: "bearer",
  defaultModel: "m",
  supportsTools: true,
  supportsThinking: false,
  thinkingField: null,
  cacheStrategy: "none",
  testStrategy: "text",
  supportsVision: false,
};

describe("authHeaderFor", () => {
  test("omits authentication for a no-auth local endpoint", () => {
    expect(authHeaderFor(baseCap, "")).toEqual({});
  });

  test("authStyle=bearer → Authorization Bearer", () => {
    const h = authHeaderFor({ ...baseCap, authStyle: "bearer" }, "sk-test");
    expect(h).toEqual({ Authorization: "Bearer sk-test" });
  });

  test("authStyle=x-api-key → x-api-key", () => {
    const h = authHeaderFor({ ...baseCap, authStyle: "x-api-key" }, "sk-test");
    expect(h).toEqual({ "x-api-key": "sk-test" });
  });

  test("output object does not expose sensitive strings other than apiKey", () => {
    const h = authHeaderFor({ ...baseCap, authStyle: "bearer" }, "sk-very-secret-123");
    // Serialized output must only contain apiKey, with no other secret fields
    const s = JSON.stringify(h);
    expect(s).toContain("sk-very-secret-123");
    expect(s).not.toContain("password");
    expect(s).not.toContain("token=");
  });

  test("invalid authStyle throws error (includes displayName, excludes apiKey)", () => {
    expect(() =>
      authHeaderFor({ ...baseCap, displayName: "MiMo", authStyle: undefined as unknown as "bearer" }, "sk-very-secret"),
    ).toThrow(/MiMo/);
    expect(() =>
      authHeaderFor({ ...baseCap, authStyle: "weird" as unknown as "bearer" }, "sk-very-secret"),
    ).toThrow(/invalid authStyle/);
    // Error message must not contain apiKey literal
    try {
      authHeaderFor({ ...baseCap, authStyle: undefined as unknown as "bearer" }, "sk-very-secret");
    } catch (e) {
      expect((e as Error).message).not.toContain("sk-very-secret");
    }
  });
});
