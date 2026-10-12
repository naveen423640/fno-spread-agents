// When each scheduled job is due, as a pure function of the clock, so the runner is a thin loop. All times are IST. Holidays are not known here:
// on a market holiday the jobs still fire, find no snapshots, and do nothing.
export type JobName = 'step' | 'finish_day' | 'review' | 'propose' | 'report';
export type ScheduleInput = { weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'; minute: number; date: string; done: Partial<Record<JobName, string>> };

const OPEN = 9 * 60 + 15;
const CLOSE = 15 * 60 + 30;

const isWeekdayName = (d: ScheduleInput['weekday']) => d !== 'Sat' && d !== 'Sun';
const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
const firstWeekdayOfMonth = (date: string) => {
  const day = Number(date.slice(8));
  for (let k = 1; k < day; k += 1) { const w = dayOfWeek(`${date.slice(0, 8)}${String(k).padStart(2, '0')}`); if (w !== 0 && w !== 6) return false; }
  return dayOfWeek(date) !== 0 && dayOfWeek(date) !== 6;
};

export const previousMonth = (date: string) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

// The period a job is recorded against: its date, or the month for the report.
const periodOf = (job: JobName, i: ScheduleInput) => (job === 'report' ? i.date.slice(0, 7) : i.date);

export function dueJobs(i: ScheduleInput): JobName[] {
  if (!isWeekdayName(i.weekday)) return [];
  const due: JobName[] = [];
  if (i.minute >= OPEN && i.minute <= CLOSE) due.push('step');
  if (i.minute >= CLOSE + 1 && i.done.finish_day !== i.date) due.push('finish_day');
  if (i.minute >= 15 * 60 + 35 && i.done.review !== i.date) due.push('review');
  if (i.weekday === 'Fri' && i.minute >= 15 * 60 + 40 && i.done.propose !== i.date) due.push('propose');
  if (i.minute >= 9 * 60 && firstWeekdayOfMonth(i.date) && i.done.report !== i.date.slice(0, 7)) due.push('report');
  return due;
}

export function markDone(done: ScheduleInput['done'], job: JobName, i: ScheduleInput): ScheduleInput['done'] {
  return job === 'step' ? done : { ...done, [job]: periodOf(job, i) };
}
