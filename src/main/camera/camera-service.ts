import { EventEmitter } from "events";

export type CameraConsentMode = "ask" | "always_allow" | "off";

export interface CameraConfig {
  enabled: boolean;
  consentMode: CameraConsentMode;
  deviceId: string;
}

export interface CameraCaptureResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
  reason?: string;
}

export interface CameraServiceDeps {
  getConfig: () => CameraConfig;
  saveConfig: (patch: Partial<CameraConfig>) => void;
  requestFrameFromRenderer: (deviceId: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  promptUserConsent?: (details: { reason?: string }) => Promise<boolean>;
  pushLog?: (type: "user" | "reasoning" | "response" | "tool" | "error" | "system", text: string, meta?: unknown) => void;
}

export class CameraService extends EventEmitter {
  constructor(private readonly deps: CameraServiceDeps) {
    super();
  }

  public getConfig(): CameraConfig {
    return this.deps.getConfig();
  }

  public updateConfig(patch: Partial<CameraConfig>): CameraConfig {
    this.deps.saveConfig(patch);
    const updated = this.deps.getConfig();
    this.emit("config-changed", updated);
    return updated;
  }

  public async captureSnapshot(reason?: string): Promise<CameraCaptureResult> {
    const config = this.deps.getConfig();

    // 1. Check if camera is enabled
    if (!config.enabled) {
      this.deps.pushLog?.("tool", "[CameraService] Capture declined: Camera is disabled in Settings.");
      return {
        ok: false,
        error: "CAMERA_DISABLED",
        reason: "Camera vision is currently disabled in Settings. Please enable it in Settings (Alt+6) to allow visual observation.",
      };
    }

    // 2. Check consent mode
    if (config.consentMode === "off") {
      this.deps.pushLog?.("tool", "[CameraService] Capture declined: Consent mode is off.");
      return {
        ok: false,
        error: "CAMERA_CONSENT_OFF",
        reason: "Camera consent mode is turned off. Please adjust consent mode in Settings.",
      };
    }

    // 3. If consentMode === "ask", prompt user confirmation
    if (config.consentMode === "ask") {
      this.deps.pushLog?.("system", "[CameraService] Prompting user consent for camera snapshot...");
      let approved = false;
      if (this.deps.promptUserConsent) {
        try {
          approved = await this.deps.promptUserConsent({ reason });
        } catch (err) {
          console.warn("[CameraService] Consent prompt failed:", err);
          approved = false;
        }
      }

      if (!approved) {
        this.deps.pushLog?.("tool", "[CameraService] User declined camera access request.");
        return {
          ok: false,
          error: "CONSENT_DENIED",
          reason: "Camera access was declined by the user.",
        };
      }
    }

    // 4. Request frame from renderer
    this.deps.pushLog?.("tool", `[CameraService] Capturing frame from camera device: "${config.deviceId || "default"}"...`);
    try {
      const result = await this.deps.requestFrameFromRenderer(config.deviceId);
      if (!result.ok || !result.dataUrl) {
        this.deps.pushLog?.("error", `[CameraService] Frame capture failed: ${result.error ?? "No frame returned"}`);
        return {
          ok: false,
          error: result.error ?? "CAPTURE_FAILED",
          reason: "Failed to capture image frame from camera device.",
        };
      }

      this.deps.pushLog?.("tool", "[CameraService] Camera frame captured successfully and camera released.");
      return {
        ok: true,
        dataUrl: result.dataUrl,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.pushLog?.("error", `[CameraService] Capture exception: ${msg}`);
      return {
        ok: false,
        error: "CAPTURE_EXCEPTION",
        reason: msg,
      };
    }
  }
}
