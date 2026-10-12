import { describe, expect, it } from 'vitest';

import { dueJobs, markDone, previousMonth, type ScheduleInput } from '@/lib/ltp-agent/schedule';

const at = (date: string, weekday: ScheduleInput['weekday'], hhmm: string, done: ScheduleInput['done'] = {}): ScheduleInput => ({ date, weekday, minute: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), done });

describe('the live step runs through the market session, 09:15 to 15:30 on weekdays', () => {
  it('boundaries', () => {
    expect(dueJobs(at('2026-10-12', 'Mon', '09:14'))).toEqual([]);
    expect(dueJobs(at('2026-10-12', 'Mon', '09:15'))).toEqual(['step']);
    expect(dueJobs(at('2026-10-12', 'Mon', '15:30'))).toEqual(['step']);
    expect(dueJobs(at('2026-10-12', 'Mon', '15:31'))).not.toContain('step');
  });
  it('nothing runs on a Saturday or Sunday', () => {
    expect(dueJobs(at('2026-10-17', 'Sat', '11:00'))).toEqual([]);
    expect(dueJobs(at('2026-10-18', 'Sun', '16:00'))).toEqual([]);
  });
});

describe('end of day, review, proposals and the report each run once', () => {
  it('close-out from 15:31 and the daily review from 15:35, each once a day', () => {
    expect(dueJobs(at('2026-10-12', 'Mon', '15:31'))).toEqual(['finish_day']);
    expect(dueJobs(at('2026-10-12', 'Mon', '15:35'))).toEqual(['finish_day', 'review']);
    expect(dueJobs(at('2026-10-12', 'Mon', '16:10', { finish_day: '2026-10-12', review: '2026-10-12' }))).toEqual([]);
    expect(dueJobs(at('2026-10-13', 'Tue', '15:40', { finish_day: '2026-10-12', review: '2026-10-12' }))).toEqual(['finish_day', 'review']);
  });
  it('proposals run on Friday after the review (15:40), once per Friday, never on other days', () => {
    expect(dueJobs(at('2026-10-16', 'Fri', '15:39', { finish_day: '2026-10-16', review: '2026-10-16' }))).toEqual([]);
    expect(dueJobs(at('2026-10-16', 'Fri', '15:40', { finish_day: '2026-10-16', review: '2026-10-16' }))).toEqual(['propose']);
    expect(dueJobs(at('2026-10-16', 'Fri', '16:00', { finish_day: '2026-10-16', review: '2026-10-16', propose: '2026-10-16' }))).toEqual([]);
    expect(dueJobs(at('2026-10-15', 'Thu', '15:45', { finish_day: '2026-10-15', review: '2026-10-15' }))).toEqual([]);
  });
  it('the monthly report runs on the first weekday of the month, once, for the month before', () => {
    expect(dueJobs(at('2026-10-01', 'Thu', '09:00'))).toContain('report');
    expect(dueJobs(at('2026-10-01', 'Thu', '08:59'))).not.toContain('report');
    expect(dueJobs(at('2026-10-02', 'Fri', '10:00'))).not.toContain('report');
    expect(dueJobs(at('2026-11-02', 'Mon', '10:00'))).toContain('report'); // 1 November is a Sunday
    expect(dueJobs(at('2026-08-03', 'Mon', '10:00'))).toContain('report'); // 1 August is a Saturday
    expect(dueJobs(at('2026-10-01', 'Thu', '10:00', { report: '2026-10' }))).not.toContain('report');
  });
  it('previousMonth rolls back across a year', () => {
    expect(previousMonth('2026-10-01')).toBe('2026-09');
    expect(previousMonth('2027-01-04')).toBe('2026-12');
  });
});

describe('markDone records the period of a job so it does not repeat', () => {
  it('daily jobs by date, the report by month, the step not at all', () => {
    const i = at('2026-10-01', 'Thu', '15:40');
    expect(markDone({}, 'review', i)).toEqual({ review: '2026-10-01' });
    expect(markDone({}, 'report', i)).toEqual({ report: '2026-10' });
    expect(markDone({ review: 'x' }, 'step', i)).toEqual({ review: 'x' });
  });
});
