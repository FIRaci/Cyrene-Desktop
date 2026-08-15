import { describe, expect, it, vi } from "vitest";
import { ScreenConsentController } from "./screen-consent";

describe("ScreenConsentController", () => {
  it("supports an explicitly pre-granted trusted app session", () => {
    const controller = new ScreenConsentController({ mode: "session", sessionGranted: true });
    const result = controller.request("vision");
    expect(result.status).toBe("authorized");
    expect(controller.snapshot().sessionGranted).toBe(true);
  });
  it("denies in off mode and never reuses grants after revocation", () => {
    const controller = new ScreenConsentController({ mode: "off" });
    expect(controller.request("vision")).toEqual({ status: "denied", reason: "disabled" });

    controller.setMode("session");
    const pending = controller.request("vision");
    expect(pending.status).toBe("consent-required");
    if (pending.status !== "consent-required") throw new Error("expected consent request");
    const grant = controller.resolve(pending.requestId, "allow-session");
    expect(grant.status).toBe("authorized");
    if (grant.status !== "authorized") throw new Error("expected token");
    expect(controller.validate(grant.authorization, "vision")).toBe(true);

    controller.revoke();
    expect(controller.validate(grant.authorization, "vision")).toBe(false);
    expect(controller.snapshot()).toMatchObject({ generation: 2, activeCaptures: 0, sessionGranted: false });
  });

  it("makes ask-mode grants single-use and producer-bound", () => {
    const controller = new ScreenConsentController({ mode: "ask" });
    const pending = controller.request("hotkey");
    if (pending.status !== "consent-required") throw new Error("expected consent request");
    const grant = controller.resolve(pending.requestId, "allow-once");
    if (grant.status !== "authorized") throw new Error("expected token");

    expect(controller.beginCapture(grant.authorization, "game-bot")).toBeNull();
    const lease = controller.beginCapture(grant.authorization, "hotkey");
    expect(lease).not.toBeNull();
    expect(controller.beginCapture(grant.authorization, "hotkey")).toBeNull();
    expect(controller.snapshot().activeCaptures).toBe(1);
    lease?.release();
    expect(controller.snapshot().activeCaptures).toBe(0);
  });

  it("aborts in-flight captures immediately when revoked", () => {
    const controller = new ScreenConsentController({ mode: "ask" });
    const pending = controller.request("vision");
    if (pending.status !== "consent-required") throw new Error("expected consent request");
    const grant = controller.resolve(pending.requestId, "allow-once");
    if (grant.status !== "authorized") throw new Error("expected token");
    const lease = controller.beginCapture(grant.authorization, "vision");
    expect(lease?.signal.aborted).toBe(false);
    controller.revoke();
    expect(lease?.signal.aborted).toBe(true);
  });

  it("expires pending requests, authorizations and session grants", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const controller = new ScreenConsentController({ mode: "session", authorizationTtlMs: 100, sessionTtlMs: 200 });
    const pending = controller.request("debug");
    if (pending.status !== "consent-required") throw new Error("expected consent request");
    const grant = controller.resolve(pending.requestId, "allow-session");
    if (grant.status !== "authorized") throw new Error("expected token");
    vi.setSystemTime(1_101);
    expect(controller.validate(grant.authorization, "debug")).toBe(false);
    vi.setSystemTime(1_201);
    expect(controller.request("debug").status).toBe("consent-required");
    vi.useRealTimers();
  });
});
