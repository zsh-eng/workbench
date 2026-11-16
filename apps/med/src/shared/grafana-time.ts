// Times as Grafana writes them in a link, which the host reads to query a
// panel and the page reads to lay out a chart's axis while it loads.

const STEPS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

function shift(date: Date, amount: number, unit: string) {
  if (STEPS[unit]) date.setTime(date.getTime() + amount * STEPS[unit]);
  else if (unit === "d") date.setDate(date.getDate() + amount);
  else if (unit === "w") date.setDate(date.getDate() + 7 * amount);
  else if (unit === "M") date.setMonth(date.getMonth() + amount);
  else date.setFullYear(date.getFullYear() + amount);
}

function startOf(date: Date, unit: string) {
  if (unit === "s") date.setMilliseconds(0);
  else if (unit === "m") date.setSeconds(0, 0);
  else if (unit === "h") date.setMinutes(0, 0, 0);
  else {
    date.setHours(0, 0, 0, 0);
    // Weeks start on Monday.
    if (unit === "w") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    if (unit === "M" || unit === "y") date.setDate(1);
    if (unit === "y") date.setMonth(0);
  }
}

/**
 * A time as Grafana writes one in a link: milliseconds, a date, or relative
 * to now, as `now-6h` or `now/d`. A rounded `to` ends at its unit's end, as
 * in Grafana. Null for text that is none of these.
 */
export function grafanaTime(text: string, now: number, end = false): number | null {
  const value = text.trim();
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    return number < 1e11 ? number * 1000 : number;
  }
  if (!value.startsWith("now")) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const date = new Date(now);
  let rest = value.slice(3);
  while (rest) {
    const step = /^([+-])(\d+)([smhdwMy])/.exec(rest);
    if (step) {
      shift(date, (step[1] === "-" ? -1 : 1) * Number(step[2]), step[3]!);
      rest = rest.slice(step[0].length);
      continue;
    }
    const round = /^\/([smhdwMy])/.exec(rest);
    if (!round) return null;
    startOf(date, round[1]!);
    if (end) {
      shift(date, 1, round[1]!);
      date.setTime(date.getTime() - 1);
    }
    rest = rest.slice(round[0].length);
  }
  return date.getTime();
}
