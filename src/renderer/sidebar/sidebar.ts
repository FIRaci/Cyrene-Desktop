import "../ui/base.css";
import "./sidebar.css";
import "../ui/theme";

interface ModelConfig {
  mode: "auto" | "manual";
  provider: string;
  displayName?: string;
  shortName: string;
  model: string;
  connected: boolean;
  runtimeSync: "off" | "local" | "llm";
}

interface ModelConfigApi {
  get: () => Promise<ModelConfig>;
  onChanged: (callback: (config: ModelConfig) => void) => () => void;
}

type RuntimeStatus = "Accompanying" | "Thinking" | "Working" | "Listening" | "Reminding" | "Offline";
type RuntimeFeeling = "Calm" | "Happy" | "Gentle" | "Excited" | "Coy" | "Worried" | "Sad" | "Touched" | "Shy";

interface RuntimeState {
  status: RuntimeStatus;
  feeling: RuntimeFeeling;
  expression: number;
}

interface RuntimeStateApi {
  get: () => Promise<RuntimeState>;
  onChanged: (callback: (state: RuntimeState) => void) => () => void;
}

interface SidebarApi {
  minimize: () => void;
  close: () => void;
  toggleAlwaysOnTop: () => Promise<boolean>;
  openTasks: () => void;
  openSettings: (section?: string) => void;
  openCall: () => void;
}

declare global {
  interface Window {
    sidebar?: SidebarApi;
    modelConfig?: ModelConfigApi;
    runtimeState?: RuntimeStateApi;
  }
}

// Fallback no-op when preload is absent, allowing sidebar debugging directly in browser
if (!window.sidebar) {
  (window as unknown as { sidebar: SidebarApi }).sidebar = {
    minimize: () => {},
    close: () => {},
    toggleAlwaysOnTop: () => Promise.resolve(false),
    openTasks: () => {},
    openSettings: (_section?: string) => {},
    openCall: () => {},
  };
}

