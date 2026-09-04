export interface RvcConvertOptions {
  audio: Buffer;
  baseUrl: string;
  modelName: string;
  pitch?: number;
  indexRate?: number;
  f0Method?: "rmvpe" | "pm" | "harvest" | "crepe";
  timeoutMs?: number;
}

export interface RvcConvertResult {
  audio: Buffer;
  converted: boolean;
  format: "wav";
}

/**
 * Sends audio to a local RVC (Retrieval-based Voice Conversion) v2 server.
 * If the server is offline or errors, gracefully returns the original audio.
 */
export async function convertVoiceWithRvc(
  options: RvcConvertOptions,
): Promise<RvcConvertResult> {
  const {
    audio,
    baseUrl,
    modelName,
    pitch = 0,
    indexRate = 0.75,
    f0Method = "rmvpe",
    timeoutMs = 15000,
  } = options;

  if (!audio || audio.length === 0) {
    return { audio: Buffer.alloc(0), converted: false, format: "wav" };
  }

  const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!cleanBaseUrl || !modelName.trim()) {
    return { audio, converted: false, format: "wav" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = cleanBaseUrl.endsWith("/convert")
      ? cleanBaseUrl
      : `${cleanBaseUrl}/voice2voice`;

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio: audio.toString("base64"),
        model_name: modelName.trim(),
        pitch,
        index_rate: indexRate,
        f0_method: f0Method,
      }),
    });

    if (!response.ok) {
      console.warn(
        `[RVC] Voice conversion returned HTTP ${response.status}; using baseline audio.`,
      );
      return { audio, converted: false, format: "wav" };
    }

    const contentType = response.headers.get("content-type") || "";
    let convertedBuffer: Buffer;

    if (contentType.includes("application/json")) {
      const json = (await response.json()) as { audio?: string; base64?: string };
      const rawBase64 = json.audio || json.base64 || "";
      convertedBuffer = rawBase64 ? Buffer.from(rawBase64, "base64") : audio;
    } else {
      const arrayBuffer = await response.arrayBuffer();
      convertedBuffer = Buffer.from(arrayBuffer);
    }

    if (convertedBuffer.length === 0) {
      return { audio, converted: false, format: "wav" };
    }

    return { audio: convertedBuffer, converted: true, format: "wav" };
  } catch (err) {
    console.warn(
      "[RVC] Voice conversion failed; falling back to baseline audio:",
      err instanceof Error ? err.message : String(err),
    );
    return { audio, converted: false, format: "wav" };
  } finally {
    clearTimeout(timer);
  }
}

/** Quick health check for RVC local server. */
export async function isRvcServerReachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  if (!clean) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${clean}/ping`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
