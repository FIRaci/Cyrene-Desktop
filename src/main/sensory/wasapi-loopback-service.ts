export interface WasapiLoopbackConfig {
  enabled: boolean;
  sampleRate: number; // default 16000
  channels: number; // default 1 (mono)
  vadRmsThreshold: number; // default 0.015
  silenceThresholdMs: number; // default 800ms to end a phrase
  maxSegmentMs: number; // default 12000ms max per segment
}

export interface SpeechSegment {
  id: string;
  durationMs: number;
  rms: number;
  timestamp: number;
  pcmBuffer: Buffer;
}

const DEFAULT_CONFIG: WasapiLoopbackConfig = {
  enabled: true,
  sampleRate: 16000,
  channels: 1,
  vadRmsThreshold: 0.015,
  silenceThresholdMs: 800,
  maxSegmentMs: 12000,
};

/**
 * Calculates the Root Mean Square (RMS) energy of a 16-bit PCM buffer (range 0.0 to 1.0).
 */
export function computePcmRms(pcmBuffer: Buffer): number {
  if (pcmBuffer.length < 2) return 0;
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  let sumSquare = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2) / 32768.0;
    sumSquare += sample * sample;
  }

  return Math.sqrt(sumSquare / sampleCount);
}

export class WasapiLoopbackService {
  private config: WasapiLoopbackConfig;
  private isCapturing = false;
  private isCompanionSpeaking = false; // Echo suppression flag
  private accumulatedBuffers: Buffer[] = [];
  private speechStartAt = 0;
  private lastSpeechAt = 0;
  private onSpeechSegmentCb: ((segment: SpeechSegment) => void) | null = null;
  private nowFn: () => number;

  constructor(config?: Partial<WasapiLoopbackConfig>, nowFn?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    this.nowFn = nowFn || (() => Date.now());
  }

  public getConfig(): WasapiLoopbackConfig {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<WasapiLoopbackConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public setCompanionSpeaking(speaking: boolean): void {
    this.isCompanionSpeaking = speaking;
    if (speaking) {
      // Clear ongoing segment to avoid recording Cyrene's own voice
      this.accumulatedBuffers = [];
      this.speechStartAt = 0;
    }
  }

  public isSpeakingActive(): boolean {
    return this.isCompanionSpeaking;
  }

  public start(): void {
    this.isCapturing = true;
    this.accumulatedBuffers = [];
  }

  public stop(): void {
    this.isCapturing = false;
    this.accumulatedBuffers = [];
  }

  public onSpeechSegment(cb: (segment: SpeechSegment) => void): void {
    this.onSpeechSegmentCb = cb;
  }

  /**
   * Ingests a raw 16kHz 16-bit mono PCM audio chunk from loopback capture stream.
   * Performs VAD, echo suppression, and speech segmentation.
   */
  public processAudioChunk(chunk: Buffer): SpeechSegment | null {
    if (!this.config.enabled || !this.isCapturing) return null;
    // Acoustic Echo Suppression: skip when Cyrene is vocalizing
    if (this.isCompanionSpeaking) return null;

    const rms = computePcmRms(chunk);
    const now = this.nowFn();
    const isVoice = rms >= this.config.vadRmsThreshold;

    if (isVoice) {
      if (this.accumulatedBuffers.length === 0) {
        this.speechStartAt = now;
      }
      this.lastSpeechAt = now;
      this.accumulatedBuffers.push(chunk);

      // Check max segment limit
      if (now - this.speechStartAt >= this.config.maxSegmentMs) {
        return this.flushSegment(rms);
      }
    } else if (this.accumulatedBuffers.length > 0) {
      // Silence detected after speech
      if (now - this.lastSpeechAt >= this.config.silenceThresholdMs) {
        return this.flushSegment(rms);
      } else {
        // Keep buffering short silence within a sentence
        this.accumulatedBuffers.push(chunk);
      }
    }

    return null;
  }

  private flushSegment(finalRms: number): SpeechSegment | null {
    if (this.accumulatedBuffers.length === 0) return null;

    const fullBuffer = Buffer.concat(this.accumulatedBuffers);
    const durationMs = this.nowFn() - this.speechStartAt;

    this.accumulatedBuffers = [];
    this.speechStartAt = 0;

    // Filter out micro-clicks under 300ms
    if (durationMs < 300) return null;

    const segment: SpeechSegment = {
      id: `loopback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      durationMs,
      rms: finalRms,
      timestamp: this.nowFn(),
      pcmBuffer: fullBuffer,
    };

    if (this.onSpeechSegmentCb) {
      try {
        this.onSpeechSegmentCb(segment);
      } catch (err) {
        console.warn("[WasapiLoopbackService] Callback error:", err);
      }
    }

    return segment;
  }
}

let loopbackServiceInstance: WasapiLoopbackService | null = null;

export function getWasapiLoopbackService(): WasapiLoopbackService {
  if (!loopbackServiceInstance) {
    loopbackServiceInstance = new WasapiLoopbackService();
  }
  return loopbackServiceInstance;
}
