import "../ui/base.css";
import "./log.css";
import "../ui/theme";

interface LogEntry {
  id?: string;
  timestamp: number;
  type: "user" | "reasoning" | "response" | "tool" | "error" | "system" | "kaomoji";
  text: string;
  channel?: string;
  meta?: unknown;
}

const entries: LogEntry[] = [];
let currentFilter: string = "all";
let searchQuery: string = "";
let autoScroll: boolean = true;

const container = document.getElementById("log-container") as HTMLElement;
const listEl = document.getElementById("log-list") as HTMLElement;
const emptyEl = document.getElementById("log-empty") as HTMLElement;
const searchInput = document.getElementById("log-search") as HTMLInputElement;
const copyBtn = document.getElementById("copy-btn") as HTMLButtonElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const autoScrollBtn = document.getElementById("autoscroll-btn") as HTMLButtonElement;
const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const statusEl = document.getElementById("log-status") as HTMLElement;

const countEls = {
  all: document.getElementById("count-all") as HTMLElement,
  reasoning: document.getElementById("count-reasoning") as HTMLElement,
  response: document.getElementById("count-response") as HTMLElement,
  user: document.getElementById("count-user") as HTMLElement,
  kaomoji: document.getElementById("count-kaomoji") as HTMLElement,
  tool: document.getElementById("count-tool") as HTMLElement,
  error: document.getElementById("count-error") as HTMLElement,
};

// Window actions
minBtn?.addEventListener("click", () => window.activityLog?.minimize());
closeBtn?.addEventListener("click", () => window.activityLog?.close());

// Filter pills
document.querySelectorAll<HTMLButtonElement>(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    currentFilter = btn.dataset.filter ?? "all";
    renderList();
  });
});

// Search
searchInput?.addEventListener("input", () => {
  searchQuery = searchInput.value.toLowerCase().trim();
  renderList();
});

const SVG_COPY = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const SVG_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const SVG_AUTOSCROLL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"></path><polyline points="7 11 12 16 17 11"></polyline><line x1="4" y1="21" x2="20" y2="21"></line></svg>`;
const SVG_PAUSE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;

function setButtonContent(btn: HTMLButtonElement | null, iconSvg: string, label: string): void {
  if (!btn) return;
  const iconEl = btn.querySelector<HTMLElement>(".action-btn__icon");
  const labelEl = btn.querySelector<HTMLElement>(".action-btn__label");
  if (iconEl && labelEl) {
    iconEl.innerHTML = iconSvg;
    labelEl.textContent = label;
  } else {
    btn.innerHTML = `<span class="action-btn__icon" aria-hidden="true">${iconSvg}</span><span class="action-btn__label">${label}</span>`;
  }
}

// Autoscroll toggle
autoScrollBtn?.addEventListener("click", () => {
  autoScroll = !autoScroll;
  autoScrollBtn.classList.toggle("is-active", autoScroll);
  setButtonContent(
    autoScrollBtn,
    autoScroll ? SVG_AUTOSCROLL : SVG_PAUSE,
    autoScroll ? "Auto-scroll" : "Paused"
  );
});

// Clear (purges both renderer items and main process buffer to release RAM)
clearBtn?.addEventListener("click", async () => {
  entries.length = 0;
  renderList();
  updateCounts();
  if (window.activityLog?.clear) {
    try {
      await window.activityLog.clear();
    } catch (err) {
      console.warn("Failed to clear main activity log buffer:", err);
    }
  }
  if (statusEl) {
    statusEl.textContent = "Log cleared · Memory purged";
  }
});

// Listen for broadcast clear
window.activityLog?.onCleared?.(() => {
  entries.length = 0;
  renderList();
  updateCounts();
  if (statusEl) {
    statusEl.textContent = "Log cleared · Memory purged";
  }
});

