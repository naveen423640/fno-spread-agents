'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { MarketStock } from '@/lib/market-snapshot';

type IntradayPoint = { timestamp: number; sessionDate: string; time: string; open: number; high: number; low: number; close: number; volume: number };
type Source = { title: string; url: string };
type Message = { role: 'user' | 'assistant'; content: string; sources?: Source[] };

export function StockAssistant({ stock, sector, points, range }: { stock: MarketStock; sector: string; points: IntradayPoint[]; range: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const chart = useMemo(() => {
    if (!points.length) return { range, sessions: 0 };
    const closes = points.map((point) => point.close);
    const firstClose = closes[0];
    const latestClose = closes.at(-1)!;
    const sessions = [...new Set(points.map((point) => point.sessionDate))];
    return {
      range,
      firstClose,
      latestClose,
      changePct: firstClose ? ((latestClose / firstClose) - 1) * 100 : 0,
      low: Math.min(...points.map((point) => point.low)),
      high: Math.max(...points.map((point) => point.high)),
      sessions: sessions.length,
      startDate: sessions[0],
      endDate: sessions.at(-1),
    };
  }, [points, range]);

  async function ask(prompt = question) {
    const cleanQuestion = prompt.trim();
    if (!cleanQuestion || loading) return;
    const userMessage: Message = { role: 'user', content: cleanQuestion };
    const prior = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/stock-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: cleanQuestion,
          ticker: stock.ticker,
          sector,
          quote: { price: stock.price, changePct: stock.changePct, previousClose: stock.previousClose, open: stock.open, high: stock.high, low: stock.low, volume: stock.volume },
          chart,
          history: prior,
        }),
      });
      const payload = await response.json() as { answer?: string; sources?: Source[]; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? 'Unable to answer right now.');
      setMessages((current) => [...current, { role: 'assistant', content: payload.answer!, sources: payload.sources }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to answer right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="h-[clamp(240px,52dvh,420px)] min-w-0 max-w-full gap-3 overflow-hidden border-indigo-200 bg-indigo-50/40 py-4">
      <CardHeader className="min-w-0 shrink-0 px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white"><Sparkles className="size-4" /></span>AI stock analyst</CardTitle>
        <p className="break-words text-xs text-muted-foreground">Ask about {stock.ticker} prices, live FYERS option-chain data, news, results, valuation, technicals, risks, or corporate actions.</p>
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-4 sm:px-5">
        {!messages.length && <div className="flex min-h-0 flex-1 content-start flex-wrap gap-2 overflow-y-auto">
          {['Why is it moving?', 'Latest news', 'Key risks', 'Technical view'].map((prompt) => <Button key={prompt} size="sm" variant="outline" disabled={loading} onClick={() => void ask(prompt)}>{prompt}</Button>)}
        </div>}
        {messages.length > 0 && <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto rounded-xl border border-indigo-100 bg-background p-3" aria-live="polite">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-auto w-fit max-w-[90%] min-w-0 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground' : 'max-w-full min-w-0 rounded-lg bg-muted px-3 py-2 text-sm'}>
            <div className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{message.content}</div>
            {message.sources?.length ? <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden border-t border-border/60 pt-2">{message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-background px-2 py-1 text-[10px] text-indigo-700 hover:underline"><span className="min-w-0 truncate">{source.title}</span><ExternalLink className="size-3 shrink-0" /></a>)}</div> : null}
          </div>)}
          {loading && <div className="mr-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Researching {stock.ticker}…</div>}
        </div>}
        {error && <p role="alert" className="shrink-0 text-xs text-red-600">{error}</p>}
        <form className="flex min-w-0 max-w-full shrink-0 items-end gap-2" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder={`Ask anything about ${stock.ticker}…`} className="min-h-11 min-w-0 flex-1 resize-none bg-background" maxLength={1200} />
          <Button type="submit" size="icon" className="shrink-0" disabled={loading || !question.trim()} aria-label="Ask AI analyst">{loading ? <Loader2 className="animate-spin" /> : <Send />}</Button>
        </form>
        <p className="shrink-0 text-[10px] text-muted-foreground">AI analysis can be wrong or delayed. Verify prices, filings, and execution data before trading.</p>
      </CardContent>
    </Card>
  );
}
