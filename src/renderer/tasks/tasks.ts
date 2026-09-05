import "../ui/base.css";
import "./tasks.css";
import "../ui/theme";
import { showAlert } from "../ui/modal";
import {
  getWeekDays,
  getTasksForCalendarDay,
  inferTaskCategory,
  isSameLocalDay,
  TASK_CATEGORIES,
  type ScheduledTask,
  type TaskCategory,
  type ScheduleConfig,
} from "./task-filter";

// ── Preload Bridge Interfaces ───────────────────────────────
interface SchedulerResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
}

interface WeatherResponse {
  city: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  weatherCode: number;
  weatherText: string;
  weatherIcon: string;
}

declare global {
  interface Window {
    tasks?: {
      minimize: () => void;
      close: () => void;
      onSchedulerChanged?: (callback: () => void) => () => void;
      getWeather?: (city?: string) => Promise<WeatherResponse>;
    };
    cyreneScheduler?: {
      list: () => Promise<SchedulerResult<ScheduledTask[]>>;
      add: (input: unknown) => Promise<SchedulerResult>;
      update: (id: string, patch: unknown) => Promise<SchedulerResult>;
      delete: (id: string) => Promise<SchedulerResult>;
      toggle: (id: string, enabled: boolean) => Promise<SchedulerResult>;
      fireNow: (id: string) => Promise<SchedulerResult>;
    };
    schedulerEvents?: {
      onEvent: (cb: (event: unknown) => void) => () => void;
    };
    sidebar?: {
      openSettings: (section?: string) => void;
    };
  }
}

// Fallback if preload bridge is missing
if (!window.tasks) {
  (window as unknown as { tasks: { minimize: () => void; close: () => void } }).tasks = {
    minimize: () => {},
    close: () => {},
  };
}

// ── Constants ────────────────────────────────────────────────
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const POLL_INTERVAL_MS = 30_000;

// ── DOM Helper ───────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

// ── Application State ────────────────────────────────────────
let selectedDate: Date = new Date();
let weekAnchor: Date = new Date();
let selectedCategory: TaskCategory | "all" = "all";
let allTasks: ScheduledTask[] = [];

