const DAY_MS = 86_400_000;

export function istDate(now: Date) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shiftDate(value: string, days: number) {
  return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function isTradingDay(value: string, holidays: ReadonlySet<string>) {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(value);
}

// Most recent trading day strictly before today's India date. Holidays are supplied by the caller.
export function previousTradingDate(now: Date, holidays: ReadonlySet<string> = new Set()) {
  let value = shiftDate(istDate(now), -1);
  while (!isTradingDay(value, holidays)) value = shiftDate(value, -1);
  return value;
}
