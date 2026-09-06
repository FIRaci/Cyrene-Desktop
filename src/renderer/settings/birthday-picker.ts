export interface CalendarCell {
  day: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
  dateStr: string;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 0 || month > 11) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
}

export function formatDateString(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateString(val: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  // Format 1: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    if (isValidDate(year, month, day)) return { year, month, day };
  }

  // Format 2: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    if (isValidDate(year, month, day)) return { year, month, day };
  }

  return null;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0 = Sun .. 6 = Sat
}

export function generateMonthCells(year: number, month: number): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const daysInCurrent = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const daysInPrev = getDaysInMonth(prevYear, prevMonth);

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrev - i;
    cells.push({
      day,
      month: prevMonth,
      year: prevYear,
      isCurrentMonth: false,
      dateStr: formatDateString(prevYear, prevMonth, day),
    });
  }

  for (let day = 1; day <= daysInCurrent; day++) {
    cells.push({
      day,
      month,
      year,
      isCurrentMonth: true,
      dateStr: formatDateString(year, month, day),
    });
  }

  const remaining = (7 - (cells.length % 7)) % 7;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  for (let day = 1; day <= remaining; day++) {
    cells.push({
      day,
      month: nextMonth,
      year: nextYear,
      isCurrentMonth: false,
      dateStr: formatDateString(nextYear, nextMonth, day),
    });
  }

  return cells;
}

export interface SetupBirthdayPickerOptions {
  input: HTMLInputElement;
  button?: HTMLElement | null;
  popup: HTMLElement;
}

