import "../ui/base.css";
import "./log.css";
import "../ui/theme";

interface LogEntry {
  id?: string;
  timestamp: number;
  type: "user" | "reasoning" | "response" | "tool" | "error" | "system";
  text: string;
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

// Autoscroll toggle
autoScrollBtn?.addEventListener("click", () => {
  autoScroll = !autoScroll;
  autoScrollBtn.classList.toggle("is-active", autoScroll);
  autoScrollBtn.textContent = autoScroll ? "⬇️ Auto-scroll" : "⏸️ Paused";
});

// Clear
clearBtn?.addEventListener("click", () => {
  entries.length = 0;
  renderList();
  updateCounts();
});

// Copy visible logs
copyBtn?.addEventListener("click", async () => {
  const visibleEntries = getFilteredEntries();
  const text = visibleEntries
    .map((e) => `[${formatTime(e.timestamp)}] [${e.type.toUpperCase()}] ${e.text}`)
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => {
      copyBtn.textContent = "📋 Copy";
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
    if (searchQuery && !entry.text.toLowerCase().includes(searchQuery)) return false;
    return true;
  });
}

function updateCounts(): void {
  const counts = {
    all: entries.length,
    reasoning: 0,
    response: 0,
    tool: 0,
    error: 0,
  };
  for (const e of entries) {
    if (e.type in counts) {
      counts[e.type as keyof typeof counts] += 1;
    }
  }
  countEls.all.textContent = String(counts.all);
  countEls.reasoning.textContent = String(counts.reasoning);
  countEls.response.textContent = String(counts.response);
  countEls.tool.textContent = String(counts.tool);
  countEls.error.textContent = String(counts.error);
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
  if (entries.length > 500) {
    entries.shift();
  }
  updateCounts();

  const matchesFilter = currentFilter === "all" || entry.type === currentFilter;
  const matchesSearch = !searchQuery || entry.text.toLowerCase().includes(searchQuery);

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
