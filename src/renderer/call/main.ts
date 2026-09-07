// Call window renderer — particle background + microphone capture + VAD silence detection + state machine + TTS playback.
//
// States: LISTENING (user speaking) → THINKING (agent thinking) → SPEAKING (Cyrene speaking) → LISTENING
// User speaking: capsule waveform bounces + avatar perimeter volume waveform
// Cyrene speaking: pulse ring radiates + waveform hides
import "../ui/theme";

// ── Particle Background ──
const canvas = document.getElementById("particles") as HTMLCanvasElement | null;
const ctx = canvas?.getContext("2d") ?? null;
let particlesW = 0, particlesH = 0;

interface Particle {
  x: number; y: number; size: number; vx: number; vy: number;
  hue: number; alpha: number; twinkle: number; twinkleSpeed: number;
}

const PARTICLE_COUNT = 45;
const particles: Particle[] = [];

function spawnParticle(): Particle {
  return {
    x: Math.random() * particlesW, y: Math.random() * particlesH,
    size: 0.6 + Math.random() * 2.4,
    vx: (Math.random() - 0.5) * 0.18,
    vy: -0.05 - Math.random() * 0.22,
    hue: 305 + Math.random() * 40,
    alpha: 0.25 + Math.random() * 0.5,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.005 + Math.random() * 0.012,
  };
}