// ── Date Formatting Helpers ──────────────────────────────────
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatFullDateTime(d: Date): string {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function updateLiveClock(): void {
  const now = new Date();
  const clockEl = $("schedule-clock");
  const weekdayEl = $("schedule-weekday");
  const isSelectedToday = isSameLocalDay(selectedDate, now);
  const tagEl = $("schedule-date-tag");

  if (clockEl) {
    clockEl.textContent = formatFullDateTime(now);
  }
  if (weekdayEl) {
    weekdayEl.textContent = WEEKDAYS_FULL[now.getDay()];
  }
  if (tagEl) {
    if (isSelectedToday) {
      tagEl.style.display = "none";
    } else {
      tagEl.style.display = "inline-block";
      const selDd = pad2(selectedDate.getDate());
      const selMm = pad2(selectedDate.getMonth() + 1);
      const selYyyy = selectedDate.getFullYear();
      tagEl.textContent = `Viewing: ${selDd}/${selMm}/${selYyyy}`;
    }
  }
}

async function loadHanoiWeather(): Promise<void> {
  const tempEl = $("weather-temp");
  const iconEl = $("weather-icon");
  const descEl = $("weather-desc");
  const chipEl = $("schedule-weather");

  try {
    const data = await window.tasks?.getWeather?.("Hanoi");
    if (data) {
      if (tempEl) tempEl.textContent = `${data.temperature}°C`;
      if (iconEl) iconEl.textContent = data.weatherIcon || "⛅";
      if (descEl) descEl.textContent = data.weatherText || "Clear";
      if (chipEl) {
        const hum = typeof data.humidity === "number" ? `, Humidity ${data.humidity}%` : "";
        const feels = typeof data.apparentTemperature === "number" ? `, Feels like ${data.apparentTemperature}°C` : "";
        chipEl.title = `Hanoi: ${data.temperature}°C (${data.weatherText})${hum}${feels}`;
      }
    }
  } catch (err) {
    console.warn("[Tasks] Failed to load Hanoi weather:", err);
  }
}

function formatTimeOfDay(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getTaskTimeString(task: ScheduledTask): string {
  if (task.schedule.timeOfDay) {
    return task.schedule.timeOfDay;
  }
  if (task.schedule.runAt) {
    const d = new Date(task.schedule.runAt);
    if (!Number.isNaN(d.getTime())) return formatTimeOfDay(d);
  }
  if (task.nextFireAt) {
    const d = new Date(task.nextFireAt);
    if (!Number.isNaN(d.getTime())) return formatTimeOfDay(d);
  }
  return "--:--";
}

// ── Rendering: Top Summary & Calendar Headers ─────────────────
function renderHeaders(): void {
  const now = new Date();
  const isSelectedToday = isSameLocalDay(selectedDate, now);
  updateLiveClock();

  const dateEl = $("schedule-date");
  if (dateEl) {
    const month = selectedDate.toLocaleString("en-US", { month: "short" });
    const day = selectedDate.getDate();
    const year = selectedDate.getFullYear();
    const weekday = WEEKDAYS_FULL[selectedDate.getDay()];
    dateEl.textContent = `${month} ${day}, ${year} · ${weekday}${isSelectedToday ? " (Today)" : ""}`;
  }

  const startOfWeek = getWeekDays(weekAnchor)[0];
  const monthSelectEl = $("calendar-month-select") as HTMLSelectElement | null;
  const yearSelectEl = $("calendar-year-select") as HTMLSelectElement | null;
  if (monthSelectEl) {
    monthSelectEl.value = String(startOfWeek.getMonth());
  }
  if (yearSelectEl) {
    const yearStr = String(startOfWeek.getFullYear());
    if (!yearSelectEl.querySelector(`option[value="${yearStr}"]`)) {
      const opt = document.createElement("option");
      opt.value = yearStr;
      opt.textContent = yearStr;
      yearSelectEl.appendChild(opt);
    }
    yearSelectEl.value = yearStr;
  }

  const monthLabelEl = $("calendar-month-label");
  if (monthLabelEl) {
    const monthName = MONTH_NAMES[startOfWeek.getMonth()];
    const year = startOfWeek.getFullYear();
    monthLabelEl.textContent = `${monthName} ${year}`;
  }
}

// ── Rendering: 7-Day Week Strip ───────────────────────────────
function renderWeekStrip(): void {
  const stripEl = $("week-strip");
  if (!stripEl) return;
  stripEl.innerHTML = "";

  const days = getWeekDays(weekAnchor);
  const now = new Date();

  days.forEach((day) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "day-pill";
    pill.setAttribute("role", "tab");

    const isToday = isSameLocalDay(day, now);
    const isSelected = isSameLocalDay(day, selectedDate);

    if (isToday) pill.classList.add("is-today");
    if (isSelected) {
      pill.classList.add("is-selected");
      pill.setAttribute("aria-selected", "true");
    } else {
      pill.setAttribute("aria-selected", "false");
    }

    const dayTasks = getTasksForCalendarDay(allTasks, day);

    const nameSpan = document.createElement("span");
    nameSpan.className = "day-pill__name";
    nameSpan.textContent = WEEKDAYS_SHORT[day.getDay()];

    const numSpan = document.createElement("span");
    numSpan.className = "day-pill__num";
    numSpan.textContent = String(day.getDate());

    const dotsDiv = document.createElement("div");
    dotsDiv.className = "day-pill__dots";

    const dotCount = Math.min(dayTasks.length, 3);
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement("span");
      dot.className = "day-pill__dot";
      dotsDiv.appendChild(dot);
    }

    pill.appendChild(nameSpan);
    pill.appendChild(numSpan);
    pill.appendChild(dotsDiv);

    pill.addEventListener("click", () => {
      selectedDate = new Date(day);
      renderAll();
    });

    stripEl.appendChild(pill);
  });
}

