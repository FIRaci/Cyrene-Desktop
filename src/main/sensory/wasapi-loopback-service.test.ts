import { describe, it, expect } from "vitest";
import {
  WasapiLoopbackService,
  computePcmRms,
} from "./wasapi-loopback-service";

describe("WasapiLoopbackService", () => {
  function createPcmSineWave(sampleCount: number, amplitude: number): Buffer {
    const buf = Buffer.alloc(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      const val = Math.sin((i / 10) * 2 * Math.PI) * amplitude * 32767;
      buf.writeInt16LE(Math.round(val), i * 2);
    }
    return buf;
  }

  it("defaults to disabled", () => {
    const service = new WasapiLoopbackService();
    expect(service.getConfig().enabled).toBe(false);
    service.start();
    const chunk = createPcmSineWave(1600, 0.5);
    expect(service.processAudioChunk(chunk)).toBeNull();
  });

  it("calculates RMS energy correctly", () => {
    const silence = Buffer.alloc(3200); // 1600 samples of zero
    expect(computePcmRms(silence)).toBe(0);

    const wave = createPcmSineWave(1600, 0.5); // Amplitude 0.5
    const rms = computePcmRms(wave);
    // Sine wave RMS = Amp / sqrt(2) = 0.5 / 1.414 ~= 0.353
    expect(rms).toBeGreaterThan(0.3);
    expect(rms).toBeLessThan(0.4);
  });

  it("echo suppression prevents capturing while Cyrene is vocalizing", () => {
    const service = new WasapiLoopbackService({ enabled: true });
    service.start();
    service.setCompanionSpeaking(true);

    const loudChunk = createPcmSineWave(1600, 0.6);
    const seg = service.processAudioChunk(loudChunk);
    expect(seg).toBeNull();
  });

  it("segments speech based on silence threshold", () => {
    let now = 1000;
    const service = new WasapiLoopbackService(
      { enabled: true, vadRmsThreshold: 0.05, silenceThresholdMs: 500 },
      () => now,
    );
    service.start();

    const voiceChunk = createPcmSineWave(1600, 0.4);
    const silenceChunk = Buffer.alloc(3200);

    // 1. Ingest 4 voice chunks (400ms)
    service.processAudioChunk(voiceChunk);
    now += 100;
    service.processAudioChunk(voiceChunk);
    now += 100;
    service.processAudioChunk(voiceChunk);
    now += 100;
    service.processAudioChunk(voiceChunk);
    now += 100;

    // 2. Short silence under threshold (200ms)
    service.processAudioChunk(silenceChunk);
    now += 200;

    // 3. Extended silence exceeding threshold (550ms)
    const segment = service.processAudioChunk(silenceChunk);
    now += 550;
    const finalSegment = service.processAudioChunk(silenceChunk);

    expect(finalSegment).not.toBeNull();
    expect(finalSegment?.durationMs).toBeGreaterThanOrEqual(400);
    expect(finalSegment?.pcmBuffer.length).toBeGreaterThan(0);
  });
});
