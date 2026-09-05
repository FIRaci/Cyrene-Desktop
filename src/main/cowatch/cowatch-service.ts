import fs from "node:fs";
import { getAdapterForConfig, type VendorConfig, type ChatMessage } from "../orchestrator/vendors";

export type CoWatchStatus = "idle" | "capturing" | "analyzing" | "reacting" | "error";

export interface CoWatchState {
  active: boolean;
  status: CoWatchStatus;
  lastCapturedAt?: number;
  lastReaction?: string;
  errorMessage?: string;
}

export interface CoWatchCaptureResult {
  filePath: string;
  mime: string;
  previewUrl?: string;
}

export interface CoWatchServiceDeps {
  captureScreen: () => Promise<CoWatchCaptureResult | null>;
  loadModelSettings: () => VendorConfig;
  loadVisionConfig?: () => { baseUrl: string; apiKey: string; model: string } | null;
  broadcastState: (state: CoWatchState) => void;
  deliverReaction: (text: string) => void;
  pushLog?: (type: "user" | "reasoning" | "response" | "tool" | "error" | "system", text: string, meta?: unknown) => void;
  readFileAsync?: (filePath: string) => Promise<Buffer>;
  fetchFn?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  speechCooldownMs?: number;
}

export const DEFAULT_COWATCH_INTERVAL_MS = 35_000;
export const DEFAULT_COWATCH_TIMEOUT_MS = 15_000;

export const COWATCH_SYSTEM_PROMPT = `You are Cyrene, an adorable anime desktop pet companion sitting on the user's screen.
You are glancing at what the user is ACTUALLY doing on their computer right now.

CRITICAL RULES:
1. STRICT REAL-WORLD GROUNDING:
   - Only comment on what is visibly on their screen right now.
   - If they are coding or using developer tools (e.g. Antigravity IDE, VS Code, terminal, editor), give a quick sweet cheer (e.g. "Đang chăm chỉ code Antigravity nè, cố lên nha! ✨" or "Tập trung cao độ luôn ta ơi!").
   - If they are browsing or watching a real video, comment briefly on that topic.
   - If you do NOT see anime/cartoon characters on screen, NEVER invent or hallucinate fictional characters, hero/heroine, celestial kingdom, or fantasy plots!
2. SUPER CONCISE: EXACTLY 1 SHORT SENTENCE (strictly under 15 words). No yapping. No multiple sentences.
3. NO ROLEPLAY TAGS: Absolutely NO asterisks (*smiles*, *excitedly*), NO tone markers, and NO calling the user "Master" mechanically. Speak sweetly and naturally.
4. LANGUAGE: Speak in natural Vietnamese (or English if screen content is in English).
5. SILENCE WHEN BORING: If the screen is just an empty desktop or unchanged from before, reply with exactly: SILENT`;

export function cleanCoWatchReaction(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "SILENT" || trimmed.toUpperCase().includes("SILENT")) {
    return null;
  }
  // Strip asterisks *action*
  let cleaned = trimmed.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
  // Strip leading roleplay prefix like "Cyrene:" or "excitedly"
  cleaned = cleaned.replace(/^(Cyrene\s*:\s*|excitedly\s*|intrigued\s*|\*sm\s*)/i, "");
  // Limit to first sentence if multiple sentences were generated
  const firstSentenceMatch = cleaned.match(/^([^\.\?!]+[\.\?!]?)/);
  if (firstSentenceMatch && firstSentenceMatch[1] && firstSentenceMatch[1].length > 4) {
    cleaned = firstSentenceMatch[1].trim();
  }
  return cleaned.length >= 3 ? cleaned : null;
}

export class CoWatchService {
  private active = false;
  private status: CoWatchStatus = "idle";
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private lastCapturedAt?: number;
  private lastReaction?: string;
  private errorMessage?: string;

  constructor(private readonly deps: CoWatchServiceDeps) {}

  public isActive(): boolean {
    return this.active;
  }

  public getState(): CoWatchState {
    return {
      active: this.active,
      status: this.status,
      lastCapturedAt: this.lastCapturedAt,
      lastReaction: this.lastReaction,
      errorMessage: this.errorMessage,
    };
  }