// ── Rendering: Task List ──────────────────────────────────────
function renderTaskList(): void {
  const listEl = $("task-list");
  const countEl = $("schedule-count");
  const countLabelEl = $("schedule-count-label");
  if (!listEl) return;

  const dayTasks = getTasksForCalendarDay(allTasks, selectedDate);
  const totalDayCount = dayTasks.length;

  if (countEl) countEl.textContent = String(totalDayCount);
  if (countLabelEl) {
    countLabelEl.textContent = totalDayCount <= 1 ? "task" : "tasks";
  }

  // Filter by category if one is selected
  const visibleTasks = selectedCategory === "all"
    ? dayTasks
    : dayTasks.filter((t) => inferTaskCategory(t) === selectedCategory);

  listEl.innerHTML = "";

  if (visibleTasks.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "task-empty";

    const icon = document.createElement("div");
    icon.className = "task-empty__icon";
    icon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/></svg>`;

    const title = document.createElement("div");
    title.className = "task-empty__title";
    title.textContent = totalDayCount === 0
      ? "No events on this day"
      : `No ${TASK_CATEGORIES[selectedCategory]?.name ?? ""} tasks`;

    const desc = document.createElement("div");
    desc.className = "task-empty__desc";
    desc.textContent = "Plan your studies, work targets, or meetings for Cyrene to manage.";

    const actions = document.createElement("div");
    actions.className = "task-empty__actions";

    const chips: Array<{ label: string; cat: TaskCategory; placeholder: string }> = [
      { label: "+ Study Class", cat: "study", placeholder: "Math Lecture" },
      { label: "+ Work Sprint", cat: "work", placeholder: "Code Review" },
      { label: "+ Meeting Sync", cat: "meeting", placeholder: "Team Standup" },
    ];

    chips.forEach((chip) => {
      const chipBtn = document.createElement("button");
      chipBtn.type = "button";
      chipBtn.className = "quick-add-chip";
      chipBtn.textContent = chip.label;
      chipBtn.addEventListener("click", () => {
        openAddModal(chip.cat, chip.placeholder);
      });
      actions.appendChild(chipBtn);
    });

    emptyDiv.appendChild(icon);
    emptyDiv.appendChild(title);
    emptyDiv.appendChild(desc);
    emptyDiv.appendChild(actions);
    listEl.appendChild(emptyDiv);
    return;
  }

  // Sort visible tasks chronologically
  visibleTasks.sort((a, b) => {
    const tA = getTaskTimeString(a);
    const tB = getTaskTimeString(b);
    return tA.localeCompare(tB);
  });

  visibleTasks.forEach((task) => {
    const category = inferTaskCategory(task);
    const meta = TASK_CATEGORIES[category];

    const card = document.createElement("div");
    card.className = "task-card";
    if (!task.enabled) card.classList.add("is-disabled");

    // Top row: tags + actions
    const topRow = document.createElement("div");
    topRow.className = "task-card__top";

    const tags = document.createElement("div");
    tags.className = "task-card__tags";

    const timePill = document.createElement("span");
    timePill.className = "task-time-pill";
    timePill.textContent = getTaskTimeString(task);

    const catBadge = document.createElement("span");
    catBadge.className = `category-badge ${meta.badgeClass}`;
    catBadge.innerHTML = `${meta.svgIcon} <span>${meta.name}</span>`;

    tags.appendChild(timePill);
    tags.appendChild(catBadge);

    const actions = document.createElement("div");
    actions.className = "task-card__actions";

    // Fire now button
    const fireBtn = document.createElement("button");
    fireBtn.type = "button";
    fireBtn.className = "task-btn";
    fireBtn.title = "Run now with Cyrene";
    fireBtn.setAttribute("aria-label", `Run ${task.title} now`);
    fireBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    fireBtn.addEventListener("click", async () => {
      try {
        await window.cyreneScheduler?.fireNow(task.id);
      } catch (err) {
        console.error("Failed to fire task:", err);
      }
    });

    // Toggle switch
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "task-toggle";
    toggleLabel.title = task.enabled ? "Disable task" : "Enable task";

    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = task.enabled;
    toggleInput.addEventListener("change", async () => {
      try {
        await window.cyreneScheduler?.toggle(task.id, toggleInput.checked);
        task.enabled = toggleInput.checked;
        card.classList.toggle("is-disabled", !task.enabled);
        renderWeekStrip();
      } catch (err) {
        console.error("Failed to toggle task:", err);
      }
    });

    const toggleSlider = document.createElement("span");
    toggleSlider.className = "task-toggle__slider";

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "task-btn task-btn--delete";
    delBtn.title = "Delete task";
    delBtn.setAttribute("aria-label", `Delete ${task.title}`);
    delBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    delBtn.addEventListener("click", async () => {
      try {
        await window.cyreneScheduler?.delete(task.id);
        allTasks = allTasks.filter((t) => t.id !== task.id);
        renderAll();
      } catch (err) {
        console.error("Failed to delete task:", err);
      }
    });

    actions.appendChild(fireBtn);
    actions.appendChild(toggleLabel);
    actions.appendChild(delBtn);

    topRow.appendChild(tags);
    topRow.appendChild(actions);

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "task-card__title";
    titleEl.textContent = task.title;

    card.appendChild(topRow);
    card.appendChild(titleEl);

    // Prompt note preview
    if (task.prompt && task.prompt !== task.title) {
      const promptEl = document.createElement("div");
      promptEl.className = "task-card__prompt";
      promptEl.textContent = task.prompt;
      card.appendChild(promptEl);
    }

    listEl.appendChild(card);
  });
}

function renderAll(): void {
  renderHeaders();
  renderWeekStrip();
  renderTaskList();
}

// ── Data Fetching ────────────────────────────────────────────
async function loadTasks(): Promise<void> {
  try {
    const res = await window.cyreneScheduler?.list();
    if (res?.ok && Array.isArray(res.value)) {
      allTasks = res.value;
    } else {
      allTasks = [];
    }
  } catch (err) {
    console.warn("[tasks] Failed to load scheduled tasks:", err);
    allTasks = [];
  }
  renderAll();
}

// ── Add Event Modal Management ───────────────────────────────
function openAddModal(defaultCategory: TaskCategory = "study", defaultTitle = ""): void {
  const backdrop = $("add-modal-backdrop");
  if (!backdrop) return;

  setFormCategory(defaultCategory);

  const titleInput = $("task-title-input") as HTMLInputElement | null;
  if (titleInput) {
    titleInput.value = defaultTitle;
    setTimeout(() => titleInput.focus(), 80);
  }

  const timeInput = $("task-time-input") as HTMLInputElement | null;
  if (timeInput) {
    const now = new Date();
    timeInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  const promptInput = $("task-prompt-input") as HTMLTextAreaElement | null;
  if (promptInput) promptInput.value = "";

  backdrop.classList.remove("is-hidden");
}

function closeAddModal(): void {
  const backdrop = $("add-modal-backdrop");
  if (backdrop) backdrop.classList.add("is-hidden");
}

function setFormCategory(cat: TaskCategory): void {
  const catInput = $("task-category-input") as HTMLInputElement | null;
  if (catInput) catInput.value = cat;

  const choicePills = document.querySelectorAll<HTMLButtonElement>(".cat-choice");
  choicePills.forEach((btn) => {
    const isThis = btn.dataset.cat === cat;
    btn.classList.toggle("is-selected", isThis);
  });
}

// ── Event Handlers Setup ─────────────────────────────────────
function setupEventHandlers(): void {
  // Minimize & Close
  $("min-btn")?.addEventListener("click", () => window.tasks?.minimize());
  $("close-btn")?.addEventListener("click", () => window.tasks?.close());

  // Task Settings
  $("settings-btn")?.addEventListener("click", () => window.sidebar?.openSettings("tasks"));

  // Month & Year direct picker
  const monthSelect = $("calendar-month-select") as HTMLSelectElement | null;
  monthSelect?.addEventListener("change", () => {
    const newMonth = Number(monthSelect.value);
    const year = selectedDate.getFullYear();
    const maxDays = new Date(year, newMonth + 1, 0).getDate();
    const day = Math.min(selectedDate.getDate(), maxDays);
    selectedDate = new Date(year, newMonth, day);
    weekAnchor = new Date(selectedDate);
    renderAll();
  });

  const yearSelect = $("calendar-year-select") as HTMLSelectElement | null;
  yearSelect?.addEventListener("change", () => {
    const newYear = Number(yearSelect.value);
    const month = selectedDate.getMonth();
    const maxDays = new Date(newYear, month + 1, 0).getDate();
    const day = Math.min(selectedDate.getDate(), maxDays);
    selectedDate = new Date(newYear, month, day);
    weekAnchor = new Date(selectedDate);
    renderAll();
  });

  // Week navigation
  $("prev-week-btn")?.addEventListener("click", () => {
    weekAnchor.setDate(weekAnchor.getDate() - 7);
    renderAll();
  });

  $("next-week-btn")?.addEventListener("click", () => {
    weekAnchor.setDate(weekAnchor.getDate() + 7);
    renderAll();
  });

  $("today-btn")?.addEventListener("click", () => {
    const now = new Date();
    weekAnchor = new Date(now);
    selectedDate = new Date(now);
    renderAll();
  });

  // Category filters and dropdown
  const filterBtns = document.querySelectorAll<HTMLButtonElement>(".cat-filter");
  const catDropdown = $("category-dropdown-select") as HTMLSelectElement | null;

  const syncCategorySelection = (cat: TaskCategory | "all", scrollIntoView = true): void => {
    selectedCategory = cat;
    if (catDropdown && catDropdown.value !== cat) {
      catDropdown.value = cat;
    }
    filterBtns.forEach((b) => {
      const isActive = (b.dataset.cat || "all") === cat;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive && scrollIntoView) {
        b.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });
    renderTaskList();
  };

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = (btn.dataset.cat as TaskCategory | "all") || "all";
      syncCategorySelection(cat, false);
    });
  });

  catDropdown?.addEventListener("change", () => {
    const cat = (catDropdown.value as TaskCategory | "all") || "all";
    syncCategorySelection(cat, true);
  });

  // Category filters horizontal scroll & drag
  const catFiltersEl = $("category-filters");
  if (catFiltersEl) {
    catFiltersEl.addEventListener("wheel", (e) => {
      if (e.deltaY !== 0) {
        catFiltersEl.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    catFiltersEl.addEventListener("mousedown", (e) => {
      isDown = true;
      startX = e.pageX - catFiltersEl.offsetLeft;
      scrollLeft = catFiltersEl.scrollLeft;
    });

    window.addEventListener("mouseup", () => {
      isDown = false;
    });

    catFiltersEl.addEventListener("mouseleave", () => {
      isDown = false;
    });

    catFiltersEl.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - catFiltersEl.offsetLeft;
      const walk = (x - startX) * 1.5;
      catFiltersEl.scrollLeft = scrollLeft - walk;
    });
  }

  // Add Event Modal triggers
  $("open-add-modal-btn")?.addEventListener("click", () => openAddModal("study"));
  $("close-modal-btn")?.addEventListener("click", closeAddModal);
  $("cancel-add-btn")?.addEventListener("click", closeAddModal);

  // Modal Category Pills
  const catChoices = document.querySelectorAll<HTMLButtonElement>(".cat-choice");
  catChoices.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = (btn.dataset.cat as TaskCategory) || "study";
      setFormCategory(cat);
    });
  });

  // Add Event Form Submission
  const form = $("add-schedule-form") as HTMLFormElement | null;
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const catInput = $("task-category-input") as HTMLInputElement | null;
    const titleInput = $("task-title-input") as HTMLInputElement | null;
    const timeInput = $("task-time-input") as HTMLInputElement | null;
    const repeatSelect = $("task-repeat-select") as HTMLSelectElement | null;
    const promptInput = $("task-prompt-input") as HTMLTextAreaElement | null;
    const saveBtn = $("save-schedule-btn") as HTMLButtonElement | null;

    const cat = (catInput?.value as TaskCategory) || "study";
    const rawTitle = (titleInput?.value ?? "").trim();
    const timeVal = (timeInput?.value ?? "09:00").trim();
    const repeat = repeatSelect?.value ?? "daily";
    const customPrompt = (promptInput?.value ?? "").trim();

    if (!rawTitle) return;

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }

    try {
      const title = `[${cat.toUpperCase()}] ${rawTitle}`;
      const prompt = customPrompt
        ? `[${cat}] ${customPrompt}`
        : `[${cat}] Reminder for ${rawTitle}. Check schedule and assist with relevant tips.`;

      let schedule: ScheduleConfig;

      if (repeat === "once") {
        const [hours, minutes] = timeVal.split(":").map(Number);
        const runAt = new Date(selectedDate);
        runAt.setHours(hours, minutes, 0, 0);

        // If time is in the past for today, advance to tomorrow or next minute
        if (runAt.getTime() <= Date.now() && isSameLocalDay(selectedDate, new Date())) {
          runAt.setDate(runAt.getDate() + 1);
        }

        schedule = {
          kind: "once",
          runAt: runAt.toISOString(),
        };
      } else if (repeat === "weekly") {
        schedule = {
          kind: "weekly",
          dayOfWeek: selectedDate.getDay(),
          timeOfDay: timeVal,
        };
      } else {
        schedule = {
          kind: "daily",
          timeOfDay: timeVal,
        };
      }

      const input = {
        title,
        prompt,
        enabled: true,
        schedule,
        toolMode: "all-enabled",
        allowedToolIds: [],
      };

      const res = await window.cyreneScheduler?.add(input);
      if (res && !res.ok) {
        throw new Error(res.error ?? "Failed to save schedule event");
      }

      closeAddModal();
      await loadTasks();
    } catch (err) {
      console.error("Failed to add schedule task:", err);
      await showAlert({
        title: "Schedule Task Error",
        message: err instanceof Error ? err.message : "Failed to save event",
        icon: "⚠️",
      });
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Event";
      }
    }
  });
}

// ── Bootstrap ────────────────────────────────────────────────
function init(): void {
  setupEventHandlers();
  updateLiveClock();
  void loadHanoiWeather();
  void loadTasks();

  // Live ticking clock every 1 second
  setInterval(updateLiveClock, 1000);

  // Weather refresh every 10 minutes
  setInterval(() => void loadHanoiWeather(), 10 * 60 * 1000);

  // Periodic polling for task updates
  setInterval(() => void loadTasks(), POLL_INTERVAL_MS);

  // Real-time IPC events
  window.schedulerEvents?.onEvent(() => {
    void loadTasks();
  });

  window.tasks?.onSchedulerChanged?.(() => {
    void loadTasks();
  });
}

init();
