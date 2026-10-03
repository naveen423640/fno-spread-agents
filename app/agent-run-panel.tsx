'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { summarizeRun, type Phase, type RunResponse } from '@/lib/agents/run-view';

const ROLE_LABEL: Record<string, string> = { technical: 'Technical', options_oi: 'Options / OI', news: 'News', fundamentals: 'Fundamentals', bull: 'Bull researcher', bear: 'Bear researcher' };
const PHASE_LABEL: Record<Phase, string> = {
  starting: 'Starting the run…',
  analysts: 'Analysts are working…',
  debate: 'Bull and bear are debating…',
  risk: 'Trader proposed; risk review in progress…',
  done: 'Verdict ready',
  unavailable: 'AI unavailable',
  failed: 'Run failed',
};
const TERMINAL: Phase[] = ['done', 'unavailable', 'failed'];
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

export function AgentRunPanel({ symbol }: { symbol: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const view = useMemo(() => summarizeRun(data), [data]);
  const terminal = TERMINAL.includes(view.phase);
  const running = starting || (runId !== null && !terminal);

  async function start() {
    setStarting(true);
    setError('');
    setData(null);
    setRunId(null);
    try {
      const response = await fetch('/api/agents/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) });
      const payload = await response.json().catch(() => null) as { runId?: string; error?: string } | null;
      if (!response.ok || !payload?.runId) throw new Error(payload?.error ?? `The research team could not start (${response.status}).`);
      setRunId(payload.runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The research team could not start.');
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!runId || terminal) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/agents/runs/${runId}`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        setData(await response.json() as RunResponse);
      } catch {
        // Keep polling; a transient network error should not end the view.
      }
    };
    void poll();
    const timer = setInterval(poll, 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [runId, terminal]);

  const sourceById = new Map(view.sources.map((source) => [source.id, source]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" />Research team</CardTitle>
        <Button size="sm" onClick={start} disabled={running}>{running ? <Loader2 className="animate-spin" /> : <Users />}Run research team</Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Exploratory: no signal engine exists yet, so this is not evidence of edge. The team can only advise (approve, reduce, delay or veto); it cannot place orders.</p>
        {error && <p role="alert" className="flex items-center gap-2 text-red-500"><AlertCircle className="size-4" />{error}</p>}
        {runId && <p className="text-muted-foreground" aria-live="polite">{PHASE_LABEL[view.phase]}</p>}

        {runId && <div className="grid gap-2 sm:grid-cols-2">
          {view.analystCards.map((card) => (
            <div key={card.role} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between"><span className="font-medium">{ROLE_LABEL[card.role]}</span><span className="text-xs text-muted-foreground">{card.status}</span></div>
              {card.summary && <p className="mt-1 text-muted-foreground">{card.summary}</p>}
              {card.reason && <p className="mt-1 text-xs text-muted-foreground">{card.reason}</p>}
            </div>
          ))}
        </div>}

        {view.debate.length > 0 && <div className="space-y-2">
          {view.debate.map((turn, index) => <div key={`${turn.role}-${index}`} className="rounded-lg border border-border p-3"><div className="font-medium">{ROLE_LABEL[turn.role]}</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{turn.text}</p></div>)}
        </div>}
        {view.proposal && <div className="rounded-lg border border-border p-3"><div className="font-medium">Trader proposal</div><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{view.proposal}</p></div>}

        {view.phase === 'unavailable' && <p className="text-amber-600">AI is unavailable for this run{view.reason ? `: ${view.reason}` : '.'} The rules pipeline is unaffected.</p>}
        {view.phase === 'failed' && <p role="alert" className="text-red-500">The run failed{view.reason ? `: ${view.reason}` : '.'}</p>}

        {view.verdict && <div className="rounded-lg border-2 border-border p-3">
          <div className="text-base font-semibold">Verdict: {view.verdict.verdict}{view.verdict.reduce_to_lots ? ` to ${view.verdict.reduce_to_lots} lot(s)` : ''}{view.verdict.delay_to ? ` until ${view.verdict.delay_to}` : ''}</div>
          <ul className="mt-2 space-y-2">
            {view.verdict.reasons.map((reason, index) => (
              <li key={index}>
                <span className="text-xs uppercase text-muted-foreground">{reason.type}</span> {reason.claim}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {reason.source_ids.map((id) => {
                    const source = sourceById.get(id);
                    const url = safeUrl(source?.url ?? null);
                    return url
                      ? <a key={id} href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded bg-muted px-1.5 text-xs underline">{id}<ExternalLink className="size-3" /></a>
                      : <span key={id} className="rounded bg-muted px-1.5 text-xs" title={source?.title}>{id}</span>;
                  })}
                </span>
              </li>
            ))}
          </ul>
          {view.verdict.missing_evidence.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Missing evidence: {view.verdict.missing_evidence.join('; ')}</p>}
          <p className="mt-2 text-xs text-muted-foreground">{view.verdict.confidence_note}</p>
        </div>}
      </CardContent>
    </Card>
  );
}
