'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ScreenerParams } from '@/lib/screener/config';
import type { RuleSet } from '@/lib/screener/rules';
import { jobPhase, type JobPhase } from '@/lib/screener/view';

export type JobData<R> = {
  id: string;
  kind: 'scan' | 'backtest';
  source: string;
  params: ScreenerParams;
  status: 'running' | 'done' | 'login_required' | 'failed';
  progress: number;
  message: string;
  result: R | null;
  createdAt: string;
  completedAt: string | null;
};

const POLL_MS = 1_500;
const POLL_DEADLINE_MS = 20 * 60_000; // stop waiting after this long, whatever the server says

// Loads the newest finished job for a source on mount, starts a new one on request and polls it until it ends.
// A login failure becomes the 'login' phase; nothing here retries on its own.
export function useScreenerJob<R>(kind: 'scan' | 'backtest', source: string | null) {
  const [job, setJob] = useState<JobData<R> | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Callers remount this hook (key={source}) when the source changes, so state starts clean for each source.
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    fetch(`/api/screener/${kind}?source=${encodeURIComponent(source)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json() as Promise<{ status: string; job?: JobData<R>; running?: JobData<R> | null }>)
      .then((body) => {
        // A job still running (the page was reopened or the source switched back) is followed again instead of started twice.
        if (body.running) { setJob(body.running); setActiveId(body.running.id); } else if (body.status === 'ok' && body.job) setJob(body.job);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [kind, source]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_DEADLINE_MS) { setActiveId(null); setError('This is taking much longer than expected. Check the server, then run it again.'); return; }
      try {
        const response = await fetch(`/api/screener/jobs/${activeId}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const next = (await response.json()) as JobData<R>;
        setJob(next);
        if (next.status !== 'running') { setActiveId(null); if (next.status === 'login_required') setLoginNeeded(true); }
      } catch {
        // Transient network error: keep polling.
      }
    }, POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [activeId]);

  const start = useCallback(async (params: ScreenerParams, rules: RuleSet) => {
    if (!source) return;
    setStarting(true);
    setError('');
    setLoginNeeded(false);
    try {
      const response = await fetch('/api/screener/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, source, params, rules }) });
      const body = (await response.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (response.status === 401) { setLoginNeeded(true); setError(body?.error ?? 'Sign in first.'); return; }
      if (!response.ok || !body?.jobId) throw new Error(body?.error ?? `The job could not start (${response.status}).`);
      setJob({ id: body.jobId, kind, source, params, status: 'running', progress: 0, message: 'Starting', result: null, createdAt: new Date().toISOString(), completedAt: null });
      if (alive.current) setActiveId(body.jobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The job could not start.');
    } finally {
      setStarting(false);
    }
  }, [kind, source]);

  const phase: JobPhase = loginNeeded ? 'login' : jobPhase(job);
  return { job, result: job?.status === 'done' ? job.result : null, phase, error, busy: starting || activeId !== null, start };
}
