// IST helpers. Times are unix seconds; the engine never reads a clock, callers pass `now` in.
const IST_OFFSET = 19_800;

export const istTs = (date: string, hhmm: string, seconds = 0): number => Date.parse(`${date}T${hhmm}:${String(seconds).padStart(2, '0')}+05:30`) / 1000;
export const istDate = (ts: number): string => new Date((ts + IST_OFFSET) * 1000).toISOString().slice(0, 10);
export const istHhmm = (ts: number): string => new Date((ts + IST_OFFSET) * 1000).toISOString().slice(11, 16);
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
