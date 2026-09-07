import { describe, it, expect } from "vitest";
import { pcmToWav, resolvePythonExecutable, resolveAsrScriptPath } from "./local-whisper-engine";

describe("local-whisper-engine", () => {
  it("converts 16kHz 16-bit mono PCM into valid 44-byte WAV header format", () => {
    // 320 samples = 640 bytes
    const pcm = Buffer.alloc(640);
    const wav = pcmToWav(pcm, 16000, 1, 16);

    expect(wav.length).toBe(640 + 44);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 640);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // Subchunk1Size
    expect(wav.readUInt16LE(20)).toBe(1);  // PCM format
    expect(wav.readUInt16LE(22)).toBe(1);  // mono
    expect(wav.readUInt32LE(24)).toBe(16000); // 16kHz sample rate
    expect(wav.readUInt32LE(28)).toBe(32000); // Byte rate (16000 * 1 * 2)
    expect(wav.readUInt16LE(32)).toBe(2);     // Block align
    expect(wav.readUInt16LE(34)).toBe(16);    // Bits per sample
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(640);
  });

  it("resolves python executable path without pythonw", () => {
    const pythonExe = resolvePythonExecutable();
    expect(typeof pythonExe).toBe("string");
    expect(pythonExe.length).toBeGreaterThan(0);
    expect(pythonExe.toLowerCase()).not.toContain("pythonw");
  });

  it("resolves cyrene_asr.py script path if on disk", () => {
    const scriptPath = resolveAsrScriptPath();
    expect(typeof scriptPath).toBe("string");
    expect(scriptPath).toContain("cyrene_asr.py");
  });

  it("spawns LocalWhisperWorker and successfully connects to cyrene_asr.py", async () => {
    const { LocalWhisperWorker, pcmToWav } = await import("./local-whisper-engine");
    const worker = new LocalWhisperWorker();
    try {
      const ready = await worker.ensureReady();
      expect(ready).toBe(true);

      const pcm = Buffer.alloc(32000); // 1 sec of silence
      const wav = pcmToWav(pcm, 16000, 1, 16);
      const res = await worker.transcribeWav(wav);
      expect(res).toBeDefined();
      expect(typeof res?.text).toBe("string");
    } finally {
      worker.stop();
    }
  }, 20000);
});
