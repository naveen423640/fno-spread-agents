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

const OPEN_MINUTE = 9 * 60 + 15;
const CLOSE_MINUTE = 15 * 60 + 30;

function istMinuteOfDay(now: Date) {
  const [hour, minute] = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  return hour * 60 + minute;
}

// NSE cash session, 09:15 to 15:30 India time. The caller supplies exchange holidays; none are bundled yet,
// so a weekday holiday is reported as open until a verified holiday list is passed in.
export function marketSession(now: Date, holidays: ReadonlySet<string> = new Set()): 'open' | 'closed' {
  const minute = istMinuteOfDay(now);
  return isTradingDay(istDate(now), holidays) && minute >= OPEN_MINUTE && minute < CLOSE_MINUTE ? 'open' : 'closed';
}

function lastCloseTimestamp(now: Date, holidays: ReadonlySet<string>) {
  const today = istDate(now);
  const closedToday = isTradingDay(today, holidays) && istMinuteOfDay(now) >= CLOSE_MINUTE;
  return `${closedToday ? today : previousTradingDate(now, holidays)}T15:30:00+05:30`;
}

export function describeLiveFeed(now: Date, holidays: ReadonlySet<string> = new Set()) {
  return marketSession(now, holidays) === 'open'
    ? { source: 'FYERS live', asOf: now.toISOString(), live: true }
    : { source: 'FYERS last close', asOf: lastCloseTimestamp(now, holidays), live: false };
}
