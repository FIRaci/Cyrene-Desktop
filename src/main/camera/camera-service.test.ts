import { describe, it, expect, vi } from "vitest";
import { CameraService, type CameraConfig } from "./camera-service";

describe("CameraService", () => {
  function makeService(initialConfig?: Partial<CameraConfig>, overrides?: Partial<any>) {
    let config: CameraConfig = {
      enabled: false,
      consentMode: "ask",
      deviceId: "",
      ...initialConfig,
    };

    const deps = {
      getConfig: vi.fn(() => config),
      saveConfig: vi.fn((patch: Partial<CameraConfig>) => {
        config = { ...config, ...patch };
      }),
      requestFrameFromRenderer: vi.fn(async () => ({ ok: true, dataUrl: "data:image/jpeg;base64,sampleframe" })),
      promptUserConsent: vi.fn(async () => true),
      pushLog: vi.fn(),
      ...overrides,
    };

    const service = new CameraService(deps);
    return { service, deps, getConfig: () => config };
  }

  it("returns error when camera is disabled", async () => {
    const { service, deps } = makeService({ enabled: false });
    const res = await service.captureSnapshot("test reason");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("CAMERA_DISABLED");
    expect(deps.requestFrameFromRenderer).not.toHaveBeenCalled();
  });

  it("returns error when consent mode is off", async () => {
    const { service, deps } = makeService({ enabled: true, consentMode: "off" });
    const res = await service.captureSnapshot();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("CAMERA_CONSENT_OFF");
    expect(deps.requestFrameFromRenderer).not.toHaveBeenCalled();
  });

  it("prompts user consent when consentMode is ask and stops if declined", async () => {
    const promptUserConsent = vi.fn(async () => false);
    const { service, deps } = makeService(
      { enabled: true, consentMode: "ask" },
      { promptUserConsent }
    );
    const res = await service.captureSnapshot("Inspect room");
    expect(promptUserConsent).toHaveBeenCalledWith({ reason: "Inspect room" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("CONSENT_DENIED");
    expect(deps.requestFrameFromRenderer).not.toHaveBeenCalled();
  });

  it("captures frame when consentMode is ask and user approves", async () => {
    const promptUserConsent = vi.fn(async () => true);
    const { service, deps } = makeService(
      { enabled: true, consentMode: "ask", deviceId: "cam_123" },
      { promptUserConsent }
    );
    const res = await service.captureSnapshot("Look at Master");
    expect(promptUserConsent).toHaveBeenCalled();
    expect(deps.requestFrameFromRenderer).toHaveBeenCalledWith("cam_123");
    expect(res.ok).toBe(true);
    expect(res.dataUrl).toBe("data:image/jpeg;base64,sampleframe");
  });

  it("skips consent prompt when consentMode is always_allow", async () => {
    const promptUserConsent = vi.fn(async () => false); // even if mock is false, should not be called
    const { service, deps } = makeService(
      { enabled: true, consentMode: "always_allow", deviceId: "cam_456" },
      { promptUserConsent }
    );
    const res = await service.captureSnapshot();
    expect(promptUserConsent).not.toHaveBeenCalled();
    expect(deps.requestFrameFromRenderer).toHaveBeenCalledWith("cam_456");
    expect(res.ok).toBe(true);
  });

  it("updates config and emits config-changed event", () => {
    const { service, deps } = makeService({ enabled: false });
    const listener = vi.fn();
    service.on("config-changed", listener);

    const updated = service.updateConfig({ enabled: true, deviceId: "cam_usb" });
    expect(deps.saveConfig).toHaveBeenCalledWith({ enabled: true, deviceId: "cam_usb" });
    expect(updated.enabled).toBe(true);
    expect(updated.deviceId).toBe("cam_usb");
    expect(listener).toHaveBeenCalledWith(updated);
  });
});