  public async start(): Promise<CoWatchState> {
    if (this.active) return this.getState();

    this.active = true;
    this.status = "idle";
    this.errorMessage = undefined;

    this.deps.pushLog?.("system", "🎬 Co-Watch companion mode started. Cyrene is watching with you!");
    this.broadcast();

    // Trigger immediate initial observation
    void this.tick();

    // Setup recurring loop
    const interval = this.deps.intervalMs ?? DEFAULT_COWATCH_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);

    return this.getState();
  }

  public stop(): CoWatchState {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.status = "idle";
    this.isProcessing = false;

    this.deps.pushLog?.("system", "🎬 Co-Watch companion mode stopped.");
    this.broadcast();

    return this.getState();
  }

  public toggle(): CoWatchState {
    if (this.active) {
      return this.stop();
    }
    void this.start();
    return this.getState();
  }

  private currentTickPromise: Promise<void> | null = null;

  public async tick(): Promise<void> {
    if (!this.active) return;
    if (this.isProcessing && this.currentTickPromise) {
      return this.currentTickPromise;
    }

    this.isProcessing = true;
    this.currentTickPromise = (async () => {
      try {
        // 1. Capturing screen
        this.status = "capturing";
        this.broadcast();
        this.deps.pushLog?.("tool", "[Co-Watch] Capturing primary screen frame...");

        const capture = await this.deps.captureScreen();
        if (!capture?.filePath || !this.active) {
          this.status = "idle";
          this.broadcast();
          return;
        }

        this.lastCapturedAt = Date.now();

        // 2. Analyzing screen
        this.status = "analyzing";
        this.broadcast();

        const readFile = this.deps.readFileAsync ?? fs.promises.readFile;
        const buffer = await readFile(capture.filePath);
        const base64 = buffer.toString("base64");
        const dataUrl = `data:${capture.mime};base64,${base64}`;
        const rawReaction = await this.analyzeFrame(dataUrl);

        if (!this.active) return;

        // 3. Reacting
        const reaction = cleanCoWatchReaction(rawReaction ?? "");
        if (reaction) {
          this.status = "reacting";
          this.lastReaction = reaction;
          this.broadcast();

          this.deps.deliverReaction(this.lastReaction);
          this.deps.pushLog?.("response", `[Co-Watch] Cyrene: "${this.lastReaction}"`, {
            scene: "cowatch",
            capturedAt: this.lastCapturedAt,
          });

          // Hold reacting status and give speech synthesis time to complete without interruption
          const cooldown = this.deps.speechCooldownMs ?? 4_000;
          if (cooldown > 0) {
            await new Promise((resolve) => setTimeout(resolve, cooldown));
          }
        }

        this.status = "idle";
        this.errorMessage = undefined;
        this.broadcast();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errorMessage = msg;
        this.status = "error";
        this.deps.pushLog?.("error", `⚠️ [Co-Watch] Frame observation failed: ${msg}`);
        this.broadcast();
      } finally {
        this.isProcessing = false;
        this.currentTickPromise = null;
      }
    })();

    return this.currentTickPromise;
  }

  private async analyzeFrame(dataUrl: string): Promise<string | null> {
    const visionConfig = this.deps.loadVisionConfig?.();
    const primarySettings = this.deps.loadModelSettings();

    // Prioritize dedicated vision config if available; otherwise use primary model settings
    const targetConfig: VendorConfig = visionConfig && visionConfig.apiKey
      ? {
          provider: "OpenAI",
          baseUrl: visionConfig.baseUrl,
          model: visionConfig.model,
          apiKey: visionConfig.apiKey,
        }
      : primarySettings;

    if (!targetConfig.apiKey && targetConfig.provider !== "ollama") {
      this.deps.pushLog?.("system", "⚠️ [Co-Watch] No API key configured. Cannot analyze vision frame.");
      return null;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: COWATCH_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Look at my screen right now and react naturally as my companion!" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    const adapter = getAdapterForConfig(targetConfig);
    const request = adapter.buildRequest(
      {
        model: targetConfig.model,
        messages,
        stream: false,
        maxTokens: 50,
      },
      targetConfig,
    );

    const controller = new AbortController();
    const timeout = this.deps.timeoutMs ?? DEFAULT_COWATCH_TIMEOUT_MS;
    const timeoutTimer = setTimeout(() => controller.abort(), timeout);

    try {
      const fetcher = this.deps.fetchFn ?? fetch;
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
      return parsed.text?.trim() ?? null;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private broadcast(): void {
    this.deps.broadcastState(this.getState());
  }

  public dispose(): void {
    this.stop();
  }
}
