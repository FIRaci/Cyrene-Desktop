// Local Whisper ASR engine — wraps faster-whisper Python worker or cloud API fallback.
// Converts 16kHz 16-bit mono PCM audio frames from the Call window microphone into text.

import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { app } from "electron";

const LOG_PREFIX = "[LocalWhisperASR]";

/**
 * Converts raw 16kHz 16-bit mono PCM buffer to standard 44-byte WAV buffer.
 */
export function pcmToWav(pcmBuffer: Buffer, sampleRate = 16000, numChannels = 1, bitDepth = 16): Buffer {
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28); // ByteRate
  header.writeUInt16LE(numChannels * (bitDepth / 8), 32); // BlockAlign
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

/** Resolves candidate Python interpreter paths on the system (never pythonw, which lacks stdio). */
export function resolvePythonExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  const candidates = [
    localAppData ? path.join(localAppData, "Programs", "Python", "Python311", "python.exe") : "",
    "C:\\Users\\TSC\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
    process.platform === "win32" ? "python.exe" : "python3",
    process.platform === "win32" ? "python" : "python3",
    "python",
  ];
  for (const c of candidates) {
    if (c && (c.includes("\\") ? fs.existsSync(c) : true)) {
      return c;
    }
  }
  return "python";
}

/** Resolves the absolute path to scripts/cyrene_asr.py. */
export function resolveAsrScriptPath(): string | null {
  const base = typeof app !== "undefined" && app?.isPackaged
    ? process.resourcesPath
    : (typeof app !== "undefined" && app?.getAppPath ? app.getAppPath() : process.cwd());

  const candidates = [
    path.join(process.cwd(), "scripts", "cyrene_asr.py"),
    "D:\\Cyrene-Desktop\\scripts\\cyrene_asr.py",
    path.join(base, "scripts", "cyrene_asr.py"),
    path.join(base, "resources", "scripts", "cyrene_asr.py"),
    path.resolve(base, "..", "..", "scripts", "cyrene_asr.py"),
    path.join(__dirname, "..", "..", "..", "scripts", "cyrene_asr.py"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

export class LocalWhisperWorker {
  private child: ChildProcess | null = null;
  private ready = false;
  private startingPromise: Promise<boolean> | null = null;
  private pendingResolvers: Array<(res: { text: string; language?: string } | null) => void> = [];
  private stdoutBuffer = "";

  /** Spawns the python cyrene_asr.py process if not already running. */
  async ensureReady(): Promise<boolean> {
    if (this.ready && this.child && !this.child.killed) {
      return true;
    }
    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = new Promise<boolean>((resolve) => {
      const scriptPath = resolveAsrScriptPath();
      if (!scriptPath) {
        console.warn(LOG_PREFIX, "scripts/cyrene_asr.py not found on disk");
        resolve(false);
        return;
      }

      const pythonExe = resolvePythonExecutable();
      const cwd = path.dirname(path.dirname(scriptPath));

      console.info(LOG_PREFIX, `Starting Faster-Whisper ASR worker via ${pythonExe} at ${scriptPath}`);

      try {
        const child = spawn(pythonExe, [scriptPath], {
          cwd,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
            PYTHONUNBUFFERED: "1",
            HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
          },
        });

        this.child = child;

        // Catch and safely ignore pipe errors on child.stdin (e.g. write EPIPE or ERR_STREAM_DESTROYED when worker shuts down)
        child.stdin?.on("error", (err: unknown) => {
          const code = (err as { code?: string })?.code;
          if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") {
            return;
          }
          console.warn(LOG_PREFIX, "Worker stdin pipe warning:", err instanceof Error ? err.message : String(err));
        });

        child.stdout?.setEncoding("utf-8");
        child.stdout?.on("data", (chunk: string) => {
          this.stdoutBuffer += chunk;
          const lines = this.stdoutBuffer.split("\n");
          this.stdoutBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed);
              if (data.status === "ready") {
                this.ready = true;
                console.info(LOG_PREFIX, `ASR worker ready with model: ${data.model}`);
                resolve(true);
              } else if (this.pendingResolvers.length > 0) {
                const resolver = this.pendingResolvers.shift();
                if (resolver) {
                  if (data.status === "ok") {
                    resolver({ text: data.text || "", language: data.language });
                  } else {
                    console.warn(LOG_PREFIX, "ASR error response:", data.error);
                    resolver(null);
                  }
                }
              }
            } catch (jsonErr) {
              console.warn(LOG_PREFIX, "Invalid JSON from ASR worker:", trimmed);
            }
          }
        });

        child.stderr?.setEncoding("utf-8");
        child.stderr?.on("data", (data: string) => {
          console.log(LOG_PREFIX, data.trim());
        });

        child.on("error", (err) => {
          console.warn(LOG_PREFIX, "Worker process error:", err);
          this.ready = false;
          this.child = null;
          resolve(false);
        });

        child.on("exit", (code) => {
          console.info(LOG_PREFIX, `Worker exited with code ${code}`);
          this.ready = false;
          this.child = null;
          // Drain any pending resolvers
          while (this.pendingResolvers.length > 0) {
            this.pendingResolvers.shift()?.(null);
          }
        });

        // Timeout fallback after 15s
        setTimeout(() => {
          if (!this.ready) {
            console.warn(LOG_PREFIX, "ASR worker startup timed out");
            resolve(false);
          }
        }, 15000);

      } catch (spawnErr) {
        console.error(LOG_PREFIX, "Failed to spawn ASR worker:", spawnErr);
        resolve(false);
      }
    }).finally(() => {
      this.startingPromise = null;
    });

    return this.startingPromise;
  }

  /**
   * Transcribes a WAV buffer using the running Faster-Whisper worker.
   */
  async transcribeWav(wavBuffer: Buffer, language?: string): Promise<{ text: string; language?: string } | null> {
    const isReady = await this.ensureReady();
    if (!isReady || !this.child || !this.child.stdin || this.child.killed) {
      console.warn(LOG_PREFIX, "Worker is not available for transcription");
      return null;
    }

    // Write to a temporary WAV file for instant C++ file-based transcription,
    // avoiding large base64 pipe serialization and buffer deadlocks
    let tempPath: string | null = null;
    try {
      tempPath = path.join(os.tmpdir(), `cyrene_asr_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
      await fs.promises.writeFile(tempPath, wavBuffer);
    } catch (writeErr) {
      console.warn(LOG_PREFIX, "Failed to write temp WAV file, falling back to base64:", writeErr);
      tempPath = null;
    }

    const payload = JSON.stringify({
      action: "transcribe",
      ...(tempPath ? { path: tempPath } : { audioBase64: wavBuffer.toString("base64") }),
      language: language || undefined,
    });

    const currentTempPath = tempPath;
    const cleanupTemp = () => {
      if (currentTempPath) {
        fs.promises.unlink(currentTempPath).catch(() => {});
      }
    };

    return new Promise<{ text: string; language?: string } | null>((resolve) => {
      let resolved = false;

      const wrappedResolve = (res: { text: string; language?: string } | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        cleanupTemp();
        resolve(res);
      };

      const timer = setTimeout(() => {
        const idx = this.pendingResolvers.indexOf(wrappedResolve);
        if (idx !== -1) {
          this.pendingResolvers.splice(idx, 1);
        }
        cleanupTemp();
        console.warn(LOG_PREFIX, "Transcription timed out");
        wrappedResolve(null);
      }, 12000);

      this.pendingResolvers.push(wrappedResolve);

      try {
        if (!this.child || !this.child.stdin || this.child.stdin.destroyed || !this.child.stdin.writable || this.child.killed) {
          clearTimeout(timer);
          cleanupTemp();
          const idx = this.pendingResolvers.indexOf(wrappedResolve);
          if (idx !== -1) {
            this.pendingResolvers.splice(idx, 1);
          }
          wrappedResolve(null);
          return;
        }
        this.child.stdin.write(payload + "\n", (err) => {
          if (err) {
            console.warn(LOG_PREFIX, "Worker stdin write callback error:", err.message);
            clearTimeout(timer);
            cleanupTemp();
            const idx = this.pendingResolvers.indexOf(wrappedResolve);
            if (idx !== -1) {
              this.pendingResolvers.splice(idx, 1);
            }
            wrappedResolve(null);
          }
        });
      } catch (writeErr) {
        console.warn(LOG_PREFIX, "Failed to write to worker stdin:", writeErr);
        clearTimeout(timer);
        cleanupTemp();
        const idx = this.pendingResolvers.indexOf(wrappedResolve);
        if (idx !== -1) {
          this.pendingResolvers.splice(idx, 1);
        }
        wrappedResolve(null);
      }
    });
  }

  /** Stops the background worker safely. */
  stop(): void {
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.startingPromise = null;

    // Drain any pending resolvers immediately
    while (this.pendingResolvers.length > 0) {
      this.pendingResolvers.shift()?.(null);
    }

    if (child && !child.killed) {
      try {
        if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
          child.stdin.end(JSON.stringify({ action: "quit" }) + "\n");
        }
      } catch {}
      setTimeout(() => {
        try {
          if (!child.killed) {
            child.kill();
          }
        } catch {}
      }, 300);
    }
  }
}

/** Global singleton worker instance */
const globalWorker = new LocalWhisperWorker();

/**
 * Transcribes 16kHz 16-bit mono PCM buffer.
 * Tries local Faster-Whisper worker first; falls back to cloud Whisper if available.
 */
export async function transcribePcm(
  pcmBuffer: Buffer,
  language = "auto",
  cloudConfig?: { provider?: string; apiKey?: string; baseUrl?: string },
): Promise<string> {
  if (!pcmBuffer || pcmBuffer.length < 3200) {
    // Under 100ms: not enough speech audio
    return "";
  }

  const wav = pcmToWav(pcmBuffer, 16000, 1, 16);

  // 1. Try Local Faster-Whisper
  try {
    const localResult = await globalWorker.transcribeWav(wav, language);
    if (localResult && typeof localResult.text === "string" && localResult.text.trim().length > 0) {
      return localResult.text.trim();
    }
  } catch (localErr) {
    console.warn(LOG_PREFIX, "Local Whisper failed:", localErr);
  }

  // 2. Try Cloud Whisper (if OpenAI or Groq API key available)
  if (cloudConfig?.apiKey && (cloudConfig.provider === "openai" || cloudConfig.provider === "groq")) {
    try {
      const cloudText = await transcribeWithCloudWhisper(wav, {
        apiKey: cloudConfig.apiKey,
        baseUrl: cloudConfig.baseUrl,
        provider: cloudConfig.provider,
      });
      if (cloudText && cloudText.trim().length > 0) {
        return cloudText.trim();
      }
    } catch (cloudErr) {
      console.warn(LOG_PREFIX, "Cloud Whisper fallback failed:", cloudErr);
    }
  }

  return "";
}

/** Fallback to OpenAI / Groq audio transcription API endpoint if configured. */
async function transcribeWithCloudWhisper(
  wavBuffer: Buffer,
  config: { apiKey: string; baseUrl?: string; provider?: string },
): Promise<string | null> {
  const endpoint = config.provider === "groq"
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : (config.baseUrl ? `${config.baseUrl.replace(/\/+$/, "")}/audio/transcriptions` : "https://api.openai.com/v1/audio/transcriptions");

  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
  const crlf = "\r\n";

  const parts: Buffer[] = [];

  // model field
  parts.push(Buffer.from(
    `--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}${config.provider === "groq" ? "whisper-large-v3" : "whisper-1"}${crlf}`,
  ));

  // file field
  parts.push(Buffer.from(
    `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="audio.wav"${crlf}Content-Type: audio/wav${crlf}${crlf}`,
  ));
  parts.push(wavBuffer);
  parts.push(Buffer.from(crlf));

  // end boundary
  parts.push(Buffer.from(`--${boundary}--${crlf}`));

  const body = Buffer.concat(parts);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    console.warn(LOG_PREFIX, `Cloud Whisper failed with HTTP ${res.status}`);
    return null;
  }

  const json = await res.json() as { text?: string };
  return json.text || null;
}

export function startLocalAsr(): Promise<boolean> {
  return globalWorker.ensureReady();
}

export function stopLocalAsr(): void {
  globalWorker.stop();
}
