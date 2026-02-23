import {
  addMinutes,
  addHours,
  addDays,
  addWeeks,
  setHours,
  setMinutes,
  setSeconds,
  startOfTomorrow,
  startOfDay,
  nextMonday,
  isValid,
  parseISO,
} from "date-fns";

const RELATIVE_PATTERN = /^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/i;

const UNIT_MAP: Record<string, (date: Date, n: number) => Date> = {
  m: addMinutes,
  min: addMinutes,
  mins: addMinutes,
  minute: addMinutes,
  minutes: addMinutes,
  h: addHours,
  hr: addHours,
  hrs: addHours,
  hour: addHours,
  hours: addHours,
  d: addDays,
  day: addDays,
  days: addDays,
  w: addWeeks,
  week: addWeeks,
  weeks: addWeeks,
};

const TIME_PATTERN = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

function applyTime(base: Date, timeStr: string): Date {
  const match = timeStr.match(TIME_PATTERN);
  if (!match) return base;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return setSeconds(setMinutes(setHours(base, hours), minutes), 0);
}

export function parseDueAt(input: string, now = new Date()): Date | null {
  const trimmed = input.trim();

  // ISO8601
  const iso = parseISO(trimmed);
  if (isValid(iso) && trimmed.includes("-")) return iso;

  // Relative: "2h", "30m", "1d"
  const relMatch = trimmed.match(RELATIVE_PATTERN);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const fn = UNIT_MAP[unit];
    if (fn) return fn(now, n);
  }

  const lower = trimmed.toLowerCase();

  // "tomorrow" or "tomorrow 9am"
  if (lower.startsWith("tomorrow")) {
    const base = startOfTomorrow();
    const rest = trimmed.slice("tomorrow".length).trim();
    return rest ? applyTime(base, rest) : setHours(base, 9);
  }

  // "today 3pm"
  if (lower.startsWith("today")) {
    const base = startOfDay(now);
    const rest = trimmed.slice("today".length).trim();
    return rest ? applyTime(base, rest) : base;
  }

  // "monday" or "monday 9am"
  if (lower.startsWith("monday")) {
    const base = nextMonday(now);
    const rest = trimmed.slice("monday".length).trim();
    return rest ? applyTime(base, rest) : setHours(base, 9);
  }

  // Plain time: "3pm", "14:30"
  if (TIME_PATTERN.test(trimmed)) {
    const result = applyTime(startOfDay(now), trimmed);
    if (result <= now) return applyTime(addDays(startOfDay(now), 1), trimmed);
    return result;
  }

  return null;
}
