'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { validateParams, type ScreenerParams } from '@/lib/screener/config';
import { paramsEqual } from '@/lib/screener/view';

type NumberKey = 'nearMaUp' | 'nearMaLo' | 'hvPctMax' | 'holdDays' | 'timeExitLeft' | 'takeProfit' | 'stopLoss' | 'slippage';
const NUMBER_FIELDS: { key: NumberKey; label: string; hint: string; step: number }[] = [
  { key: 'nearMaUp', label: 'Pullback: close at most this multiple of the 20-DMA', hint: '1.01 means up to 1% above it (mirrored for bear)', step: 0.005 },
  { key: 'nearMaLo', label: 'Pullback: close at least this multiple of the 50-DMA', hint: '0.97 means no more than 3% below it (mirrored for bear)', step: 0.005 },
  { key: 'hvPctMax', label: 'Skip when realised-volatility percentile is above', hint: '0.60 = the 60th percentile of the last 252 sessions', step: 0.05 },
  { key: 'holdDays', label: 'Hold period (trading days)', hint: 'Enter about 4 weeks before expiry', step: 1 },
  { key: 'timeExitLeft', label: 'Time stop: trading days left at exit', hint: 'Close 7-10 trading days before expiry', step: 1 },
  { key: 'takeProfit', label: 'Profit target (share of maximum profit)', hint: '0.60 = take 60% of the maximum', step: 0.05 },
  { key: 'stopLoss', label: 'Premium stop (share of the debit lost)', hint: '0.50 = exit when the spread loses half its debit', step: 0.05 },
  { key: 'slippage', label: 'Slippage per fill (backtest)', hint: '0.02 = 2%', step: 0.005 },
];

export function ScreenerSettings({ params, defaults, onChange }: { params: ScreenerParams; defaults: ScreenerParams; onChange: (next: ScreenerParams) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const text = (key: string, fallback: number | string) => draft[key] ?? String(fallback);
  const apply = (next: Record<string, unknown>) => {
    const checked = validateParams({ ...params, ...next });
    if (!checked.ok) { setError(checked.error); return; }
    setError('');
    onChange(checked.value);
  };
  const setNumber = (key: NumberKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n)) { setError('Enter a number.'); return; }
    apply({ [key]: n });
  };
  const setBand = (key: 'rsiBull' | 'rsiBear', index: 0 | 1, value: string) => {
    const id = `${key}-${index}`;
    setDraft((d) => ({ ...d, [id]: value }));
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n)) { setError('Enter a number.'); return; }
    const band: [number, number] = [...params[key]];
    band[index] = n;
    apply({ [key]: band });
  };
  const reset = () => { setDraft({}); setError(''); onChange(defaults); };

  const field = 'h-9 w-24 rounded-lg border border-border bg-background px-2 text-right text-sm tabular-nums';
  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">These are the rule parameters from the reference script (dict P). Changes are saved in this browser and apply to the next scan or backtest. The defaults are the tested rules: change one parameter at a time, and do not tune until a result looks good, because that is overfitting.</p>
      {error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {(['rsiBull', 'rsiBear'] as const).map((key) => (
          <fieldset key={key} className="rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">{key === 'rsiBull' ? 'Bull pullback RSI(14) band' : 'Bear bounce RSI(14) band'}</legend>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2">From<input className={field} inputMode="decimal" value={text(`${key}-0`, params[key][0])} onChange={(e) => setBand(key, 0, e.target.value)} /></label>
              <label className="flex items-center gap-2">to<input className={field} inputMode="decimal" value={text(`${key}-1`, params[key][1])} onChange={(e) => setBand(key, 1, e.target.value)} /></label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Default {defaults[key][0]} to {defaults[key][1]}</p>
          </fieldset>
        ))}
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="grid gap-1 rounded-xl border border-border p-4 text-sm">
            <span className="font-medium">{f.label}</span>
            <input className={field} inputMode="decimal" step={f.step} value={text(f.key, params[f.key])} onChange={(e) => setNumber(f.key, e.target.value)} />
            <span className="text-xs text-muted-foreground">{f.hint}. Default {defaults[f.key]}.</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={reset} disabled={paramsEqual(params, defaults) && Object.keys(draft).length === 0}>Reset to the reference defaults</Button>
        {!paramsEqual(params, defaults) && <span className="text-sm text-amber-700">Custom settings are active.</span>}
      </div>
    </div>
  );
}
