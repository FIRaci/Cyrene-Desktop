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
let showTranscript = false; // Read from settings

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
let vadThreshold = 0.01; // Volume threshold, low default for quiet environments
let hasSpoken = false; // Whether user has started speaking (VAD detects silence only after speech)

async function startMicrophone(): Promise<void> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule(new URL("./pcm-processor.js", import.meta.url));

    const source = audioContext.createMediaStreamSource(micStream);

    // AnalyserNode for VAD + waveform display
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);

    // AudioWorkletNode for PCM capture
    workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
    workletNode.port.onmessage = (e: MessageEvent) => {
      const frame = e.data as ArrayBuffer;
      window.call?.sendAudioFrame(frame);
    };
    source.connect(workletNode);
    // workletNode not connected to destination (no local playback needed)

    console.log("[Call] Microphone started");
    startVAD();
  } catch (err) {
    console.error("[Call] Failed to start microphone:", err);
    statusEl.textContent = "Cannot access microphone. Please check permissions.";
    statusEl.className = "call__status call__status--error";
  }
}

/** VAD silence detection: N consecutive ms below threshold marks end of speech */
function startVAD(): void {
  let logCounter = 0;
  const checkInterval = setInterval(() => {
    if (!analyser || !analyserData) return;
    if (currentState !== "LISTENING") return;

    analyser.getByteFrequencyData(analyserData);
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) sum += analyserData[i];
    const avg = sum / analyserData.length / 255;

    logCounter++;
    if (logCounter % 10 === 0) {
      console.log("[Call VAD] volume=", avg.toFixed(4), "threshold=", vadThreshold, "hasSpoken=", hasSpoken);
    }

    if (avg >= vadThreshold) {
      // Sound detected: mark speaking started, reset silence timer
      if (!hasSpoken) console.log("[Call VAD] Speech start detected, volume=", avg.toFixed(4));
      hasSpoken = true;
      if (vadSilenceTimer) {
        clearTimeout(vadSilenceTimer);
        vadSilenceTimer = null;
      }
    } else if (hasSpoken) {
      // Silence after speaking: start silence countdown
      if (!vadSilenceTimer) {
        console.log("[Call VAD] Silence started, preparing to end turn");
        vadSilenceTimer = setTimeout(() => {
          console.log("[Call] VAD silence detected, ending turn");
          window.call?.turnEnd();
          vadSilenceTimer = null;
          hasSpoken = false;
        }, vadSilenceMs);
      }
    }
  }, 100);
}

function stopMicrophone(): void {
  if (vadSilenceTimer) { clearTimeout(vadSilenceTimer); vadSilenceTimer = null; }
  if (workletNode) { try { workletNode.disconnect(); } catch { /* ignore */ } workletNode = null; }
  if (analyser) { try { analyser.disconnect(); } catch { /* ignore */ } analyser = null; }
  if (audioContext) { try { audioContext.close(); } catch { /* ignore */ } audioContext = null; }
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

function playTtsAudio(base64: string): void {
  // Stop previous audio and mouth sync
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  stopLive2dMouth();

  const token = nextSpeechToken();
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  currentAudio = audio;

  // Reset expression, prepare mouth sync
  window.live2dSpeech?.prepare();

  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    if (speechToken === token) stopLive2dMouth();
    window.call?.ttsDone();
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    if (speechToken === token) stopLive2dMouth();
    window.call?.ttsDone();
  };
  audio.play().catch(() => {
    if (speechToken === token) stopLive2dMouth();
    window.call?.ttsDone();
  });

  // Wait for audio metadata duration, drive mouth after delay
  void (async () => {
    const durationSec = await waitForAudioMetadata(audio);
    if (speechToken !== token) return;
    const durationMs = durationSec === null ? 0 : Math.max(0, durationSec * 1000 - AUDIO_MOUTH_DELAY_MS);
    window.setTimeout(() => {
      if (speechToken !== token) return;
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

window.call?.onTtsAudio((data: { base64: string }) => {
  renderTranscript(currentUserText, "(Voice replying...)");
  playTtsAudio(data.base64);
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
  // Read ASR settings (VAD threshold + transcript switch)
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg) {
      vadSilenceMs = typeof cfg.asrVadSilenceMs === "number" ? cfg.asrVadSilenceMs : 1000;
      vadThreshold = typeof cfg.asrVadThreshold === "number" ? cfg.asrVadThreshold : 0.01;
      showTranscript = Boolean(cfg.asrShowTranscript);
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

  // Start call
  window.call?.start();
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
      onTtsAudio: (callback: (data: { base64: string }) => void) => () => void;
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
