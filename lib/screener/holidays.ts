import holidayFile from '../../reference/nse_holidays.json';

// NSE F&O trading holidays from reference/nse_holidays.json. That file is marked verified: false, so this set is only
// used to find the last completed session and to count trading days; the broker's calendar is the authority.
export const HOLIDAYS: ReadonlySet<string> = new Set((holidayFile.holidays as { date: string }[]).map((h) => h.date));
