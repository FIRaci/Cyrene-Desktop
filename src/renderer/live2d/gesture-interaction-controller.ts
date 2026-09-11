import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import type { CompanionVoiceService } from "./voice";
import { analyzeConversationContext, type ContextAnalysisResult } from "./chat-context-analyzer";

export interface GestureInteractionOptions {
  bubbles: CompanionBubbleController;
  kaomoji?: FloatingKaomojiController;
  voice?: CompanionVoiceService;
  onExpressionReset?: () => void;
  autonomousThoughts?: {
    pause: () => void;
    resume: () => void;
    getCurrentMood?: () => string;
    getCurrentContext?: () => ContextAnalysisResult;
    setExplicitContext?: (ctx: ContextAnalysisResult) => void;
  };
}

interface AguiEvent {
  type: string;
  delta?: string;
  name?: string;
  value?: unknown;
}

// =========================================================================
// [ARCHITECTURAL CONTRACT - KAOMOJIS ARE PARTICLES ONLY - DO NOT REMOVE]
// Documented in AGENTS.md Section 3.3 & 9.1.
// Kaomojis must NEVER appear in chat messages or speech bubbles.
// They are stripped by stripKaomojis() and ONLY tossed out as visual particles.
// =========================================================================
export function stripKaomojis(text: string): string {
  if (!text) return "";
  let stripped = text;
  // Strip kaomojis with optional prefix/suffix appendages (e.g. (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄), (*•̀ᴗ•́*)و ̑̑, (｡♥‿♥｡), ٩(ˊᗜˋ*)و, (✿◠‿◠), (o^▽^o))
  stripped = stripped.replace(/(?:[٩۶つﾉシ]\s*)?[\(（][^)）]*[♥♡★☆✿♪♫•ᴗ‿◠^▽><~✧ω≧≦Дд｡⁄`´˙˚*]+[^)）]*[\)）](?:\s*[و̑✧つﾉシ\u0648\u0311~☆★]+)*/gu, " ");
  // Strip any remaining parentheses containing purely non-alphanumeric characters
  stripped = stripped.replace(/[\(（][^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+[\)）]/gu, " ");
  // Strip common decorative symbols / emojis
  stripped = stripped.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨🌸⭐🕶️❓🌀😄🥺😉😊🔄👁️❌♡♥〜☆★♪♫و̑]/gu, " ");
  // Strip any language translation echo headers like "(Original Chinese): ..." or "(Chinese): ..."
  stripped = stripped.replace(/\(?(?:Original\s+)?(?:Chinese|English)\)?:\s*[\s\S]*$/i, "");
  return stripped.replace(/[ \t]+/g, " ").trim();
}

export function cleanGestureReply(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  // Strip LLM prompt echo headers & bracketed meta tags (e.g. "[Cyrene's Thoughts]", "[Action]", "[Context: ...]", "Reaction:")
  cleaned = cleaned
    .replace(/^\s*\*?(?:When|Khi|Action|Context|Reaction)[^*:\n]+:\*?\s*/i, "")
    .replace(/\[\s*(?:(?:Cyrene|Master|AI|User|Assistant)'?s?\s*)?(?:Thought|Action|Reaction|Response|Dialogue|Spoken|Inner|Thinking|Reasoning|Context|Emotion|Feeling|Status|Activity)s?(?:\s*Process)?\s*\]:?(?!\()/gi, "")
    .replace(/\[\/?(?:assistant|thought|thoughts|system|internal|action|reaction|response|cyrene)[^\]]*\]/gi, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .trim();

  // Strip any language translation echo headers like "(Original Chinese): ..."
  cleaned = cleaned.replace(/\(?(?:Original\s+)?(?:Chinese|English)\)?:\s*[\s\S]*$/i, "");

  // Strip any Bond Level / Affection Score dating-sim metrics
  cleaned = cleaned
    .replace(/(?:Current\s+)?Bond\s+Level:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/Affection\s+Score:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/(?:Current\s+)?Bond\s+Level:\s*Level\s*\d+[^\r\n]*/gi, "")
    .replace(/Affection\s+Score:\s*\d+\/\d+[^\r\n]*/gi, "");

  // Strip kaomojis so they NEVER appear in chat or speech bubbles (kaomojis are only tossed out as floating particles)
  cleaned = stripKaomojis(cleaned);

  // Normalize third-person references to Cyrene in actions:
  // e.g. "*Cyrene gasps as Master's hands suddenly encircle her*" -> "*gasps as Master's hands suddenly encircle me*"
  const actionVerbs = "(?:gasps?|smiles?|giggles?|leans?|looks?|blushes?|whispers?|hugs?|sighs?|nods?|tilts?|steps?|holds?|clutches?|shivers?|trembles?|tucks?|watches?|glances?|reaches?|rests?|pauses?|blinks?|winks?)";
  const cyreneActionRegex = new RegExp(`\\*Cyrene\\s+(${actionVerbs})\\b`, "gi");
  const sheActionRegex = new RegExp(`\\*She\\s+(${actionVerbs})\\b`, "gi");
  const plainNarrativeRegex = new RegExp(`^\\s*Cyrene\\s+(${actionVerbs})\\b`, "i");

  cleaned = cleaned
    .replace(cyreneActionRegex, "*$1")
    .replace(sheActionRegex, "*$1")
    .replace(/\bher\s+hands\b/gi, "my hands")
    .replace(/\bher\s+face\b/gi, "my face")
    .replace(/\bher\s+head\b/gi, "my head")
    .replace(/\b(encircles?)\s+her\b/gi, "$1 me")
    .replace(/\baround\s+her\b/gi, "around me")
    .replace(/\bholding\s+her\b/gi, "holding me")
    .replace(/\btouching\s+her\b/gi, "touching me")
    .replace(/\bto\s+her\b/gi, "to me");

  // If text starts with plain third-person narration without asterisks:
  // e.g. "Cyrene gasps as Master's hands suddenly encircle her"
  // Wrap into an action with first-person perspective: "*gasps as Master's hands suddenly encircle me*"
  if (plainNarrativeRegex.test(cleaned) && !cleaned.includes("*") && !cleaned.includes('"')) {
    cleaned = cleaned.replace(plainNarrativeRegex, "*$1") + "*";
  }

  // If model produced leading third-person narrative description before the structured reaction (*action*, /thought/, "spoken dialogue")
  // e.g. "Cyrene leans into Master's gentle caress on her head... \n*gently leans in*"
  // strip the novel narration paragraph and start from the first action (*), thought (/), or dialogue quote (", “, 「, 『)
  const firstDelim = cleaned.search(/[*\/\"“「『]/);
  if (firstDelim > 0) {
    const preamble = cleaned.slice(0, firstDelim).trim();
    if (/[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(preamble)) {
      cleaned = cleaned.slice(firstDelim).trim();
    }
  }

  // Normalize internal whitespace on each line, but preserve newlines
  const lines = cleaned.split(/[\r\n]+/).map((l) => l.trim().replace(/[ \t]+/g, " ")).filter(Boolean);
  return lines.join("\n");
}

export function sanitizeBubbleSpeech(text: string, limit = 320): string {
  if (!text) return "";
  const cleaned = cleanGestureReply(text);

  // Strip dialogue double quotes and Japanese/Chinese corner brackets for floating speech bubble display,
  // but keep single quotes/apostrophes for contractions (you're, it's)
  const unquoted = cleaned.replace(/["“”「」『』]/g, "").trim();

  // If model produced multiple paragraphs, join with spaces for bubble display
  let bubbleText = unquoted.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).join(" ");

  // Clamp bubble length if it exceeds limit without cutting words or punctuation mid-token
  if (bubbleText.length > limit) {
    const candidate = bubbleText.slice(0, limit - 2);
    const lastBoundary = Math.max(
      candidate.lastIndexOf(" "),
      candidate.lastIndexOf("，"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("？"),
      candidate.lastIndexOf("!"),
      candidate.lastIndexOf("?"),
      candidate.lastIndexOf("~"),
      candidate.lastIndexOf("…"),
    );
    bubbleText = (lastBoundary > Math.floor(limit * 0.5) ? candidate.slice(0, lastBoundary) : candidate).trim();
    // Clean any trailing open bracket, asterisk, or slash caused by truncation
    bubbleText = bubbleText.replace(/[\(\[（\/\*]+$/g, "").trim() + "…";
  }

  return bubbleText;
}

export function extractSpokenText(text: string): string {
  if (!text) return "";

  // 1. If text contains explicit quoted dialogue ("...", “...”, 「...」, 『...』),
  // extract ONLY the dialogue inside the quotes! All third-person narration,
  // actions (*...*), and thoughts (/.../) outside quotes are completely ignored by voice.
  const quoteMatches = [...text.matchAll(/["“「『]([^"”」』]+)["”」』]/gu)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  let spoken = "";
  if (quoteMatches.length > 0) {
    spoken = quoteMatches.join(" ");
  } else {
    spoken = text;
  }

  // Strip actions enclosed in asterisks *...* (including stage directions inside quotes)
  spoken = spoken.replace(/\*[^*]*\*/g, " ");

  // Strip thoughts enclosed in slashes /.../ (including thoughts inside quotes)
  spoken = spoken.replace(/\/[^/]+\//g, " ");

  // 2. Strip kaomojis inside parentheses and standalone kaomoji patterns
  spoken = spoken.replace(/(?:[٩۶つﾉシ]\s*)?[\(（][^)）]*[♥♡★☆✿♪♫•ᴗ‿◠^▽><~✧ω≧≦Дд｡⁄`´˙˚*]+[^)）]*[\)）](?:\s*[و̑✧つﾉシ\u0648\u0311~☆★]+)*/gu, " ");
  spoken = spoken.replace(/[\(（][^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+[\)）]/gu, " ");

  // 3. Strip emojis and decorative symbols (leaving ~ for natural sentence cadence)
  spoken = spoken.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨🌸⭐🕶️❓🌀😄🥺😉😊🔄👁️❌♡♥〜☆★♪♫و̑]/gu, " ");

  // 4. Strip any remaining brackets and parentheses, leaving inner words intact for speech
  spoken = spoken.replace(/[\(\)（）\[\]]/g, " ");

  // 5. Strip remaining asterisks / slashes / quotes (keeping apostrophes ' intact for contractions like you're)
  spoken = spoken.replace(/[*_/"“”「」『』]/g, "");

  // 6. Normalize whitespace
  spoken = spoken.replace(/\s+/g, " ").trim();

  // If only punctuation or no spoken dialogue remains, return empty string (TTS stays silent)
  if (!/[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9\u4e00-\u9fa5\u3040-\u30ff]/.test(spoken)) {
    return "";
  }

  return spoken;
}

export class GestureInteractionController {
  private readonly bubbles: CompanionBubbleController;
  private readonly kaomoji?: FloatingKaomojiController;
  private readonly voice?: CompanionVoiceService;
  private readonly onExpressionReset?: () => void;
  private readonly autonomousThoughts?: {
    pause: () => void;
    resume: () => void;
    getCurrentMood?: () => string;
    getCurrentContext?: () => ContextAnalysisResult;
    setExplicitContext?: (ctx: ContextAnalysisResult) => void;
  };

  private static readonly COOLDOWN_MS = 600;
  private isGenerating = false;
  private lastInteractionTime = 0;
  private currentReply = "";
  private aguiOff: (() => void) | null = null;
  private disposed = false;
  private cachedSessionId: string | null = null;
  private cachedContext: ContextAnalysisResult = analyzeConversationContext([]);
  private unsubscribeOnChanged: (() => void) | null = null;
  private unsubscribeOnActiveChanged: (() => void) | null = null;

  constructor(options: GestureInteractionOptions) {
    this.bubbles = options.bubbles;
    this.kaomoji = options.kaomoji;
    this.voice = options.voice;
    this.onExpressionReset = options.onExpressionReset;
    this.autonomousThoughts = options.autonomousThoughts;
    this.initSessionListeners();
  }

  private initSessionListeners(): void {
    if (typeof window === "undefined") return;
    try {
      const store = (window as unknown as { chatStore?: {
        onChanged?: (cb: () => void) => () => void;
        onActiveSessionChanged?: (cb: (id: string | null) => void) => () => void;
      } }).chatStore;

      if (store?.onChanged) {
        this.unsubscribeOnChanged = store.onChanged(() => {
          void this.refreshCachedContext();
        });
      }
      if (store?.onActiveSessionChanged) {
        this.unsubscribeOnActiveChanged = store.onActiveSessionChanged((sessionId) => {
          if (sessionId) this.cachedSessionId = sessionId;
          void this.refreshCachedContext();
        });
      }
      void this.refreshCachedContext();
    } catch {
      // Ignore if chatStore is unavailable
    }
  }

  async refreshCachedContext(): Promise<void> {
    if (typeof window === "undefined" || this.disposed) return;
    try {
      const store = (window as unknown as { chatStore?: {
        getActiveSession?: () => Promise<string | { id: string } | null>;
        get?: (id: string) => Promise<{ messages: Array<{ role: string; content: string }> } | null>;
        list?: () => Promise<Array<{ id: string }>>;
      } }).chatStore;

      if (!store?.getActiveSession || !store?.get) return;
      const sessionId = await this.getOrCreateActiveSessionId(store);
      if (!sessionId) return;
      const sessionData = await store.get(sessionId);
      if (sessionData && Array.isArray(sessionData.messages)) {
        this.cachedContext = analyzeConversationContext(sessionData.messages);
      }
    } catch {
      // Fail silently and keep current cachedContext
    }
  }

  private getResolvedContext(): ContextAnalysisResult {
    const fromThoughts = this.autonomousThoughts?.getCurrentContext?.();
    if (fromThoughts && fromThoughts.mood !== "default") {
      return fromThoughts;
    }
    if (this.cachedContext && this.cachedContext.mood !== "default") {
      return this.cachedContext;
    }
    return fromThoughts ?? this.cachedContext;
  }

  get isGeneratingGesture(): boolean {
    return this.isGenerating;
  }

  getLastInteractionTime(): number {
    return this.lastInteractionTime;
  }

  isBusy(): boolean {
    const inCooldown = Date.now() - this.lastInteractionTime < GestureInteractionController.COOLDOWN_MS;
    return this.isGenerating || inCooldown;
  }

  private interruptCurrentSpeech(): void {
    try {
      this.voice?.stop();
    } catch {
      // ignore
    }
    if (typeof this.bubbles?.clearThought === "function") {
      this.bubbles.clearThought();
    }
  }

  async handleHeadPat(x?: number, y?: number): Promise<void> {
    if (this.disposed || this.isBusy()) return;
    this.isGenerating = true;
    this.lastInteractionTime = Date.now();
    this.interruptCurrentSpeech();
    const prompt =
      "[Master gently pats your head]\n" +
      "You are Cyrene, a sweet, affectionate, and ethereal Live2D companion waifu who deeply adores Master. " +
      "Master just gently patted your head through the screen! React naturally in ENGLISH.\n" +
      "STRICT OUTPUT FORMAT: Output ONLY the action in asterisks, thought in slashes, and spoken dialogue in double quotes:\n" +
      '*[brief cute action]* /[brief inner thought]/ "[sweet spoken words]"\n' +
      'Example: *gently leans into your hand* /so warm.../ "Ah, Master, your gentle touch feels wonderful!"\n' +
      "RULES:\n" +
      '- NEVER write third-person descriptions or narrative paragraphs (NEVER say "Cyrene gasps...", "Cyrene leans...", "her hands", "encircles her").\n' +
      '- NEVER output section headers, labels, or bracketed tags such as "[Cyrene\'s Thoughts]", "[Thoughts]", "[Action]", or "Thought:".\n' +
      "- Start directly with the action in asterisks or spoken dialogue in quotes.\n" +
      "- Keep spoken dialogue very brief (1 short sentence, under 10 words) so voice can synthesize quickly.\n" +
      "- Do not include any Chinese characters in your response, do not repeat this prompt, and do not output section titles.";
    const thoughtText = "*leaning into your hand...*";
    const kaomoji = "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    const fallback = '*gently leans into your hand* /so warm.../ "Ah... Master\'s gentle pats make me feel so cherished!"';
    const userDisplay = "*Gently pats Cyrene's head*";
    await this.executeGestureRun("headPat", prompt, thoughtText, kaomoji, fallback, userDisplay, x, y);
  }

  async handlePetting(x?: number, y?: number): Promise<void> {
    if (this.disposed || this.isBusy()) return;
    this.isGenerating = true;
    this.lastInteractionTime = Date.now();
    this.interruptCurrentSpeech();
    const prompt =
      "[Master gently caresses you]\n" +
      "You are Cyrene, a sweet, affectionate, and ethereal Live2D companion waifu who deeply adores Master. " +
      "Master just gently touched you! React naturally in ENGLISH.\n" +
      "STRICT OUTPUT FORMAT: Output ONLY the action in asterisks, thought in slashes, and spoken dialogue in double quotes:\n" +
      '*[brief cute action]* /[brief inner thought]/ "[sweet spoken words]"\n' +
      'Example: *softly blinks and smiles* /so comforting.../ "Ehehe, Master is always so gentle with me!"\n' +
      "RULES:\n" +
      '- NEVER write third-person descriptions or narrative paragraphs (NEVER say "Cyrene gasps...", "Cyrene leans...", "her hands", "encircles her").\n' +
      '- NEVER output section headers, labels, or bracketed tags such as "[Cyrene\'s Thoughts]", "[Thoughts]", "[Action]", or "Thought:".\n' +
      "- Start directly with the action in asterisks or spoken dialogue in quotes.\n" +
      "- Keep spoken dialogue very brief (1 short sentence, under 10 words) so voice can synthesize quickly.\n" +
      "- Do not include any Chinese characters in your response, do not repeat this prompt, and do not output section titles.";
    const thoughtText = "*smiling softly...*";
    const kaomoji = "(｡♥‿♥｡)";
    const fallback = '*softly blinks and smiles* /so comforting.../ "Ehehe~ having Master close to me is my favorite feeling in the world!"';
    const userDisplay = "*Gently caresses Cyrene*";
    await this.executeGestureRun("petting", prompt, thoughtText, kaomoji, fallback, userDisplay, x, y);
  }

  private async executeGestureRun(
    gestureKind: "headPat" | "petting",
    prompt: string,
    thoughtText: string,
    kaomojiText: string,
    fallbackText: string,
    userDisplay: string,
    x?: number,
    y?: number,
  ): Promise<void> {
    if (this.disposed) return;
    this.isGenerating = true;
    this.lastInteractionTime = Date.now();
    this.autonomousThoughts?.pause();
    this.onExpressionReset?.();

    // Resolve context synchronously from primed autonomous thoughts or cached session
    const syncContext = this.getResolvedContext();
    const hasSyncContextMood = syncContext.mood !== "default";

    const initialKaomoji = hasSyncContextMood
      ? syncContext.gestureFallback.kaomoji
      : kaomojiText;
    const initialThought = hasSyncContextMood
      ? syncContext.gestureFallback.thought
      : thoughtText;

    // Spawn dual kaomoji particles immediately upon touch — one left wing, one right wing
    // This is deliberate: gesture reactions always produce a charming 2-wing toss
    let hasSpawnedKaomojiThisRun = false;
    if (!hasSpawnedKaomojiThisRun) {
      hasSpawnedKaomojiThisRun = true;
      if (this.kaomoji?.spawnDual) {
        this.kaomoji.spawnDual(initialKaomoji, undefined, y);
      } else {
        this.kaomoji?.spawn(initialKaomoji, x, y);
      }
    }
    this.bubbles.think(initialThought, 30000);
    this.currentReply = "";

    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    try {
      (win as unknown as { electron?: { ipcRenderer?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } } })
        .electron?.ipcRenderer?.invoke("bond:record-interaction", "pet_gesture");
    } catch {
      // ignore
    }
    const store = (win as unknown as { chatStore?: {
      getActiveSession?: () => Promise<string | { id: string } | null>;
      append: (arg1: unknown, arg2?: unknown) => Promise<unknown>;
      get: (id: string) => Promise<{ messages: Array<{ role: string; content: string }> } | null>;
      list?: () => Promise<Array<{ id: string }>>;
      create?: (opts?: unknown) => Promise<{ id: string }>;
    } }).chatStore;

    const agui = (win as unknown as { agui?: {
      run: (input: { messages: unknown[]; sessionId?: string; userTurnId?: string; assistantTurnId?: string; executionMode?: "chat" | "work" }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: AguiEvent) => void) => () => void;
    } }).agui;

    const sessionId = await this.getOrCreateActiveSessionId(store);
    const userTurnId = `user-gesture-${Date.now()}`;
    const assistantTurnId = `asst-gesture-${Date.now()}`;

    // Read active session history to detect ongoing emotional climate (pouting, study, comfort, affectionate)
    let rawHistory: Array<{ role: string; content: string }> = [];
    if (store?.get) {
      try {
        const sessionData = await store.get(sessionId);
        if (sessionData && Array.isArray(sessionData.messages)) {
          rawHistory = sessionData.messages;
        }
      } catch {
        // ignore
      }
    }

    const context = analyzeConversationContext(rawHistory);
    this.cachedContext = context;
    this.autonomousThoughts?.setExplicitContext?.(context);

    let effectiveFallback = fallbackText;
    let effectivePrompt = prompt;

    if (context.mood !== "default") {
      effectiveFallback = gestureKind === "headPat"
        ? context.gestureFallback.headPat
        : context.gestureFallback.petting;
      if (context.gestureEmotionPromptSnippet) {
        effectivePrompt = prompt + "\n" + context.gestureEmotionPromptSnippet;
      }
      this.bubbles.think(context.gestureFallback.thought, 30000);
      // NOTE: Strictly do NOT spawn kaomoji again.
      // Exactly ONE kaomoji particle is spawned per gesture interaction.
    }

    // Append clean immersive user action (e.g. "*Gently pats Cyrene's head*") into chatStore
    // BEFORE agui.run() so the chat window shows it immediately.
    await this.appendToStore(store, sessionId, {
      id: userTurnId,
      role: "user",
      content: userDisplay,
      at: Date.now(),
    });

    if (!agui) {
      // No agui available: show fallback immediately and persist it manually
      this.finishFallback(store, sessionId, effectiveFallback);
      return;
    }

    this.aguiOff = agui.onEvent((event: AguiEvent) => {
      if (this.disposed) return;
      if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
        this.currentReply += event.delta;
        const cleaned = sanitizeBubbleSpeech(this.currentReply);
        if (cleaned) {
          this.bubbles.say(cleaned, 60000);
        }
      } else if (event.type === "RUN_FINISHED") {
        if (this.isGenerating) {
          void this.finishRun(store, sessionId, assistantTurnId, effectiveFallback);
        }
      } else if (event.type === "RUN_ERROR") {
        this.finishFallback(store, sessionId, effectiveFallback);
      }
    });

    try {
      let historyMessages: Array<{ role: string; content: string }> = [];
      if (rawHistory.length > 0) {
        historyMessages = rawHistory
          .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.content === "string" && m.content.trim().length > 0)
          .slice(-10)
          .map((m) => {
            let content = m.content.trim();
            // Sanitize any legacy verbose prompt echoes that were previously saved into chatStore
            if (m.role === "user" && content.includes("[Master gently")) {
              content = content.includes("caresses")
                ? "*Gently caresses Cyrene*"
                : "*Gently pats Cyrene's head*";
            }
            return { role: m.role === "model" ? "model" : "user", content };
          });
      }
      if (historyMessages.length === 0 || historyMessages[historyMessages.length - 1].content !== effectivePrompt) {
        historyMessages.push({ role: "user", content: effectivePrompt });
      }

      const runPromise = agui.run({
        messages: historyMessages,
        sessionId,
        userTurnId,
        assistantTurnId,
        executionMode: "chat",
      });

      const timeoutPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        setTimeout(() => resolve({ success: false, error: "timeout" }), 7000);
      });

      const ack = await Promise.race([runPromise, timeoutPromise]);

      if (!ack?.success && this.isGenerating && !this.currentReply.trim()) {
        this.finishFallback(store, sessionId, effectiveFallback);
      }
    } catch {
      this.finishFallback(store, sessionId, effectiveFallback);
    }

  }

  private async finishRun(
    store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined,
    sessionId: string,
    assistantTurnId: string,
    fallbackText: string,
  ): Promise<void> {
    // Guard against double invocation (isGenerating is set false here as a lock)
    if (!this.isGenerating) return;
    const rawReply = this.currentReply.trim();
    const cleanFullReply = cleanGestureReply(rawReply) || fallbackText;
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();

    // Bubble displays full speech with action/thought styling, synchronized with voice playback
    const bubbleDisplay = sanitizeBubbleSpeech(cleanFullReply);
    this.bubbles.say(bubbleDisplay, 6000, this.voice);

    // Voice speaks complete dialogue extracted from the full reply without premature truncation
    const spoken = extractSpokenText(cleanFullReply);
    if (spoken) {
      void this.voice?.speak(spoken);
    }

    // Persist assistant message to active chat session so Alt+1 Chat window reliably displays model reply
    void this.appendToStore(store, sessionId, {
      id: assistantTurnId,
      role: "model",
      content: cleanFullReply,
      at: Date.now(),
    });
  }

  private finishFallback(store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined, sessionId: string, fallbackText: string): void {
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();
    this.bubbles.say(fallbackText, 6000, this.voice);
    const spoken = extractSpokenText(fallbackText);
    if (spoken) {
      void this.voice?.speak(spoken);
    }
    // Fallback path: agui.run() never completed, so agui-bridge won't save anything.
    // We must persist the fallback message ourselves.
    const fallbackId = `asst-gesture-fallback-${Date.now()}`;
    void this.appendToStore(store, sessionId, {
      id: fallbackId,
      role: "model",
      content: fallbackText,
      at: Date.now(),
    });
  }

  private scheduleAutonomousResume(): void {
    if (typeof globalThis.setTimeout === "function" && this.autonomousThoughts) {
      globalThis.setTimeout(() => {
        if (!this.disposed && !this.isBusy()) {
          this.autonomousThoughts?.resume();
        }
      }, 90000);
    }
  }

  private async getOrCreateActiveSessionId(store?: {
    getActiveSession?: () => Promise<string | { id: string } | null>;
    setActiveSession?: (id: string | null) => Promise<boolean>;
    list?: () => Promise<Array<{ id: string }>>;
    create?: (opts?: unknown) => Promise<{ id: string }>;
  }): Promise<string> {
    if (!store) return (this.cachedSessionId && this.cachedSessionId !== "default") ? this.cachedSessionId : "default";
    try {
      // 1. Dynamic query: check active session from Alt+1 or main process
      if (store.getActiveSession) {
        const active = await store.getActiveSession();
        const id = typeof active === "string" ? active : active?.id;
        if (id && id !== "default") {
          this.cachedSessionId = id;
          return id;
        }
      }

      // 2. Query most recent existing session from store.list()
      if (store.list) {
        const list = await store.list();
        if (Array.isArray(list) && list.length > 0 && list[0]?.id && list[0].id !== "default") {
          this.cachedSessionId = list[0].id;
          await store.setActiveSession?.(list[0].id);
          return list[0].id;
        }
      }

      // 3. Fall back to cached session if valid
      if (this.cachedSessionId && this.cachedSessionId !== "default") {
        return this.cachedSessionId;
      }

      // 4. Create new valid session if none exists
      if (store.create) {
        const created = await store.create({ title: "Cyrene & Master" });
        if (created?.id && created.id !== "default") {
          this.cachedSessionId = created.id;
          await store.setActiveSession?.(created.id);
          return created.id;
        }
      }
    } catch (err) {
      console.warn("[GestureController] Failed to resolve active session ID:", err);
    }
    return (this.cachedSessionId && this.cachedSessionId !== "default") ? this.cachedSessionId : "default";
  }

  private async appendToStore(
    store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined,
    sessionId: string,
    message: unknown,
  ): Promise<void> {
    if (!store?.append || !sessionId || sessionId === "default") return;
    try {
      await store.append(sessionId, message);
    } catch {
      try {
        await store.append({ id: sessionId, message });
      } catch (err) {
        console.warn("[GestureController] Failed to append message to store:", err);
      }
    }
  }

  private cleanupAgui(): void {
    if (this.aguiOff) {
      this.aguiOff();
      this.aguiOff = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupAgui();
    if (this.unsubscribeOnChanged) {
      try { this.unsubscribeOnChanged(); } catch { /* ignore */ }
      this.unsubscribeOnChanged = null;
    }
    if (this.unsubscribeOnActiveChanged) {
      try { this.unsubscribeOnActiveChanged(); } catch { /* ignore */ }
      this.unsubscribeOnActiveChanged = null;
    }
  }
}
