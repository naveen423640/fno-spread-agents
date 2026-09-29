'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { MarketStock } from '@/lib/market-snapshot';

type AnalystStock = MarketStock & { sector: string };
type Source = { title: string; url: string };
type Match = { ticker: string; reason: string };
type Message = { role: 'user' | 'assistant'; content: string; sources?: Source[]; matches?: Match[] };

function tileColor(value: number) {
  const strength = Math.min(Math.abs(value) / 4, 1);
  if (value > 0) return `hsl(145 58% ${36 - strength * 17}%)`;
  if (value < 0) return `hsl(0 66% ${43 - strength * 19}%)`;
  return 'var(--market-flat)';
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

export function HeatmapAssistant({
  open,
  onOpenChange,
  stocks,
  asOf,
  source,
  onOpenStock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stocks: AnalystStock[];
  asOf: string;
  source: string;
  onOpenStock: (stock: AnalystStock) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const stockByTicker = useMemo(() => new Map(stocks.map((stock) => [stock.ticker, stock])), [stocks]);
  const latestMatches = useMemo(() => {
    const matchMessage = [...messages].reverse().find((message) => message.role === 'assistant' && message.matches?.length);
    return (matchMessage?.matches ?? []).flatMap((match) => {
      const stock = stockByTicker.get(match.ticker);
      return stock ? [{ stock, reason: match.reason }] : [];
    });
  }, [messages, stockByTicker]);

  async function ask(prompt = question) {
    const cleanQuestion = prompt.trim();
    if (!cleanQuestion || loading) return;
    const userMessage: Message = { role: 'user', content: cleanQuestion };
    const prior = messages.slice(-6).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/market-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: cleanQuestion,
          asOf,
          source,
          universe: stocks.map((stock) => ({
            symbol: stock.symbol,
            ticker: stock.ticker,
            name: stock.name,
            sector: stock.sector,
            price: stock.price,
            changePct: stock.changePct,
            previousClose: stock.previousClose,
            open: stock.open,
            high: stock.high,
            low: stock.low,
            volume: stock.volume,
          })),
          history: prior,
        }),
      });
      const payload = await response.json() as { answer?: string; matches?: Match[]; sources?: Source[]; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? 'Unable to answer right now.');
      setMessages((current) => [...current, { role: 'assistant', content: payload.answer!, matches: payload.matches, sources: payload.sources }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to answer right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-dvh max-w-none content-start overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-6xl sm:rounded-xl">
        <DialogHeader className="border-b border-border bg-indigo-50/60 px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2"><span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><Sparkles className="size-4" /></span>AI F&amp;O market analyst</DialogTitle>
          <DialogDescription>Ask across all {stocks.length} F&amp;O stocks using heat-map prices, on-demand FYERS quotes and option chains, plus public web research.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 pb-6 sm:px-6">
          {!messages.length && <div className="flex flex-wrap gap-2">
            {['Show today’s strongest stocks', 'Banks up more than 1%', 'High-volume gainers', 'Weak sectors and their laggards'].map((prompt) => (
              <Button key={prompt} size="sm" variant="outline" disabled={loading} onClick={() => void ask(prompt)}>{prompt}</Button>
            ))}
          </div>}

          {messages.length > 0 && <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-indigo-100 bg-background p-3" aria-live="polite">
            {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground' : 'mr-3 rounded-lg bg-muted px-3 py-2 text-sm'}>
              <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
              {message.sources?.length ? <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">{message.sources.map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-2 py-1 text-[10px] text-indigo-700 hover:underline"><span className="truncate">{item.title}</span><ExternalLink className="size-3 shrink-0" /></a>)}</div> : null}
            </div>)}
            {loading && <div className="mr-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Analyzing the {stocks.length}-stock universe…</div>}
          </div>}

          {latestMatches.length > 0 && <section aria-label="AI-matched F&O stocks">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">Matched stocks</h3><p className="text-[11px] text-muted-foreground">{latestMatches.length} candidates · select a tile to open its price chart</p></div>
            </div>
            <div className="heat-grid">
              {latestMatches.map(({ stock, reason }) => <button
                key={stock.symbol}
                type="button"
                className="heat-tile"
                style={{ background: tileColor(stock.changePct) }}
                onClick={() => onOpenStock(stock)}
                title={reason}
                aria-label={`${stock.ticker}, current price ${formatPrice(stock.price)}, ${stock.changePct.toFixed(2)} percent. ${reason}`}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold">{stock.ticker}</span>
                  <strong className="shrink-0 text-xs tabular-nums">{stock.changePct > 0 ? '+' : ''}{stock.changePct.toFixed(2)}%</strong>
                </span>
                <strong className="text-base tabular-nums">₹{formatPrice(stock.price)}</strong>
                <span className="grid w-full grid-cols-2 gap-2 text-[10px] tabular-nums text-white/85">
                  <span><span className="opacity-70">Day H </span>{stock.high ? formatPrice(stock.high) : '—'}</span>
                  <span><span className="opacity-70">Day L </span>{stock.low ? formatPrice(stock.low) : '—'}</span>
                </span>
                <span className="w-full truncate text-[10px] opacity-75">{stock.sector}</span>
              </button>)}
            </div>
          </section>}

          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <form className="sticky bottom-0 flex items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-lg" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <Textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Example: Show auto stocks up today with above-average volume and explain likely catalysts" className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" maxLength={1200} />
            <Button type="submit" size="icon" disabled={loading || !question.trim()} aria-label="Ask AI market analyst">{loading ? <Loader2 className="animate-spin" /> : <Send />}</Button>
          </form>
          <p className="text-[10px] text-muted-foreground">AI screens are research aids and may be incomplete or wrong. Verify live prices, filings, liquidity, and risk before trading.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
