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
  private currentAudio: HTMLAudioElement | null = null;
  private onStartSpeaking?: (durationMs: number) => void;
  private onStopSpeaking?: () => void;
  private disposed = false;

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
    return this.isSpeaking;
  }

  /**
   * Speak the given text out loud in sweet Chinese anime voice (Cyrene) and coordinate Live2D mouth movements.
   * Cleans kaomoji/emojis, strips actions/thoughts, and speaks in Chinese dialogue.
   */
  async speak(text: string): Promise<boolean> {
    if (this.disposed || this.muted || !text) return false;

    const cleaned = cleanTextForSpeech(text);
    if (!cleaned) return false;

    this.stop();

    // Check if cloud/local TTS engine is configured
    try {
      const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
      const settings = await (win as unknown as { settings?: { getGeneral: () => Promise<Record<string, unknown>> } })
        .settings?.getGeneral?.();

      const engine = String(settings?.ttsEngine || (settings ? "gptsovits" : "web-speech"));

      if (engine === "off") {
        return false;
      }

      if (engine === "gptsovits") {
        const played = await this.playGptsovits(cleaned, settings);
        return played;
      } else if (engine === "edge") {
        const played = await this.playOnlineNeural(cleaned);
        return played;
      } else if (engine === "minimax" && settings?.ttsMinimaxKey && settings?.ttsMinimaxVoiceId) {
        const played = await this.playCloudMinimax(cleaned, settings);
        return played;
      } else if (engine === "mossland" && settings?.ttsMosslandKey && settings?.ttsMosslandVoiceId) {
        const played = await this.playCloudMossland(cleaned, settings);
        return played;
      } else if (engine === "web-speech") {
        return this.speakWebSpeech(cleaned);
      }
    } catch {
      // Ignore settings fetch errors and proceed
    }

    // Default: try GPT-SoVITS local server. If offline, return false silently rather than leaking English robot voice.
    return false;
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
        this.onStopSpeaking?.();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.onStopSpeaking?.();
      };

      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.warn("[CompanionVoice] Web Speech API failed:", err);
      this.isSpeaking = false;
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

    if (!tts?.synthesizeCachedGptsovits) return false;

    const baseUrl = String(settings.ttsGptsovitsBaseUrl || "http://127.0.0.1:9880");
    const refAudioPath = String(settings.ttsGptsovitsRefAudioPath || "resources/voice/cyrene/ref_audio.wav");
    const promptText = String(settings.ttsGptsovitsPromptText || "开拓者，希琳一直都在这里陪着你哦。");

    if (!baseUrl || !refAudioPath || !promptText) {
      console.warn("[CompanionVoice] GPT-SoVITS missing configuration (baseUrl, refAudioPath, or promptText)");
      return false;
    }

    try {
      const res = await tts.synthesizeCachedGptsovits({
        baseUrl,
        refAudioPath,
        promptText,
        text,
        speed: Number(settings.ttsSpeed ?? 1),
        format: settings.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
      });

      if (res && res.base64) {
        return this.playBase64Audio(res.base64, res.format || "wav");
      }
    } catch (err) {
      console.warn("[CompanionVoice] GPT-SoVITS synthesis failed:", err);
    }
    return false;
  }

  private playBase64Audio(base64: string, format: string): boolean {
    if (typeof Audio === "undefined") return false;

    try {
      const mime = format === "wav" ? "audio/wav" : "audio/mpeg";
      const audio = new Audio(`data:${mime};base64,${base64}`);
      this.currentAudio = audio;
      this.isSpeaking = true;

      audio.onplay = () => {
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : 3000;
        this.onStartSpeaking?.(durationMs);
      };

      audio.onended = () => {
        this.isSpeaking = false;
        this.currentAudio = null;
        this.onStopSpeaking?.();
      };

      audio.onerror = () => {
        this.isSpeaking = false;
        this.currentAudio = null;
        this.onStopSpeaking?.();
      };

      void audio.play();
      return true;
    } catch {
      this.isSpeaking = false;
      this.currentAudio = null;
      this.onStopSpeaking?.();
      return false;
    }
  }

  stop(): void {
    this.isSpeaking = false;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

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
