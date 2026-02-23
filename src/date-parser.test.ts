import { describe, it, expect } from "vitest";
import { parseDueAt } from "./date-parser.ts";
import { addHours, addMinutes, addDays, addWeeks } from "date-fns";

const NOW = new Date("2025-06-15T10:00:00Z");

describe("parseDueAt", () => {
  describe("relative times", () => {
    it.each([
      ["30m", addMinutes(NOW, 30)],
      ["2h", addHours(NOW, 2)],
      ["1d", addDays(NOW, 1)],
      ["1w", addWeeks(NOW, 1)],
      ["90 minutes", addMinutes(NOW, 90)],
      ["3 hours", addHours(NOW, 3)],
      ["2 days", addDays(NOW, 2)],
      ["1 week", addWeeks(NOW, 1)],
    ] as const)('parses "%s"', (input, expected) => {
      const result = parseDueAt(input, NOW);
      expect(result?.getTime()).toBe(expected.getTime());
    });
  });

  describe("ISO8601", () => {
    it("parses full ISO string", () => {
      const result = parseDueAt("2025-06-16T09:00:00Z", NOW);
      expect(result?.toISOString()).toBe("2025-06-16T09:00:00.000Z");
    });

    it("parses date-only ISO", () => {
      const result = parseDueAt("2025-06-16", NOW);
      expect(result).toBeTruthy();
    });
  });

  describe("named times", () => {
    it("parses 'tomorrow' as 9am", () => {
      const result = parseDueAt("tomorrow", NOW);
      expect(result?.getHours()).toBe(9);
    });

    it("parses 'tomorrow 2pm'", () => {
      const result = parseDueAt("tomorrow 2pm", NOW);
      expect(result?.getHours()).toBe(14);
      expect(result?.getMinutes()).toBe(0);
    });

    it("parses 'today 3pm'", () => {
      const result = parseDueAt("today 3pm", NOW);
      expect(result?.getHours()).toBe(15);
    });

    it("parses 'monday' as next monday 9am", () => {
      const result = parseDueAt("monday", NOW);
      expect(result).toBeTruthy();
      expect(result!.getDay()).toBe(1);
      expect(result!.getHours()).toBe(9);
    });

    it("parses 'monday 10:30'", () => {
      const result = parseDueAt("monday 10:30", NOW);
      expect(result).toBeTruthy();
      expect(result!.getDay()).toBe(1);
      expect(result!.getHours()).toBe(10);
      expect(result!.getMinutes()).toBe(30);
    });
  });

  describe("plain time", () => {
    it("parses '3pm' as today if in the future", () => {
      const morning = new Date("2025-06-15T08:00:00");
      const result = parseDueAt("3pm", morning);
      expect(result?.getHours()).toBe(15);
      expect(result?.getDate()).toBe(morning.getDate());
    });

    it("parses '3am' as tomorrow if already past", () => {
      const afternoon = new Date("2025-06-15T16:00:00");
      const result = parseDueAt("3am", afternoon);
      expect(result?.getHours()).toBe(3);
      expect(result?.getDate()).toBe(afternoon.getDate() + 1);
    });
  });

  it("returns null for unparseable input", () => {
    expect(parseDueAt("gibberish", NOW)).toBeNull();
    expect(parseDueAt("", NOW)).toBeNull();
  });
});
