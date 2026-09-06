import { describe, it, expect } from "vitest";
import {
  isValidDate,
  formatDateString,
  parseDateString,
  getDaysInMonth,
  getFirstDayOfWeek,
  generateMonthCells,
  setupBirthdayPicker,
} from "./birthday-picker";

describe("birthday-picker unit tests", () => {
  describe("isValidDate", () => {
    it("validates valid dates correctly", () => {
      expect(isValidDate(2000, 0, 1)).toBe(true);
      expect(isValidDate(2024, 1, 29)).toBe(true); // leap year
      expect(isValidDate(2023, 1, 29)).toBe(false); // non leap year
      expect(isValidDate(1899, 5, 15)).toBe(false); // out of range
      expect(isValidDate(2000, 3, 31)).toBe(false); // April has 30 days
      expect(isValidDate(2000, 12, 1)).toBe(false); // month out of range
    });
  });

  describe("formatDateString", () => {
    it("formats year, month, day into YYYY-MM-DD", () => {
      expect(formatDateString(2000, 0, 5)).toBe("2000-01-05");
      expect(formatDateString(1995, 11, 25)).toBe("1995-12-25");
    });
  });

  describe("parseDateString", () => {
    it("parses ISO YYYY-MM-DD format", () => {
      expect(parseDateString("2002-09-06")).toEqual({ year: 2002, month: 8, day: 6 });
      expect(parseDateString("1990/12/31")).toEqual({ year: 1990, month: 11, day: 31 });
    });

    it("parses DD/MM/YYYY and DD-MM-YYYY format", () => {
      expect(parseDateString("06/09/2002")).toEqual({ year: 2002, month: 8, day: 6 });
      expect(parseDateString("31-12-1990")).toEqual({ year: 1990, month: 11, day: 31 });
    });

    it("returns null for invalid or empty strings", () => {
      expect(parseDateString("")).toBeNull();
      expect(parseDateString("   ")).toBeNull();
      expect(parseDateString(null)).toBeNull();
      expect(parseDateString("not-a-date")).toBeNull();
      expect(parseDateString("2023-02-29")).toBeNull();
    });
  });

  describe("getDaysInMonth and getFirstDayOfWeek", () => {
    it("returns accurate day counts", () => {
      expect(getDaysInMonth(2024, 1)).toBe(29); // Feb 2024 leap
      expect(getDaysInMonth(2023, 1)).toBe(28); // Feb 2023
      expect(getDaysInMonth(2023, 0)).toBe(31); // Jan
      expect(getDaysInMonth(2023, 3)).toBe(30); // Apr
    });

    it("returns first day of week", () => {
      // 2026-09-01 is Tuesday (day 2)
      expect(getFirstDayOfWeek(2026, 8)).toBe(2);
    });
  });

  describe("generateMonthCells", () => {
    it("generates 7-column aligned grid with current and adjacent month days", () => {
      const cells = generateMonthCells(2026, 8); // Sept 2026
      expect(cells.length % 7).toBe(0);
      const currentDays = cells.filter((c) => c.isCurrentMonth);
      expect(currentDays.length).toBe(30);
      expect(currentDays[0].day).toBe(1);
      expect(currentDays[0].dateStr).toBe("2026-09-01");
      expect(currentDays[29].day).toBe(30);
      expect(currentDays[29].dateStr).toBe("2026-09-30");
    });
  });

  describe("setupBirthdayPicker controller lifecycle", () => {
    function createMockElement(tag = "div") {
      const listeners: Record<string, ((e: any) => void)[]> = {};
      const classes = new Set<string>();
      const el: any = {
        tagName: tag.toUpperCase(),
        value: "",
        hidden: true,
        innerHTML: "",
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        addEventListener: (event: string, fn: (e: any) => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        },
        removeEventListener: (event: string, fn: (e: any) => void) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((f) => f !== fn);
          }
        },
        dispatchEvent: (event: any) => {
          const fns = listeners[event.type] || [];
          for (const fn of fns) fn(event);
          return true;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,
      };
      return el;
    }

    it("opens, closes, and cleans up event listeners", () => {
      // Mock global document if not present
      if (typeof (globalThis as any).document === "undefined") {
        (globalThis as any).document = {
          addEventListener: () => {},
          removeEventListener: () => {},
          activeElement: null,
        };
      }
      if (typeof (globalThis as any).Event === "undefined") {
        (globalThis as any).Event = class {
          type: string;
          constructor(type: string) {
            this.type = type;
          }
        };
      }

      const input = createMockElement("input");
      input.value = "2000-05-15";
      const button = createMockElement("button");
      const popup = createMockElement("div");

      const picker = setupBirthdayPicker({ input, button, popup });

      picker.open();
      expect(popup.hidden).toBe(false);
      expect(popup.classList.contains("is-open")).toBe(true);

      picker.close();
      expect(popup.hidden).toBe(true);
      expect(popup.classList.contains("is-open")).toBe(false);

      picker.destroy();
    });
  });
});
