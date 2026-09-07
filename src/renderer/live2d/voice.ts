/**
 * Cyrene Desktop Companion Voice Service
 *
 * Provides expressive speech synthesis for Live2D companion interactions
 * (petting, head patting, quick mini chat responses, speech bubbles).
 *
 * Supports Web Speech API (zero-config, offline, built into Windows/Electron)
 * as well as configured cloud/local engines (MiniMax, GPT-SoVITS, etc.) with
 * automatic Live2D mouth-sync integration.
 */

export interface CompanionVoiceOptions {
  onStartSpeaking?: (durationMs: number) => void;
  onStopSpeaking?: () => void;
  initialMuted?: boolean;
}

const STORAGE_KEY_MUTED = "cyrene-companion-voice-muted";

/**
 * Cleans text for speech synthesis so that decorative kaomojis, emojis,
 * and markdown symbols are omitted rather than spoken literally by TTS engines.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // Strip leading leaked timestamps e.g. [2026-09-07 10:04, UTC-5] or [2026-07-13 13:36, Asia/Shanghai]
  cleaned = cleaned.trimStart().replace(/^\s*(?:\[\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:,\s*[^\]]+)?\]\s*)+/, "").trimStart();

  // Strip code blocks and inline code
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`[^`]*`/g, "");

  // Strip markdown links [label](url) -> label
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip actions enclosed in asterisks *...*
  cleaned = cleaned.replace(/\*[^*]*\*/g, " ");

  // Strip thoughts enclosed in slashes /.../
  cleaned = cleaned.replace(/\/[^/]+\//g, " ");

  // Strip kaomojis with optional prefix/suffix appendages (e.g. (*•̀ᴗ•́*)و ̑̑, (｡♥‿♥｡), ٩(ˊᗜˋ*)و, (✿◠‿◠), (o^▽^o))
  cleaned = cleaned.replace(/(?:[٩۶つﾉシ]\s*)?[\(（][^)）]*[♥♡★☆✿♪♫•ᴗ‿◠^▽><~✧ω≧≦Дд｡⁄`´˙˚*]+[^)）]*[\)）](?:\s*[و̑✧つﾉシ\u0648\u0311~☆★]+)*/gu, " ");

  // Strip any remaining parentheses containing purely non-alphanumeric characters
  cleaned = cleaned.replace(/[\(（][^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+[\)）]/gu, " ");

  // Strip markdown formatting symbols: **, *, __, _, ~~, #, >, etc.
  cleaned = cleaned.replace(/[*_~#>]+/g, " ");

  // Strip decorative standalone symbols, kaomoji fragments, and common emojis
  cleaned = cleaned.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨🌸⭐🕶️❓🌀😄🥺😉😊🔄👁️❌♡♥~〜☆★♪♫و̑]/gu, " ");

  // Strip any remaining brackets and parentheses, leaving inner dialogue intact
  cleaned = cleaned.replace(/[\(\)（）\[\]]/g, " ");

  // Normalize whitespace and trim
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // If no spoken dialogue remains, return empty string
  if (!/[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9\u4e00-\u9fa5\u3040-\u30ff]/.test(cleaned)) {
    return "";
  }

  return cleaned;
}

export class CompanionVoiceService {
  private muted = false;
  private isSpeaking = false;
  private isSynthesizing = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private onStartSpeaking?: (durationMs: number) => void;
  private onStopSpeaking?: () => void;
  private disposed = false;
  private speechQueue: string[] = [];

  constructor(options: CompanionVoiceOptions = {}) {
    this.onStartSpeaking = options.onStartSpeaking;
    this.onStopSpeaking = options.onStopSpeaking;

    if (options.initialMuted !== undefined) {
      this.muted = options.initialMuted;
    } else {
      try {
        if (typeof localStorage !== "undefined") {
          this.muted = localStorage.getItem(STORAGE_KEY_MUTED) === "true";
        }
      } catch {
        this.muted = false;
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    if (muted) {
      this.stop();
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY_MUTED, String(muted));
      }
    } catch {}
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking || this.isSynthesizing;
  }

  /**
   * Speak the given text out loud in sweet Chinese anime voice (Cyrene) and coordinate Live2D mouth movements.
   * Cleans kaomoji/emojis, strips actions/thoughts, and speaks in Chinese dialogue.
   */
  async speak(text: string, options?: { queue?: boolean }): Promise<boolean> {
    if (this.disposed || this.muted || !text) return false;

    if (options?.queue && (this.isSpeaking || this.isSynthesizing)) {
      this.speechQueue.push(text);
      return true;
    }

    this.speechQueue = [];
    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return false;

    this.stop();
    this.isSynthesizing = true;

    try {
      console.info("[CompanionVoice] speak() started for text:", cleaned.slice(0, 80));

      // =========================================================================
      // [ARCHITECTURAL CONTRACT - GOLDEN IN-MEMORY TRANSLATION BRIDGE - DO NOT REMOVE]
      // Documented in AGENTS.md Section 1.2 & 9.1.
      // UI surface is 100% English. Spoken voice dialogue is 100% Chinese (昔涟 / Cyrene original voice).
      //
      // IMPORTANT: Translation is performed ONCE in the main process inside
      // prepareGptsovitsVoicePayload (index.ts). Pre-translating here causes
      // a double-translation round-trip (renderer → main → GTX → main) adding
      // 1–6 seconds of latency. The cleaned English text is passed directly to
      // synthesizeCachedGptsovits; the main process bridge handles Mandarin
      // conversion in-memory before feeding GPT-SoVITS.
      //
      // DO NOT restore the old window.tts.translateToChinese() call here.
      // =========================================================================
      const speechDialogue = cleaned;

      // Check if cloud/local TTS engine is configured
      const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
      const settings = await (win as unknown as { settings?: { getGeneral: () => Promise<Record<string, unknown>> } })
        .settings?.getGeneral?.().catch(() => ({}));

      const engine = String(
        settings?.ttsEngine || (settings || (win as any).tts ? "gptsovits" : "web-speech")
      );

      if (engine === "off") {
        console.info("[CompanionVoice] TTS is configured to 'off' in settings");
        return false;
      }

      if (engine === "gptsovits") {
        console.info("[CompanionVoice] Synthesizing via Hugging Face GPT-SoVITS local server...");
        const played = await this.playGptsovits(speechDialogue, settings || {});
        if (!played) {
          console.warn("[CompanionVoice] GPT-SoVITS server (http://127.0.0.1:9880) is unreachable or offline. Suppressing speech to prevent robot voice leaks.");
          return false;
        }
        return true;
      } else if (engine === "edge") {
        return await this.playOnlineNeural(speechDialogue);
      } else if (engine === "minimax" && settings?.ttsMinimaxKey && settings?.ttsMinimaxVoiceId) {
        return await this.playCloudMinimax(speechDialogue, settings);
      } else if (engine === "mossland" && settings?.ttsMosslandKey && settings?.ttsMosslandVoiceId) {
        return await this.playCloudMossland(speechDialogue, settings);
      } else if (engine === "web-speech") {
        return this.speakWebSpeech(speechDialogue);
      }

      return false;
    } finally {
      this.isSynthesizing = false;
    }
  }


  private async playOnlineNeural(text: string): Promise<boolean> {
    try {
      const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
      const tts = (win as unknown as { tts?: {
        synthesizeOnline?: (payload: { text: string; lang?: string }) => Promise<{ base64: string; format: string } | null>;
        translateToChinese?: (text: string) => Promise<string>;
      } }).tts;

      if (tts?.synthesizeOnline) {
        let textToSpeak = text;
        // If text does not contain Chinese characters, translate to spoken Chinese so Cyrene speaks Chinese
        if (!/[\u4e00-\u9fa5]/.test(text) && tts.translateToChinese) {
          try {
            const translated = await tts.translateToChinese(text);
            if (translated && /[\u4e00-\u9fa5]/.test(translated)) {
              textToSpeak = translated;
            }
          } catch (trErr) {
            console.warn("[CompanionVoice] Chinese translation failed, speaking original:", trErr);
          }
        }

        const res = await tts.synthesizeOnline({ text: textToSpeak, lang: "zh-CN" });
        if (res && res.base64) {
          return this.playBase64Audio(res.base64, res.format || "mp3");
        }
      }
    } catch (onlineErr) {
      console.warn("[CompanionVoice] Online neural synthesis fallback to WebSpeech:", onlineErr);
    }
    return false;
  }

  /**
   * Speak using browser/Electron Web Speech API (strictly Chinese/anime female voice, zero male voices).
   */
  private speakWebSpeech(text: string): boolean {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;
      utterance.lang = "zh-CN";

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const isMaleVoice = (v: SpeechSynthesisVoice) => {
          const name = (v.name + " " + v.lang).toLowerCase();
          return (
            name.includes("david") ||
            name.includes("mark") ||
            name.includes("george") ||
            name.includes("richard") ||
            name.includes("james") ||
            name.includes("ichiro") ||
            name.includes("kangkang") ||
            name.includes("male")
          );
        };

        const femaleVoices = voices.filter((v) => !isMaleVoice(v));
        const pool = femaleVoices.length > 0 ? femaleVoices : voices;

        // 1st Priority: Chinese female voices (Xiaoyi, Xiaoxiao, Huihui, Yaoyao, Hanhan, zh-CN, Chinese, Mandarin)
        let preferredVoice = pool.find((v) => {
          const name = (v.name + " " + v.lang).toLowerCase();
          return (
            (name.includes("zh") || name.includes("chinese") || name.includes("mandarin")) &&
            (name.includes("xiaoyi") ||
              name.includes("xiaoxiao") ||
              name.includes("huihui") ||
              name.includes("yaoyao") ||
              name.includes("female") ||
              !isMaleVoice(v))
          );
        });

        // 2nd Priority: Sweet anime Japanese female voices
        if (!preferredVoice) {
          preferredVoice = pool.find((v) => {
            const name = (v.name + " " + v.lang).toLowerCase();
            return (
              (name.includes("ja") || name.includes("japanese")) &&
              (name.includes("haruka") ||
                name.includes("ayumi") ||
                name.includes("sayaka") ||
                name.includes("nanami"))
            );
          });
        }

        // STRICT: If no Chinese or Japanese female voice exists, DO NOT SPEAK!
        // Never allow English voices (Microsoft Zira, etc.) to speak Cyrene's dialogue.
        if (!preferredVoice) {
          this.currentUtterance = null;
          console.warn("[CompanionVoice] No Chinese or Japanese voice found in WebSpeech. Suppressing speech to prevent English voice leaks.");
          return false;
        }

        utterance.voice = preferredVoice;
      }

      utterance.pitch = 1.15; // Slightly higher pitch for sweet waifu tone
      utterance.rate = 1.05;

      utterance.onstart = () => {
        this.isSpeaking = true;
        const duration = Math.min(Math.max((text.length / 14) * 1000, 1500), 12000);
        this.onStartSpeaking?.(duration);
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.onStopSpeaking?.();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.onStopSpeaking?.();
      };

      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.warn("[CompanionVoice] Web Speech API failed:", err);
      this.isSpeaking = false;
      this.currentUtterance = null;
      return false;
    }
  }

  private async playCloudMinimax(text: string, settings: Record<string, unknown>): Promise<boolean> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const tts = (win as unknown as { tts?: {
      synthesizeCached: (payload: unknown) => Promise<{ base64: string; format: string }>;
    } }).tts;

    if (!tts) return false;

    try {
      const res = await tts.synthesizeCached({
        apiKey: settings.ttsMinimaxKey,
        voiceId: settings.ttsMinimaxVoiceId,
        text,
        speed: Number(settings.ttsSpeed ?? 1),
        volume: Number(settings.ttsVolume ?? 1),
        model: settings.ttsMinimaxModel || "speech-2.8-turbo",
      });

      if (res && res.base64) {
        return this.playBase64Audio(res.base64, res.format || "mp3");
      }
    } catch (err) {
      console.warn("[CompanionVoice] Cloud MiniMax synthesis failed:", err);
    }
    return false;
  }

  private async playCloudMossland(text: string, settings: Record<string, unknown>): Promise<boolean> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const tts = (win as unknown as { tts?: {
      synthesizeCachedMossland: (payload: unknown) => Promise<{ base64: string; format: string }>;
    } }).tts;

    if (!tts) return false;

    try {
      const res = await tts.synthesizeCachedMossland({
        apiKey: settings.ttsMosslandKey,
        voiceId: settings.ttsMosslandVoiceId,
        text,
        speed: Number(settings.ttsSpeed ?? 1),
        volume: Number(settings.ttsVolume ?? 1),
        model: settings.ttsMosslandModel || "moss-tts",
        format: "mp3",
      });

      if (res && res.base64) {
        return this.playBase64Audio(res.base64, res.format || "mp3");
      }
    } catch (err) {
      console.warn("[CompanionVoice] Cloud Mossland synthesis failed:", err);
    }
    return false;
  }

  private async playGptsovits(text: string, settings: Record<string, unknown>): Promise<boolean> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const tts = (win as unknown as { tts?: {
      synthesizeCachedGptsovits: (payload: {
        baseUrl: string;
        refAudioPath: string;
        promptText: string;
        text: string;
        speed?: number;
        format?: "wav" | "mp3";
      }) => Promise<{ base64: string; format: string }>;
    } }).tts;

    if (!tts?.synthesizeCachedGptsovits) {
      console.warn("[CompanionVoice] window.tts.synthesizeCachedGptsovits not available");
      return false;
    }

    const baseUrl = String(settings.ttsGptsovitsBaseUrl || "http://127.0.0.1:9880");
    const refAudioPath = String(settings.ttsGptsovitsRefAudioPath || "resources/voice/cyrene/ref_audio.wav");
    const promptText = String(settings.ttsGptsovitsPromptText || "开拓者，希琳一直都在这里陪着你哦。");

    if (!baseUrl || !refAudioPath || !promptText) {
      console.warn("[CompanionVoice] GPT-SoVITS missing configuration (baseUrl, refAudioPath, or promptText)");
      return false;
    }

    try {
      console.info(`[CompanionVoice] Requesting GPT-SoVITS synthesis from ${baseUrl} for "${text.slice(0, 40)}"`);
      const res = await tts.synthesizeCachedGptsovits({
        baseUrl,
        refAudioPath,
        promptText,
        text,
        speed: Number(settings.ttsSpeed ?? 1),
        format: settings.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
      });

      if (res && res.base64) {
        console.info(`[CompanionVoice] GPT-SoVITS returned audio (${res.base64.length} chars base64). Starting playback...`);
        const volume = typeof settings.ttsVolume === "number" ? settings.ttsVolume : 1.0;
        return this.playBase64Audio(res.base64, res.format || "wav", volume);
      }
      console.warn("[CompanionVoice] GPT-SoVITS returned empty response payload");
    } catch (err) {
      console.warn("[CompanionVoice] GPT-SoVITS synthesis failed:", err);
      try {
        const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
        const log = (win as unknown as { log?: { pushEntry: (e: unknown) => Promise<unknown> } }).log;
        void log?.pushEntry({
          type: "system",
          text: "GPT-SoVITS local server (127.0.0.1:9880) is offline. To hear Cyrene's Hugging Face voice, launch api_v2 server or switch engine in Settings (Alt+6).",
          channel: "tts",
        });
      } catch {}
    }
    return false;
  }

  private playBase64Audio(base64: string, format: string, volume = 1.0): boolean {
    if (typeof Audio === "undefined") return false;

    try {
      const mime = format === "wav" ? "audio/wav" : "audio/mpeg";
      let audioSrc = `data:${mime};base64,${base64}`;
      let blobUrl: string | null = null;

      // Prefer native Blob URL for fast and reliable browser audio decoding
      if (
        typeof Blob !== "undefined" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function" &&
        typeof atob === "function"
      ) {
        try {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mime });
          blobUrl = URL.createObjectURL(blob);
          audioSrc = blobUrl;
        } catch {
          // Fall back to data URI
        }
      }

      const audio = new Audio(audioSrc);
      audio.volume = Math.max(0, Math.min(1, Number(volume ?? 1.0)));
      this.currentAudio = audio;
      this.isSpeaking = true;

      const cleanup = () => {
        this.isSpeaking = false;
        this.currentAudio = null;
        if (blobUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {}
          blobUrl = null;
        }
        this.onStopSpeaking?.();

        if (this.speechQueue.length > 0) {
          const nextText = this.speechQueue.shift();
          if (nextText) {
            void this.speak(nextText);
          }
        }
      };

      audio.onplay = () => {
        console.info("[CompanionVoice] Audio playback actively started on speakers");
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : 3000;
        this.onStartSpeaking?.(durationMs);
      };

      audio.onended = () => {
        console.info("[CompanionVoice] Audio playback ended naturally");
        cleanup();
      };

      audio.onerror = (e) => {
        console.warn("[CompanionVoice] Audio element error event:", e);
        cleanup();
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(async (err) => {
          console.warn("[CompanionVoice] audio.play() rejected, attempting Web Audio API direct output fallback:", err);
          try {
            const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
            const AudioCtx = (win as any).AudioContext || (win as any).webkitAudioContext;
            if (AudioCtx && typeof atob === "function") {
              const ctx = new AudioCtx();
              if (ctx.state === "suspended") {
                await ctx.resume();
              }
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              const gainNode = ctx.createGain();
              gainNode.gain.value = Math.max(0, Math.min(1, Number(volume ?? 1.0)));
              source.connect(gainNode);
              gainNode.connect(ctx.destination);
              this.isSpeaking = true;
              this.onStartSpeaking?.(Math.round(audioBuffer.duration * 1000));
              source.onended = () => {
                console.info("[CompanionVoice] Web Audio API playback ended naturally");
                cleanup();
                ctx.close().catch(() => {});
              };
              source.start();
              console.info("[CompanionVoice] Web Audio API fallback playback started successfully!");
              return;
            }
          } catch (ctxErr) {
            console.warn("[CompanionVoice] Web Audio API fallback failed:", ctxErr);
          }
          cleanup();
        });
      }
      return true;
    } catch (err) {
      console.warn("[CompanionVoice] playBase64Audio instantiation error:", err);
      this.isSpeaking = false;
      this.currentAudio = null;
      this.onStopSpeaking?.();
      return false;
    }
  }

  stop(): void {
    this.speechQueue = [];
    this.isSpeaking = false;
    this.isSynthesizing = false;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.currentUtterance = null;

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }

    this.onStopSpeaking?.();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