function resizeParticles(): void {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  // Use window dimensions directly; avoid relying on clientWidth which may be obscured
  particlesW = window.innerWidth;
  particlesH = window.innerHeight;
  canvas.width = particlesW * dpr;
  canvas.height = particlesH * dpr;
  canvas.style.width = particlesW + "px";
  canvas.style.height = particlesH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawParticles(): void {
  if (!ctx) return;
  ctx.clearRect(0, 0, particlesW, particlesH);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.twinkle += p.twinkleSpeed;
    if (p.y < -10) p.y = particlesH + 10;
    if (p.x < -10) p.x = particlesW + 10;
    if (p.x > particlesW + 10) p.x = -10;
    const flicker = 0.65 + Math.sin(p.twinkle) * 0.35;
    const a = p.alpha * flicker;
    const r = p.size * 3;
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, `hsla(${p.hue}, 90%, 80%, ${a})`);
    grad.addColorStop(0.5, `hsla(${p.hue}, 90%, 70%, ${a * 0.4})`);
    grad.addColorStop(1, `hsla(${p.hue}, 90%, 70%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(drawParticles);
}

// ── DOM Elements ──
const statusEl = document.getElementById("call-status") as HTMLElement;
const ringEl = document.getElementById("avatar-ring") as HTMLElement;
const waveformCanvas = document.getElementById("waveform-canvas") as HTMLCanvasElement | null;
const micWaveEl = document.getElementById("mic-wave") as HTMLElement;
const micBars = micWaveEl ? Array.from(micWaveEl.querySelectorAll(".call__mic-wave-bar")) : [];
const transcriptEl = document.getElementById("transcript") as HTMLElement;
const hangupBtn = document.getElementById("hangup-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const durationEl = document.getElementById("call-duration") as HTMLElement | null;
const quickForm = document.getElementById("quick-form") as HTMLFormElement | null;
const quickInput = document.getElementById("quick-input") as HTMLInputElement | null;

// ── Call Duration Timer (starts on first active state, stops on END) ──
let callStartAt: number | null = null;
let callTimer: number | null = null;

/** Formats milliseconds as MM:SS, or HH:MM:SS if over 60 minutes. */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Start or reset timer. Records start time and starts 1s interval on first true call. */
function startCallTimer(): void {
  if (callStartAt !== null) return; // Already started; avoid resetting during LISTENING<->SPEAKING transitions
  callStartAt = performance.now();
  if (durationEl) {
    durationEl.textContent = "00:00";
    durationEl.hidden = false;
  }
  const tick = () => {
    if (callStartAt === null || !durationEl) return;
    durationEl.textContent = formatDuration(performance.now() - callStartAt);
  };
  callTimer = window.setInterval(tick, 1000);
  tick();
}

/** Stop timer and hide duration element (for hangup or ended call). */
function stopCallTimer(): void {
  if (callTimer !== null) {
    window.clearInterval(callTimer);
    callTimer = null;
  }
  callStartAt = null;
  if (durationEl) durationEl.hidden = true;
}

// ── State Management ──
type CallState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR" | "ENDED";
let currentState: CallState = "IDLE";
let showTranscript = true; // Show transcript in Call window

function setState(state: CallState): void {
  currentState = state;
  updateUI();
}

function updateUI(): void {
  const status = statusEl;
  const ring = ringEl;
  const wave = waveformCanvas;
  const mic = micWaveEl;

  if (currentState === "LISTENING") {
    status.textContent = "In Call · Mic On";
    status.className = "call__status call__status--active";
    ring.classList.remove("is-active");
    wave?.classList.add("is-active");
    mic.classList.add("is-active");
    waveformMode = "listening";
    micMode = "listening";
  } else if (currentState === "THINKING") {
    status.textContent = "Cyrene is thinking...";
    status.className = "call__status call__status--thinking";
    ring.classList.remove("is-active");
    wave?.classList.add("is-active");
    mic.classList.add("is-active");
    waveformMode = "thinking";
    micMode = "thinking";
  } else if (currentState === "SPEAKING") {
    status.textContent = "Cyrene is speaking...";
    status.className = "call__status";
    ring.classList.add("is-active");
    wave?.classList.remove("is-active");
    mic.classList.remove("is-active");
    waveformMode = "idle";
    micMode = "idle";
  } else if (currentState === "ERROR") {
    status.textContent = "Connection error, please check network";
    status.className = "call__status call__status--error";
    ring.classList.remove("is-active");
    wave?.classList.remove("is-active");
    mic.classList.remove("is-active");
    waveformMode = "idle";
    micMode = "idle";
  } else if (currentState === "ENDED") {
    status.textContent = "Call ended";
    status.className = "call__status";
    ring.classList.remove("is-active");
    wave?.classList.remove("is-active");
    mic.classList.remove("is-active");
    waveformMode = "idle";
    micMode = "idle";
  } else {
    status.textContent = "Connecting...";
    status.className = "call__status";
    ring.classList.remove("is-active");
    wave?.classList.remove("is-active");
    mic.classList.remove("is-active");
    waveformMode = "idle";
    micMode = "idle";
  }

  // Call duration: starts when entering active state, stops on END/IDLE/ERROR/ENDED.
  if (currentState === "LISTENING" || currentState === "THINKING" || currentState === "SPEAKING") {
    startCallTimer();
  } else if (currentState === "ENDED") {
    stopCallTimer();
  }
}

// ── Transcript Display (shows current turn only) ──
function renderTranscript(userText: string, botText: string): void {
  if (!showTranscript) { transcriptEl.hidden = true; return; }
  transcriptEl.hidden = false;
  transcriptEl.innerHTML = "";
  if (userText) {
    const u = document.createElement("div");
    u.className = "call__transcript-user";
    u.textContent = userText;
    transcriptEl.appendChild(u);
  }
  if (botText) {
    const b = document.createElement("div");
    b.className = "call__transcript-bot";
    b.textContent = botText;
    transcriptEl.appendChild(b);
  }
}

let currentUserText = "";
let currentBotText = "";

// ── Volume Waveform (around avatar perimeter) ──
let waveformMode = "idle"; // idle, listening, thinking
const NUM_WAVE_BARS = 32;
const waveBars: Array<{ angle: number }> = [];
const waveformCtx = waveformCanvas?.getContext("2d") ?? null;

function initWaveformCanvas(): void {
  if (!waveformCanvas || !waveformCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const size = 200; // Slightly larger than avatar-zone (150px)
  waveformCanvas.width = size * dpr;
  waveformCanvas.height = size * dpr;
  waveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < NUM_WAVE_BARS; i++) {
    waveBars.push({ angle: (i / NUM_WAVE_BARS) * Math.PI * 2 });
  }
}

let analyserData: Uint8Array | null = null;

function drawWaveform(): void {
  if (!waveformCtx || !waveformCanvas) { requestAnimationFrame(drawWaveform); return; }
  const cx = waveformCanvas.width / (window.devicePixelRatio || 1) / 2;
  const cy = waveformCanvas.height / (window.devicePixelRatio || 1) / 2;
  const innerRadius = 80; // Avatar radius (150px / 2 ≈ 75, with margin)
  waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

  for (const b of waveBars) {
    let h: number;
    if (waveformMode === "listening") {
      // Get frequency domain data from AnalyserNode
      const dataIdx = Math.floor((b.angle / (Math.PI * 2)) * (analyserData?.length ?? 1));
      const vol = analyserData ? analyserData[dataIdx] / 255 : 0;
      h = 5 + vol * 85;
    } else if (waveformMode === "thinking") {
      h = 5 + Math.sin(Date.now() * 0.003 + b.angle) * 4 + 4;
    } else {
      h = 5;
    }
    const x1 = cx + Math.cos(b.angle) * innerRadius;
    const y1 = cy + Math.sin(b.angle) * innerRadius;
    const x2 = cx + Math.cos(b.angle) * (innerRadius + h);
    const y2 = cy + Math.sin(b.angle) * (innerRadius + h);
    waveformCtx.strokeStyle = "rgba(255, 110, 199, 0.7)";
    waveformCtx.lineWidth = 3;
    waveformCtx.lineCap = "round";
    waveformCtx.beginPath();
    waveformCtx.moveTo(x1, y1);
    waveformCtx.lineTo(x2, y2);
    waveformCtx.stroke();
  }
  requestAnimationFrame(drawWaveform);
}

// ── Capsule Waveform Animation ──
let micMode = "idle"; // idle, listening, thinking

function animateMicWave(): void {
  for (const bar of micBars) {
    let h: number;
    if (micMode === "listening") {
      // Get average volume from AnalyserNode
      const avg = analyserData ? analyserData.reduce((a, b) => a + b, 0) / analyserData.length / 255 : 0;
      h = 10 + Math.random() * avg * 76 + avg * 20;
    } else if (micMode === "thinking") {
      h = 10 + Math.sin(Date.now() * 0.004) * 5 + 5;
    } else {
      h = 10;
    }
    (bar as HTMLElement).style.height = h + "px";
  }
  requestAnimationFrame(animateMicWave);
}

// ── Microphone Capture + VAD ──
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let micStream: MediaStream | null = null;
let vadSilenceTimer: ReturnType<typeof setTimeout> | null = null;
let vadSilenceMs = 1000;
let vadThreshold = 0.004; // Frequency threshold
let rmsThreshold = 0.006; // RMS energy threshold
let hasSpoken = false; // Whether user has started speaking (VAD detects silence only after speech)
let speechRecognizer: unknown = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let muteGainNode: GainNode | null = null;

/**
 * Resamples any input Float32Array to 16kHz 16-bit mono PCM.
 * Bulletproof on all sound cards (44.1kHz, 48kHz, 96kHz, etc.).
 */
function downsampleTo16k(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(input.length / ratio);
  const result = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = Math.min(Math.floor(i * ratio), input.length - 1);
    const s = Math.max(-1, Math.min(1, input[srcIdx]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

function onSpeechDetected(level: number): void {
  if (currentState !== "LISTENING") return;
  if (!hasSpoken) {
    console.log("[Call VAD] Speech detected, level=", level.toFixed(4));
    statusEl.textContent = "In Call · Hearing your voice...";
    statusEl.className = "call__status call__status--active";
  }
  hasSpoken = true;
  if (vadSilenceTimer) {
    clearTimeout(vadSilenceTimer);
    vadSilenceTimer = null;
  }
}

function finishTurn(): void {
  if (currentState !== "LISTENING") return;
  console.log("[Call] Finishing turn, sending to agent");
  if (vadSilenceTimer) {
    clearTimeout(vadSilenceTimer);
    vadSilenceTimer = null;
  }
  hasSpoken = false;
  statusEl.textContent = "In Call · Processing speech...";
  statusEl.className = "call__status call__status--active";
  window.call?.turnEnd();
}

async function startMicrophone(): Promise<void> {
  // Guard against double-init (can be called from both init() and onState("LISTENING"))
  if (micStream) return;
  try {
    // Acquire microphone without rigid sampleRate constraints (prevents OverconstrainedError on Windows)
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      // Generic audio fallback
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }

    const source = audioContext.createMediaStreamSource(micStream);

    // AnalyserNode for frequency VAD + waveform visual display
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    analyserData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);

    // Capture PCM frames using ScriptProcessorNode
    const bufferSize = 2048;
    const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (currentState !== "LISTENING") return;
      const input = e.inputBuffer.getChannelData(0);

      // 1. RMS Energy Calculation
      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);
      if (rms >= rmsThreshold) {
        onSpeechDetected(rms);
      }

      // 2. Resample to 16kHz PCM Int16
      const sampleRate = audioContext?.sampleRate || 48000;
      const pcm16 = downsampleTo16k(input, sampleRate);
      window.call?.sendAudioFrame(pcm16.buffer);
    };

    source.connect(processor);
    // Connect through a zero-gain node so no microphone echo is played out through speakers
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);

    scriptProcessor = processor;
    muteGainNode = muteGain;

    console.log("[Call] Microphone started successfully, sampleRate:", audioContext.sampleRate, "state:", audioContext.state);
    statusEl.textContent = "In Call · Mic Active";
    statusEl.className = "call__status call__status--active";
    startVAD();

    // Optional Web Speech API for real-time speech preview if Chromium supports it
    try {
      type SpeechRecognitionType = new () => {
        continuous: boolean;
        interimResults: boolean;
        onresult: (event: { resultIndex: number; results: Array<Array<{ transcript: string }>> }) => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      };
      const SpeechRec = ((window as unknown as Record<string, unknown>).SpeechRecognition
        || (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as SpeechRecognitionType | undefined;

      if (SpeechRec && !speechRecognizer) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i]?.[0]) {
              interim += event.results[i][0].transcript;
            }
          }
          if (interim.trim()) {
            currentUserText = interim.trim();
            renderTranscript(currentUserText, "");
          }
        };
        rec.onerror = () => { /* ignore; backend ASR takes over on turnEnd */ };
        rec.start();
        speechRecognizer = rec;
      }
    } catch { /* ignore */ }
  } catch (err) {
    console.error("[Call] Failed to start microphone:", err);
    const msg = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Mic Error: ${msg}`;
    statusEl.className = "call__status call__status--error";
    window.call?.onError({ message: `Microphone error: ${msg}` });
  }
}