const root = document.querySelector(".sidebar") as HTMLElement | null;
const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const pinBtn = document.getElementById("pin-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const modelSwitchBtn = document.getElementById("model-switch-btn") as HTMLButtonElement;
const openChatBtn = document.getElementById("open-chat-btn") as HTMLButtonElement;
const callBtn = document.getElementById("call-btn") as HTMLButtonElement;
const onlineStatusLabel = document.getElementById("online-status-label") as HTMLElement;
const statusEmojiEl = document.getElementById("status-emoji") as HTMLElement;
const statusLabelEl = document.getElementById("status-label") as HTMLElement;
const feelingEmojiEl = document.getElementById("feeling-emoji") as HTMLElement;
const feelingLabelEl = document.getElementById("feeling-label") as HTMLElement;
const feedingModelEl = document.getElementById("feeding-model") as HTMLElement;
const onlineBadge = onlineStatusLabel.closest(".profile__online") as HTMLElement | null;
let runtimeSyncEnabled = false;
let latestRuntimeState: RuntimeState | null = null;

const STATUS_ICON: Record<RuntimeStatus, string> = {
  Accompanying: "../status/accompanying.png",
  Thinking: "../status/thinking.png",
  Working: "../status/working.png",
  Listening: "../status/listening.png",
  Reminding: "../status/reminder.png",
  Offline: "../status/offline.png",
};

const FEELING_ICON: Record<RuntimeFeeling, string> = {
  Calm: "../feeling/calm.png",
  Happy: "../feeling/happy.png",
  Gentle: "../feeling/gentle.png",
  Excited: "../feeling/excited.png",
  Coy: "../feeling/coquettish.png",
  Worried: "../feeling/worried.png",
  Sad: "../feeling/sad.png",
  Touched: "../feeling/touched.png",
  Shy: "../feeling/shy.png",
};

const statusCardEl = document.querySelector(".panel-card--status") as HTMLElement | null;
const feelingCardEl = document.querySelector(".panel-card--feeling") as HTMLElement | null;

function applyRuntimeState(state: RuntimeState | null): void {
  latestRuntimeState = state;
  const status = state?.status ?? "Accompanying";
  const feeling = state?.feeling ?? "Calm";
  const statusIcon = STATUS_ICON[status] ?? STATUS_ICON["Accompanying"];
  const feelingIcon = FEELING_ICON[feeling] ?? FEELING_ICON["Calm"];
  statusEmojiEl.innerHTML = `<img src="${statusIcon}" alt="${status}" width="48" height="48" />`;
  statusLabelEl.textContent = status;
  feelingEmojiEl.innerHTML = `<img src="${feelingIcon}" alt="${feeling}" width="48" height="48" />`;
  feelingLabelEl.textContent = feeling;
}

async function initRuntimeState(): Promise<void> {
  try {
    const state = await window.runtimeState?.get();
    applyRuntimeState(state ?? null);
  } catch {
    applyRuntimeState(null);
  }
  window.runtimeState?.onChanged((state) => applyRuntimeState(state));
}

function applyModelConfig(config: ModelConfig | null): void {
  const connected = Boolean(config?.connected);
  runtimeSyncEnabled = config?.runtimeSync === "local" || config?.runtimeSync === "llm";
  onlineStatusLabel.textContent = connected ? "Online" : "Offline";
  onlineBadge?.classList.toggle("is-offline", !connected);
  // Display priority: user nickname > vendor short name > model id > fallback
  feedingModelEl.textContent = config?.displayName || config?.shortName || config?.model || "Model not selected";
  applyRuntimeState(latestRuntimeState);
}

async function initModelConfig(): Promise<void> {
  try {
    const config = await window.modelConfig?.get();
    applyModelConfig(config ?? null);
  } catch {
    applyModelConfig(null);
  }
  window.modelConfig?.onChanged((config) => applyModelConfig(config));
}
// Always On Top toggle: click pin to toggle alwaysOnTop; button highlight reflects active state.
pinBtn.addEventListener("click", async () => {
  const pinned = await window.sidebar?.toggleAlwaysOnTop();
  const isPinned = Boolean(pinned);
  pinBtn.classList.toggle("is-active", isPinned);
  pinBtn.setAttribute("aria-label", isPinned ? "Cancel Always On Top" : "Always On Top");
  pinBtn.setAttribute("title", isPinned ? "Cancel Always On Top" : "Always On Top");
});

minBtn.addEventListener("click", () => {
  window.sidebar?.minimize();
});

closeBtn.addEventListener("click", () => {
  window.sidebar?.close();
});

settingsBtn.addEventListener("click", () => {
  window.sidebar?.openSettings();
});

statusCardEl?.addEventListener("click", () => {
  window.sidebar?.openSettings("api");
});
statusCardEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    window.sidebar?.openSettings("api");
  }
});

feelingCardEl?.addEventListener("click", () => {
  window.sidebar?.openSettings("api");
});
feelingCardEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    window.sidebar?.openSettings("api");
  }
});

modelSwitchBtn.addEventListener("click", () => {
  // "Switch Model" navigates directly to the API configuration tab instead of default general tab
  window.sidebar?.openSettings("api");
});

callBtn.addEventListener("click", () => {
  window.sidebar?.openCall();
});

// "Open Chat": retrieve latest session ID, open chat window and load it in main process;
// if no sessions exist, create one first to ensure button always enters a concrete session.
openChatBtn.addEventListener("click", async () => {
  const chatStore = (window as unknown as {
    chatStore?: {
      list: () => Promise<Array<{ id: string }>>;
      create: (payload?: { identityId?: string | null }) => Promise<{ id: string } | null>;
      openInChatWindow: (sessionId: string) => Promise<unknown>;
    };
  }).chatStore;
  if (!chatStore) return;
  try {
    const list = await chatStore.list();
    let latestId = list.length > 0 ? list[0].id : "";
    if (!latestId) {
      const created = await chatStore.create({ identityId: null });
      latestId = created?.id ?? "";
    }
    if (latestId) await chatStore.openInChatWindow(latestId);
  } catch (err) {
    console.warn("[sidebar] Failed to open chat:", err);
  }
});

void initModelConfig();
void initRuntimeState();
