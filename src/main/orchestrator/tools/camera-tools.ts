import type { ToolDefinition } from "../tool-registry";
import { CameraService } from "../../camera/camera-service";
import { getAdapterForConfig, type VendorConfig, type ChatMessage } from "../vendors";

export interface CameraToolsDeps {
  cameraService: CameraService;
  loadModelSettings: () => VendorConfig;
  loadVisionConfig?: () => { baseUrl: string; apiKey: string; model: string } | null;
  fetchFn?: typeof fetch;
}

const CAMERA_OBSERVE_PROMPT = `You are Cyrene, an adorable anime desktop companion looking at Master through the camera.
You are glancing at what is visible in front of the webcam right now.

CRITICAL RULES:
1. STRICT REAL-WORLD GROUNDING:
   - Accurately describe what is actually visible in front of the camera (the person, their clothing, an item they are holding, facial expression, room background).
   - If you see a specific object (phone, book, bottle, mug, pet), identify it naturally.
   - Do not hallucinate things not present in the image.
2. SWEET & DIRECT: Speak in 1 to 2 warm, natural sentences as Cyrene. No robotic disclaimers.
3. NO EMOJIS: Do not use emoji icons.
4. NO ASTERISKS: Do not include roleplay tags like *smiles* or *looks closely*.`;

export function buildCameraTools(deps: CameraToolsDeps): ToolDefinition[] {
  const lookAtMasterTool: ToolDefinition = {
    id: "look_at_master",
    name: "Camera Vision (Look at Master)",
    description:
      "Look through the camera to observe the user (Master), inspect what they are holding, or view an object in front of the webcam.\n\n" +
      "Use when the user asks you to look at them, comment on their appearance, check what they are showing you, or identify something in front of the camera (e.g. 'look at me', 'can you see what I am holding?', 'check what I am showing you').\n\n" +
      "Parameters:\n" +
      "- prompt (optional): Specific aspect or question the user asked about the scene (e.g., 'identify the held object', 'how do I look today?').",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Optional instruction or question from the user about what to observe in front of the camera.",
        },
      },
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const userPrompt = typeof args.prompt === "string" && args.prompt.trim()
        ? args.prompt.trim()
        : "Look at what is in front of the camera and describe it to Master.";

      // 1. Capture snapshot via CameraService (handles settings check + user consent)
      const captureResult = await deps.cameraService.captureSnapshot(userPrompt);
      if (!captureResult.ok || !captureResult.dataUrl) {
        return `[Camera Observation Unavailable] ${captureResult.reason || captureResult.error || "Could not access camera."}`;
      }

      // 2. Resolve target VLM configuration
      const visionConfig = deps.loadVisionConfig?.();
      const primarySettings = deps.loadModelSettings();

      const targetConfig: VendorConfig = visionConfig && visionConfig.apiKey
        ? {
            provider: "OpenAI",
            baseUrl: visionConfig.baseUrl,
            model: visionConfig.model,
            apiKey: visionConfig.apiKey,
          }
        : primarySettings;

      if (!targetConfig.apiKey && targetConfig.provider !== "ollama") {
        return "[Camera Vision Error] No Vision AI API key configured to analyze the image.";
      }

      // 3. Build VLM vision request
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: CAMERA_OBSERVE_PROMPT,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: captureResult.dataUrl } },
          ],
        },
      ];

      const adapter = getAdapterForConfig(targetConfig);
      const request = adapter.buildRequest(
        {
          model: targetConfig.model,
          messages,
          stream: false,
          maxTokens: 120,
        },
        targetConfig,
      );

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 20_000);

      try {
        const fetcher = deps.fetchFn ?? fetch;
        const res = await fetcher(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();
        const parsed = adapter.parseResponse(json);
        const description = parsed.text?.trim();

        if (!description) {
          return "I took a look through the camera, but could not make out the scene clearly.";
        }

        return description;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[Camera Vision Error] Failed to analyze camera frame: ${msg}`;
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
  };

  return [lookAtMasterTool];
}
