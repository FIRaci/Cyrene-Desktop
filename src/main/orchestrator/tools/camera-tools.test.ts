import { describe, it, expect, vi } from "vitest";
import { buildCameraTools } from "./camera-tools";
import { CameraService } from "../../camera/camera-service";

describe("camera-tools", () => {
  function makeSetup(serviceResult: { ok: boolean; dataUrl?: string; reason?: string; error?: string }, fetchResponse?: any) {
    const cameraService = {
      captureSnapshot: vi.fn(async () => serviceResult),
    } as unknown as CameraService;

    const loadModelSettings = vi.fn(() => ({
      provider: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-test-key",
    }));

    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => fetchResponse ?? {
        choices: [
          {
            message: {
              content: "I can see you sitting at your desk wearing a blue shirt!",
            },
          },
        ],
      },
    })) as unknown as typeof fetch;

    const tools = buildCameraTools({
      cameraService,
      loadModelSettings,
      fetchFn,
    });

    return { tool: tools[0], cameraService, loadModelSettings, fetchFn };
  }

  it("returns message when camera is disabled or capture fails", async () => {
    const { tool } = makeSetup({
      ok: false,
      error: "CAMERA_DISABLED",
      reason: "Camera vision is currently disabled in Settings.",
    });

    const output = await tool.execute({ prompt: "look at me" });
    expect(output).toContain("[Camera Observation Unavailable]");
    expect(output).toContain("Camera vision is currently disabled in Settings.");
  });

  it("returns message when user declines camera consent", async () => {
    const { tool } = makeSetup({
      ok: false,
      error: "CONSENT_DENIED",
      reason: "Camera access was declined by the user.",
    });

    const output = await tool.execute({});
    expect(output).toContain("[Camera Observation Unavailable]");
    expect(output).toContain("declined by the user");
  });

  it("calls VLM and returns description when capture succeeds", async () => {
    const { tool, cameraService, fetchFn } = makeSetup({
      ok: true,
      dataUrl: "data:image/jpeg;base64,mockframe",
    });

    const output = await tool.execute({ prompt: "What am I holding?" });
    expect(cameraService.captureSnapshot).toHaveBeenCalledWith("What am I holding?");
    expect(fetchFn).toHaveBeenCalled();
    expect(output).toBe("I can see you sitting at your desk wearing a blue shirt!");
  });
});
