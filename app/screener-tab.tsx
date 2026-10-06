'use client';

import { useEffect, useState } from 'react';
import { Link2, ScanSearch } from 'lucide-react';

import { ScreenerBacktest } from '@/app/screener-backtest';
import { ScreenerScan } from '@/app/screener-scan';
import { ScreenerSettings } from '@/app/screener-settings';
import { validateRules, type RuleSet } from '@/lib/screener/rules';
import { Button } from '@/components/ui/button';
import type { ConfigView } from '@/lib/screener/api';
import { DEFAULT_PARAMS, type ScreenerParams } from '@/lib/screener/config';
import { loadRules, loadSettings, saveRules, saveSettings } from '@/lib/screener/view';

type Panel = 'scan' | 'backtest' | 'settings';
const PANELS: { id: Panel; label: string }[] = [{ id: 'scan', label: 'Scan' }, { id: 'backtest', label: 'Backtest' }, { id: 'settings', label: 'Settings' }];

const browserStorage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

export function ScreenerTab() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [configError, setConfigError] = useState('');
  const [source, setSource] = useState('synthetic');
  const [panel, setPanel] = useState<Panel>('scan');
  // Settings are per browser. This tab only mounts on the client, so reading storage in the initialiser is safe.
  const [params, setParams] = useState<ScreenerParams>(() => loadSettings(browserStorage()));
  const [rules, setRules] = useState<RuleSet>(() => loadRules(browserStorage()));
  const [loginNeeded, setLoginNeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/screener/config', { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<ConfigView>) : Promise.reject(new Error('config'))))
      .then((body) => {
        if (cancelled) return;
        setConfig(body);
        const live = body.sources.find((s) => s.id !== 'synthetic' && s.available);
        if (live) setSource(live.id);
      })
      .catch(() => { if (!cancelled) setConfigError('The screener could not load its configuration.'); });
    return () => { cancelled = true; };
  }, []);

  const changeParams = (next: ScreenerParams) => { setParams(next); saveSettings(browserStorage(), next); };
  const changeRules = (next: RuleSet) => { setRules(next); saveRules(browserStorage(), next); };
  const rulesError = validateRules(rules).ok ? '' : (validateRules(rules) as { error: string }).error;
  const live = source !== 'synthetic';

  return (
    <section className="space-y-4" aria-label="Screener">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ScanSearch className="size-5" />F&amp;O trend-pullback screener</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">Monthly debit spreads on liquid F&amp;O stocks: bull call spreads in uptrends that have pulled back, bear put spreads in downtrends that have bounced. Read-only: this tab never places, changes or cancels an order.</p>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Data source
          <select className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground" value={source} onChange={(event) => { setSource(event.target.value); setLoginNeeded(false); }}>
            {(config?.sources ?? [{ id: 'synthetic', label: 'Synthetic data (dry run)', available: true }]).map((s) => (
              <option key={s.id} value={s.id} disabled={!s.available}>{s.label}{s.available ? '' : ' (sign in first)'}</option>
            ))}
          </select>
        </label>
      </div>

      {configError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{configError}</p>}
      {!live && <p className="rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">Synthetic data: generated random prices, for testing the screen only. Nothing here says anything about any real stock.</p>}
      {loginNeeded && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>The broker login is missing or has expired. Sign in again, then run it again. Nothing retries automatically.</span>
          <Button size="sm" variant="outline" onClick={() => window.location.assign('/api/fyers/login')}><Link2 />Connect FYERS</Button>
        </div>
      )}

      <div className="flex rounded-lg bg-muted p-1" role="tablist" aria-label="Screener sections">
        {PANELS.map((p) => (
          <Button key={p.id} size="sm" role="tab" aria-selected={panel === p.id} variant={panel === p.id ? 'secondary' : 'ghost'} onClick={() => setPanel(p.id)}>{p.label}</Button>
        ))}
      </div>

      {panel === 'scan' && <ScreenerScan key={`scan-${source}`} source={source} params={params} rules={rules} rulesError={rulesError} config={config} onLogin={() => setLoginNeeded(true)} />}
      {panel === 'backtest' && <ScreenerBacktest key={`backtest-${source}`} source={source} params={params} rules={rules} rulesError={rulesError} minTrades={config?.minTrades ?? 100} onLogin={() => setLoginNeeded(true)} />}
      {panel === 'settings' && <ScreenerSettings params={params} defaults={config?.defaults ?? DEFAULT_PARAMS} onChange={changeParams} rules={rules} onRulesChange={changeRules} />}

      <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
        Analysis, not advice. Screens and backtests are not recommendations; options are risky and a debit spread can lose its whole debit. Always check earnings and news dates manually, and confirm the expiry, lot size and prices with your broker before trading.
      </footer>
    </section>
  );
}