// Copy visible logs
copyBtn?.addEventListener("click", async () => {
  const visibleEntries = getFilteredEntries();
  const text = visibleEntries
    .map((e) => {
      const ch = e.channel ? ` [${e.channel}]` : "";
      return `[${formatTime(e.timestamp)}] [${e.type.toUpperCase()}]${ch} ${e.text}`;
    })
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    setButtonContent(copyBtn, SVG_CHECK, "Copied!");
    copyBtn.classList.add("is-success");
    setTimeout(() => {
      setButtonContent(copyBtn, SVG_COPY, "Copy");
      copyBtn.classList.remove("is-success");
    }, 1500);
  } catch (err) {
    console.warn("Clipboard copy failed:", err);
  }
});

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function getFilteredEntries(): LogEntry[] {
  return entries.filter((entry) => {
    if (currentFilter !== "all" && entry.type !== currentFilter) return false;
    if (searchQuery) {
      const matchText = entry.text.toLowerCase().includes(searchQuery);
      const matchChannel = entry.channel ? entry.channel.toLowerCase().includes(searchQuery) : false;
      if (!matchText && !matchChannel) return false;
    }
    return true;
  });
}

function updateCounts(): void {
  const counts = {
    all: entries.length,
    reasoning: 0,
    response: 0,
    user: 0,
    kaomoji: 0,
    tool: 0,
    error: 0,
  };
  for (const e of entries) {
    if (e.type in counts) {
      counts[e.type as keyof typeof counts] += 1;
    }
  }
  if (countEls.all) countEls.all.textContent = String(counts.all);
  if (countEls.reasoning) countEls.reasoning.textContent = String(counts.reasoning);
  if (countEls.response) countEls.response.textContent = String(counts.response);
  if (countEls.user) countEls.user.textContent = String(counts.user);
  if (countEls.kaomoji) countEls.kaomoji.textContent = String(counts.kaomoji);
  if (countEls.tool) countEls.tool.textContent = String(counts.tool);
  if (countEls.error) countEls.error.textContent = String(counts.error);
}

function createLogCard(entry: LogEntry): HTMLElement {
  const card = document.createElement("div");
  card.className = "log-item";

  const header = document.createElement("div");
  header.className = "log-item__header";

  const timeSpan = document.createElement("span");
  timeSpan.className = "log-item__time";
  timeSpan.textContent = formatTime(entry.timestamp);

  const badgeSpan = document.createElement("span");
  badgeSpan.className = `log-item__badge badge--${entry.type}`;
  badgeSpan.textContent = entry.type;

  header.appendChild(timeSpan);
  header.appendChild(badgeSpan);

  if (entry.channel) {
    const channelSpan = document.createElement("span");
    channelSpan.className = "log-item__channel";
    channelSpan.textContent = entry.channel;
    channelSpan.title = `Source: ${entry.channel}`;
    header.appendChild(channelSpan);
  }

  const content = document.createElement("div");
  content.className = "log-item__content";
  content.textContent = entry.text;

  card.appendChild(header);
  card.appendChild(content);
  return card;
}

function renderList(): void {
  const filtered = getFilteredEntries();
  if (filtered.length === 0) {
    listEl.innerHTML = "";
    emptyEl.style.display = "flex";
    return;
  }

  emptyEl.style.display = "none";
  listEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const entry of filtered) {
    frag.appendChild(createLogCard(entry));
  }
  listEl.appendChild(frag);

  if (autoScroll && container) {
    container.scrollTop = container.scrollHeight;
  }
}

function addEntry(entry: LogEntry): void {
  entries.push(entry);
  if (entries.length > 1000) {
    entries.shift();
  }
  updateCounts();

  const matchesFilter = currentFilter === "all" || entry.type === currentFilter;
  const matchesSearch = !searchQuery ||
    entry.text.toLowerCase().includes(searchQuery) ||
    (entry.channel ? entry.channel.toLowerCase().includes(searchQuery) : false);

  if (matchesFilter && matchesSearch) {
    emptyEl.style.display = "none";
    const card = createLogCard(entry);
    listEl.appendChild(card);
    if (autoScroll && container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  if (statusEl) {
    statusEl.textContent = `Live · Last event at ${formatTime(entry.timestamp)}`;
  }
}

// Initial load
void window.activityLog?.getEntries().then((history) => {
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && typeof h.text === "string") {
        entries.push(h as LogEntry);
      }
    }
    updateCounts();
    renderList();
  }
});

// Live updates
window.activityLog?.onEntry((entry) => {
  if (entry && typeof (entry as LogEntry).text === "string") {
    addEntry(entry as LogEntry);
  }
});