/** VAD silence detection: N consecutive ms below threshold marks end of speech */
function startVAD(): void {
  let logCounter = 0;
  setInterval(() => {
    if (!analyser || !analyserData) return;
    if (currentState !== "LISTENING") return;

    if (audioContext && audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }

    analyser.getByteFrequencyData(analyserData);
    // Focus on human vocal frequencies (bins 2..60, approx 125Hz - 3750Hz)
    let sum = 0;
    const binStart = 2;
    const binEnd = Math.min(60, analyserData.length);
    for (let i = binStart; i < binEnd; i++) sum += analyserData[i];
    const avg = sum / (binEnd - binStart) / 255;

    logCounter++;
    if (logCounter % 20 === 0) {
      console.log("[Call VAD] freqAvg=", avg.toFixed(4), "hasSpoken=", hasSpoken);
    }

    if (avg >= vadThreshold) {
      onSpeechDetected(avg);
    } else if (hasSpoken) {
      // Silence after speaking: start countdown
      if (!vadSilenceTimer) {
        vadSilenceTimer = setTimeout(() => {
          console.log("[Call VAD] Silence threshold reached, finishing turn");
          finishTurn();
        }, vadSilenceMs);
      }
    }
  }, 100);
}

function stopMicrophone(): void {
  if (speechRecognizer) {
    try { (speechRecognizer as { stop: () => void }).stop(); } catch {}
    speechRecognizer = null;
  }
  if (vadSilenceTimer) { clearTimeout(vadSilenceTimer); vadSilenceTimer = null; }
  if (scriptProcessor) { try { scriptProcessor.disconnect(); } catch {} scriptProcessor = null; }
  if (muteGainNode) { try { muteGainNode.disconnect(); } catch {} muteGainNode = null; }
  if (workletNode) { try { (workletNode as AudioNode).disconnect(); } catch { /* ignore */ } workletNode = null; }
  if (analyser) { try { analyser.disconnect(); } catch { /* ignore */ } analyser = null; }
  if (audioContext) { try { void audioContext.close(); } catch { /* ignore */ } audioContext = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}

// ── TTS Playback + Live2D Mouth Sync ──
// Audio playback syncs with pet window mouth movement via live2dSpeech IPC.
const AUDIO_MOUTH_DELAY_MS = 800;

let currentAudio: HTMLAudioElement | null = null;
let speechToken = 0;

function nextSpeechToken(): number {
  speechToken += 1;
  return speechToken;
}

/** Stops mouth sync (on hangup, new TTS, or error). */
function stopLive2dMouth(): void {
  speechToken += 1;
  window.live2dSpeech?.stopMouth();
}

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<number | null> {
  return new Promise((resolve) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      resolve(audio.duration);
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    const onError = () => {
      cleanup();
      resolve(null);
    };
    audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

function playTtsAudio(base64: string, format?: string): void {
  // Stop previous audio and mouth sync
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  stopLive2dMouth();

  const token = nextSpeechToken();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Sniff MIME type from magic bytes to guarantee accurate audio decoding
  let mime = "audio/wav";
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    mime = "audio/wav";
  } else if (
    (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    mime = "audio/mpeg";
  } else if (format === "mp3") {
    mime = "audio/mpeg";
  } else {
    mime = "audio/wav";
  }

  const blob = new Blob([bytes.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";
  currentAudio = audio;

  // Reset expression, prepare mouth sync
  window.live2dSpeech?.prepare();

  let fallbackAttempted = false;
  const tryWebAudioFallback = async () => {
    if (fallbackAttempted || speechToken !== token) return;
    fallbackAttempted = true;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      if (speechToken !== token) {
        void ctx.close().catch(() => {});
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const durationMs = Math.round(audioBuffer.duration * 1000);
      window.live2dSpeech?.prepare();
      if (durationMs > AUDIO_MOUTH_DELAY_MS) {
        window.setTimeout(() => {
          if (speechToken === token) window.live2dSpeech?.startMouth(durationMs - AUDIO_MOUTH_DELAY_MS);
        }, AUDIO_MOUTH_DELAY_MS);
      }

      source.onended = () => {
        if (speechToken === token) stopLive2dMouth();
        void ctx.close().catch(() => {});
        window.call?.ttsDone();
      };
      source.start(0);
      console.info("[Call] Playing audio via Web Audio API fallback");
    } catch (fbErr) {
      console.error("[Call] Web Audio API fallback failed:", fbErr);
      if (speechToken === token) stopLive2dMouth();
      window.call?.ttsDone();
    }
  };

  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    if (speechToken === token) stopLive2dMouth();
    window.call?.ttsDone();
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    console.warn("[Call] HTMLAudioElement error, attempting Web Audio API fallback...");
    void tryWebAudioFallback();
  };
  audio.play().catch((playErr) => {
    console.warn("[Call] HTMLAudioElement play rejected, attempting Web Audio API fallback:", playErr);
    void tryWebAudioFallback();
  });

  // Wait for audio metadata duration, drive mouth after delay
  void (async () => {
    const durationSec = await waitForAudioMetadata(audio);
    if (speechToken !== token || fallbackAttempted) return;
    const durationMs = durationSec === null ? 0 : Math.max(0, durationSec * 1000 - AUDIO_MOUTH_DELAY_MS);
    window.setTimeout(() => {
      if (speechToken !== token || fallbackAttempted) return;
      if (durationMs > 0) window.live2dSpeech?.startMouth(durationMs);
    }, AUDIO_MOUTH_DELAY_MS);
  })();
}

function stopTts(): void {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  stopLive2dMouth();
}

// ── IPC Event Listeners ──
window.call?.onState((state: string) => {
  setState(state as CallState);
  if (state === "LISTENING" && !micStream) {
    void startMicrophone();
  }
});

window.call?.onAsrResult((data: { partial?: string; final?: string }) => {
  if (data.partial) {
    currentUserText = data.partial;
    renderTranscript(currentUserText, "");
  }
  if (data.final) {
    currentUserText = data.final;
    renderTranscript(currentUserText, "");
  }
});

window.call?.onTtsAudio((data: { base64: string; format?: "wav" | "mp3" | "pcm"; text?: string }) => {
  renderTranscript(currentUserText, data.text || "(Voice replying...)");
  playTtsAudio(data.base64, data.format);
});

window.call?.onError((data: { message: string }) => {
  statusEl.textContent = data.message;
  statusEl.className = "call__status call__status--error";
});

// ── Hangup ──
function hangup(): void {
  window.call?.stop();
  stopMicrophone();
  stopTts();
  stopCallTimer();
  setState("ENDED");
  setTimeout(() => window.close(), 500);
}

hangupBtn.addEventListener("click", hangup);
closeBtn.addEventListener("click", hangup);

if (quickForm && quickInput) {
  quickForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = quickInput.value.trim();
    if (!text) return;
    quickInput.value = "";
    currentUserText = text;
    renderTranscript(currentUserText, "");
    window.call?.submitText(text);
  });
}

// ── Initialization ──
async function init(): Promise<void> {
  // User gesture listeners to guarantee AudioContext is never blocked/suspended
  window.addEventListener("pointerdown", () => {
    if (audioContext && audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }
  });
  window.addEventListener("keydown", () => {
    if (audioContext && audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }
  });

  // ── CRITICAL: Start call session FIRST, before any async operations. ──
  // If this is called after an await, a thrown exception or a slow IPC response
  // would prevent start() from being reached and leave the UI stuck at "Connecting...".
  window.call?.start();

  // Read ASR settings asynchronously (after session start to avoid blocking)
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg) {
      vadSilenceMs = typeof cfg.asrVadSilenceMs === "number" ? cfg.asrVadSilenceMs : 1100;
      vadThreshold = typeof cfg.asrVadThreshold === "number" ? Math.min(Number(cfg.asrVadThreshold), 0.005) : 0.004;
      showTranscript = typeof cfg.asrShowTranscript === "boolean" ? cfg.asrShowTranscript : true;
    }
    console.log("[Call] VAD config: threshold=", vadThreshold, "silenceMs=", vadSilenceMs);
  } catch { /* ignore */ }

  // Particle background
  if (canvas && ctx) {
    resizeParticles();
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(spawnParticle());
    requestAnimationFrame(drawParticles);
    window.addEventListener("resize", resizeParticles);
  }

  // Waveform canvas
  initWaveformCanvas();
  requestAnimationFrame(drawWaveform);
  requestAnimationFrame(animateMicWave);

  // Allow clicking on capsule mic-wave or avatar to immediately finish speaking
  if (micWaveEl) {
    micWaveEl.style.cursor = "pointer";
    micWaveEl.setAttribute("title", "Click to finish speaking (or press Space)");
    micWaveEl.addEventListener("click", () => {
      finishTurn();
    });
  }

  // Fix: use ringEl (the declared variable), not the undeclared avatarRing
  if (ringEl) {
    ringEl.style.cursor = "pointer";
    ringEl.setAttribute("title", "Click to finish speaking (or press Space)");
    ringEl.addEventListener("click", () => {
      finishTurn();
    });
  }

  // Spacebar shortcut to finish speaking turn
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "Space" && document.activeElement !== quickInput) {
      e.preventDefault();
      finishTurn();
    }
  });

  // Start microphone (also started via onState("LISTENING") but guarded by micStream check)
  void startMicrophone();
}

void init();

// Window type declarations
declare global {
  interface Window {
    call?: {
      start: () => void;
      sendAudioFrame: (frame: ArrayBuffer) => void;
      turnEnd: () => void;
      submitText: (text: string) => void;
      ttsDone: () => void;
      stop: () => void;
      onState: (callback: (state: string) => void) => () => void;
      onAsrResult: (callback: (data: { partial?: string; final?: string }) => void) => () => void;
      onTtsAudio: (callback: (data: { base64: string; format?: "wav" | "mp3" | "pcm"; text?: string }) => void) => () => void;
      onError: (callback: (data: { message: string }) => void) => () => void;
    };
    tts?: {
      loadSettings: () => Promise<Record<string, unknown>>;
    };
    live2dSpeech?: {
      prepare: () => void;
      startMouth: (durationMs: number) => void;
      stopMouth: () => void;
    };
  }
}