export function setupBirthdayPicker(options: SetupBirthdayPickerOptions): {
  open: () => void;
  close: () => void;
  destroy: () => void;
} {
  const { input, button, popup } = options;

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let isOpen = false;

  const getTodayStr = (): string => {
    const t = new Date();
    return formatDateString(t.getFullYear(), t.getMonth(), t.getDate());
  };

  const syncViewWithInput = (): void => {
    const parsed = parseDateString(input.value);
    if (parsed) {
      viewYear = parsed.year;
      viewMonth = parsed.month;
    } else {
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
    }
  };

  const render = (): void => {
    const currentVal = input.value.trim();
    const todayStr = getTodayStr();
    const cells = generateMonthCells(viewYear, viewMonth);

    const minYear = 1920;
    const maxYear = new Date().getFullYear();

    const monthOptions = MONTH_NAMES.map(
      (m, idx) => `<option value="${idx}" ${idx === viewMonth ? "selected" : ""}>${m}</option>`
    ).join("");

    const yearOptions: string[] = [];
    for (let y = maxYear; y >= minYear; y--) {
      yearOptions.push(`<option value="${y}" ${y === viewYear ? "selected" : ""}>${y}</option>`);
    }

    const weekdaysHtml = WEEKDAY_NAMES.map(
      (w) => `<span class="birthday-cal-weekday">${w}</span>`
    ).join("");

    const daysHtml = cells
      .map((cell) => {
        const isSelected = cell.dateStr === currentVal;
        const isToday = cell.dateStr === todayStr;
        const classes = [
          "birthday-cal-day",
          cell.isCurrentMonth ? "is-current-month" : "is-other-month",
          isSelected ? "is-selected" : "",
          isToday ? "is-today" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `<button type="button" class="${classes}" data-date="${cell.dateStr}">${cell.day}</button>`;
      })
      .join("");

    popup.innerHTML = `
      <div class="birthday-cal-header">
        <button type="button" class="birthday-cal-nav-btn" data-action="prev-month" aria-label="Previous Month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="birthday-cal-selectors">
          <select class="birthday-cal-select" data-role="month-select" aria-label="Select Month">
            ${monthOptions}
          </select>
          <select class="birthday-cal-select" data-role="year-select" aria-label="Select Year">
            ${yearOptions.join("")}
          </select>
        </div>
        <button type="button" class="birthday-cal-nav-btn" data-action="next-month" aria-label="Next Month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
      <div class="birthday-cal-weekdays">
        ${weekdaysHtml}
      </div>
      <div class="birthday-cal-days">
        ${daysHtml}
      </div>
      <div class="birthday-cal-footer">
        <button type="button" class="birthday-cal-action-btn" data-action="clear">Clear</button>
        <button type="button" class="birthday-cal-action-btn" data-action="today">Today</button>
        <button type="button" class="birthday-cal-action-btn birthday-cal-action-btn--close" data-action="close">Done</button>
      </div>
    `;

    bindPopupEvents();
  };

  const bindPopupEvents = (): void => {
    const prevBtn = popup.querySelector<HTMLButtonElement>('[data-action="prev-month"]');
    const nextBtn = popup.querySelector<HTMLButtonElement>('[data-action="next-month"]');
    const monthSel = popup.querySelector<HTMLSelectElement>('[data-role="month-select"]');
    const yearSel = popup.querySelector<HTMLSelectElement>('[data-role="year-select"]');
    const clearBtn = popup.querySelector<HTMLButtonElement>('[data-action="clear"]');
    const todayBtn = popup.querySelector<HTMLButtonElement>('[data-action="today"]');
    const closeBtn = popup.querySelector<HTMLButtonElement>('[data-action="close"]');

    prevBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (viewMonth === 0) {
        viewMonth = 11;
        viewYear--;
      } else {
        viewMonth--;
      }
      render();
    });

    nextBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (viewMonth === 11) {
        viewMonth = 0;
        viewYear++;
      } else {
        viewMonth++;
      }
      render();
    });

    monthSel?.addEventListener("change", (e) => {
      e.stopPropagation();
      viewMonth = parseInt((e.target as HTMLSelectElement).value, 10);
      render();
    });

    yearSel?.addEventListener("change", (e) => {
      e.stopPropagation();
      viewYear = parseInt((e.target as HTMLSelectElement).value, 10);
      render();
    });

    clearBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      commitValue("");
      close();
    });

    todayBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      commitValue(getTodayStr());
      close();
    });

    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
    });

    popup.querySelectorAll<HTMLButtonElement>(".birthday-cal-day").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const dateStr = btn.dataset.date;
        if (dateStr) {
          commitValue(dateStr);
          close();
        }
      });
    });
  };

  const commitValue = (val: string): void => {
    input.value = val;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  const open = (): void => {
    if (isOpen) return;
    syncViewWithInput();
    render();
    popup.hidden = false;
    popup.classList.add("is-open");
    isOpen = true;
  };

  const close = (): void => {
    if (!isOpen) return;
    popup.hidden = true;
    popup.classList.remove("is-open");
    isOpen = false;
  };

  const toggle = (): void => {
    if (isOpen) close();
    else open();
  };

  const onInputClick = (e: MouseEvent): void => {
    e.stopPropagation();
    open();
  };

  const onButtonClick = (e: MouseEvent): void => {
    e.stopPropagation();
    toggle();
  };

  const onDocumentClick = (e: MouseEvent): void => {
    if (!isOpen) return;
    const target = e.target as Node | null;
    if (target && (popup.contains(target) || input.contains(target) || (button && button.contains(target)))) {
      return;
    }
    close();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      close();
    }
    if (e.key === "Enter" && document.activeElement === input) {
      const parsed = parseDateString(input.value);
      if (parsed) {
        commitValue(formatDateString(parsed.year, parsed.month, parsed.day));
      }
      close();
    }
  };

  input.addEventListener("click", onInputClick);
  button?.addEventListener("click", onButtonClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeyDown);

  return {
    open,
    close,
    destroy: () => {
      input.removeEventListener("click", onInputClick);
      button?.removeEventListener("click", onButtonClick);
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
      popup.hidden = true;
      popup.innerHTML = "";
    },
  };
}
