'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ScreenerParams } from '@/lib/screener/config';
import { DEFAULT_RULES, describeCondition, FIELD_LABEL, FIELDS, OPS, referenceRules, ROLES, validateRules, type Condition, type Field, type Op, type Right, type RuleSet } from '@/lib/screener/rules';

type Side = 'bull' | 'bear';
const SELECT = 'h-9 rounded-lg border border-border bg-background px-2 text-sm';
const NUMBER = 'h-9 w-24 rounded-lg border border-border bg-background px-2 text-right text-sm tabular-nums';
const OP_LABEL: Record<Op, string> = { '>': 'is above', '>=': 'is at least', '<': 'is below', '<=': 'is at most', between: 'is between' };
const NEW_RULE: Condition = { left: 'rsi', op: '>', right: { kind: 'value', value: 50 }, role: 'filter' };

export function ScreenerRules({ rules, params, onChange }: { rules: RuleSet; params: ScreenerParams; onChange: (next: RuleSet) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [numberError, setNumberError] = useState('');
  const checked = validateRules(rules);

  const setSide = (side: Side, list: Condition[]) => onChange({ ...rules, [side]: list });
  const replace = (side: Side, index: number, next: Condition) => setSide(side, rules[side].map((c, i) => (i === index ? next : c)));
  const key = (side: Side, index: number, part: string) => `${side}:${index}:${part}`;

  const commit = (side: Side, index: number, part: 'value' | 'low' | 'high' | 'multiplier', text: string) => {
    setDraft((d) => ({ ...d, [key(side, index, part)]: text }));
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) { setNumberError('Enter a number.'); return; }
    setNumberError('');
    const c = rules[side][index];
    const right: Right = c.right;
    if (part === 'value' && right.kind === 'value') replace(side, index, { ...c, right: { ...right, value: n } });
    else if (part === 'multiplier' && right.kind === 'field') replace(side, index, { ...c, right: { ...right, multiplier: n } });
    else if ((part === 'low' || part === 'high') && right.kind === 'between') replace(side, index, { ...c, right: { ...right, [part]: n } });
  };
  const shown = (side: Side, index: number, part: string, actual: number) => draft[key(side, index, part)] ?? String(actual);

  const changeOp = (side: Side, index: number, op: Op) => {
    const c = rules[side][index];
    let right: Right = c.right;
    if (op === 'between' && right.kind !== 'between') right = { kind: 'between', low: 0, high: 100 };
    if (op !== 'between' && right.kind === 'between') right = { kind: 'value', value: right.low };
    setDraft({});
    replace(side, index, { ...c, op, right });
  };
  const changeRightKind = (side: Side, index: number, kind: 'value' | 'field') => {
    const c = rules[side][index];
    setDraft({});
    replace(side, index, { ...c, right: kind === 'value' ? { kind: 'value', value: 0 } : { kind: 'field', field: 'sma200', multiplier: 1 } });
  };
  const remove = (side: Side, index: number) => { setDraft({}); setSide(side, rules[side].filter((_, i) => i !== index)); };

  const useReference = () => { setDraft({}); setNumberError(''); onChange({ enabled: true, ...referenceRules(params) }); };
  const clear = () => { setDraft({}); setNumberError(''); onChange({ ...DEFAULT_RULES, enabled: rules.enabled }); };

  return (
    <section aria-label="Custom rules" className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4" checked={rules.enabled} onChange={(e) => onChange({ ...rules, enabled: e.target.checked })} />
          Use my own bull and bear rules for scans and backtests
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={useReference}>Start from the reference rules</Button>
          <Button size="sm" variant="outline" onClick={clear}>Clear all rules</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Each rule compares a field with a number, a range, or another field times a multiplier. Rules on one side must <b>all</b> pass. A <b>filter</b> must pass; a <b>trigger</b> is the confirmation: every filter and trigger passing is a SIGNAL, and every filter passing with a trigger missing is a WATCH. A side with no rules is not scanned. Percent fields (relative strength, volatility) are typed as percentages. Strikes still follow the reference expected-move rule and exits follow the exit settings below.</p>
      {numberError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{numberError}</p>}
      {rules.enabled && !checked.ok && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{checked.error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {(['bull', 'bear'] as const).map((side) => (
          <div key={side} className="space-y-3">
            <h3 className="font-semibold">{side === 'bull' ? 'Bull rules (bull call spread)' : 'Bear rules (bear put spread)'}</h3>
            {rules[side].length === 0 && <p className="text-sm text-muted-foreground">No {side} rules. This side will not be scanned.</p>}
            {rules[side].map((c, index) => (
              <div key={index} className="space-y-1 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label={`${side} rule ${index + 1} field`} className={SELECT} value={c.left} onChange={(e) => { setDraft({}); replace(side, index, { ...c, left: e.target.value as Field }); }}>
                    {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                  </select>
                  <select aria-label={`${side} rule ${index + 1} operator`} className={SELECT} value={c.op} onChange={(e) => changeOp(side, index, e.target.value as Op)}>
                    {OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                  </select>
                  {c.right.kind === 'between' ? (
                    <>
                      <input aria-label={`${side} rule ${index + 1} low`} className={NUMBER} inputMode="decimal" value={shown(side, index, 'low', c.right.low)} onChange={(e) => commit(side, index, 'low', e.target.value)} />
                      <span className="text-sm">and</span>
                      <input aria-label={`${side} rule ${index + 1} high`} className={NUMBER} inputMode="decimal" value={shown(side, index, 'high', c.right.high)} onChange={(e) => commit(side, index, 'high', e.target.value)} />
                    </>
                  ) : (
                    <>
                      <select aria-label={`${side} rule ${index + 1} compare with`} className={SELECT} value={c.right.kind} onChange={(e) => changeRightKind(side, index, e.target.value as 'value' | 'field')}>
                        <option value="value">a number</option><option value="field">another field</option>
                      </select>
                      {c.right.kind === 'value' ? (
                        <input aria-label={`${side} rule ${index + 1} value`} className={NUMBER} inputMode="decimal" value={shown(side, index, 'value', c.right.value)} onChange={(e) => commit(side, index, 'value', e.target.value)} />
                      ) : (
                        <>
                          <input aria-label={`${side} rule ${index + 1} multiplier`} className={NUMBER} inputMode="decimal" value={shown(side, index, 'multiplier', c.right.multiplier)} onChange={(e) => commit(side, index, 'multiplier', e.target.value)} />
                          <span className="text-sm">×</span>
                          <select aria-label={`${side} rule ${index + 1} other field`} className={SELECT} value={c.right.field} onChange={(e) => { setDraft({}); replace(side, index, { ...c, right: { kind: 'field', field: e.target.value as Field, multiplier: (c.right as { multiplier: number }).multiplier } }); }}>
                            {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                          </select>
                        </>
                      )}
                    </>
                  )}
                  <select aria-label={`${side} rule ${index + 1} role`} className={SELECT} value={c.role} onChange={(e) => replace(side, index, { ...c, role: e.target.value as Condition['role'] })}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${side} rule ${index + 1}`} onClick={() => remove(side, index)}><Trash2 /></Button>
                </div>
                <p className="text-xs text-muted-foreground">{describeCondition(c)}</p>
              </div>
            ))}
            <Button size="sm" variant="outline" disabled={rules[side].length >= 20} onClick={() => setSide(side, [...rules[side], NEW_RULE])}><Plus />Add {side} rule</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

// The rules a result was produced with, in plain words: the user's own, or the built-in reference rules.
export function RulesUsed({ rules, params }: { rules: RuleSet | undefined; params: ScreenerParams }) {
  const custom = rules?.enabled ? rules : null;
  const sides = custom ? { bull: custom.bull, bear: custom.bear } : referenceRules(params);
  return (
    <details className="rounded-xl border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{custom ? 'Rules used: your own' : 'Rules used: the built-in reference rules'}</summary>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {(['bull', 'bear'] as const).map((side) => (
          <div key={side}>
            <b>{side === 'bull' ? 'Bull (bull call spread)' : 'Bear (bear put spread)'}</b>
            {sides[side].length === 0 ? <p className="text-muted-foreground">No rules: this side was not scanned.</p> : <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">{sides[side].map((c, i) => <li key={i}>{describeCondition(c)}</li>)}</ol>}
          </div>
        ))}
      </div>
    </details>
  );
}
