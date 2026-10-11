import { istDate } from '@/lib/market-session';

export const SESSION_MINUTES = 375; // 09:15 to 15:30

export const floorToMinute = (ms: number) => Math.floor(ms / 60_000) * 60;
export const istDay = (ms: number) => istDate(new Date(ms));
export const sessionOpenTs = (day: string) => Date.parse(`${day}T09:15:00+05:30`) / 1000;
export const sessionCloseTs = (day: string) => Date.parse(`${day}T15:30:00+05:30`) / 1000;
export const minutesElapsed = (ts: number, day: string) => Math.min(SESSION_MINUTES, Math.max(0, (ts - sessionOpenTs(day)) / 60));
export const isoFromTs = (ts: number) => new Date(ts * 1000).toISOString();
