import { describe, expect, it } from 'vitest';

import { parseAnalystReport, parseVerdict } from './schemas';

const known = new Set(['regime-1', 'news-1']);
const approve = { verdict: 'APPROVE', reasons: [{ claim: 'Bull regime for 12 sessions', type: 'fact', source_ids: ['regime-1'] }], missing_evidence: [], confidence_note: 'moderate' };

describe('parseVerdict', () => {
  it('accepts a valid APPROVE', () => {
    const result = parseVerdict(approve, known);
    expect(result.ok).toBe(true);
  });

  it('rejects a fact without sources', () => {
    const result = parseVerdict({ ...approve, reasons: [{ claim: 'x', type: 'fact', source_ids: [] }] }, known);
    expect(result.ok).toBe(false);
  });

  it('accepts an interpretation without sources', () => {
    const result = parseVerdict({ ...approve, reasons: [{ claim: 'looks stretched', type: 'interpretation', source_ids: [] }] }, known);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown source id', () => {
    const result = parseVerdict({ ...approve, reasons: [{ claim: 'x', type: 'fact', source_ids: ['made-up'] }] }, known);
    expect(result.ok).toBe(false);
  });

  it('rejects REDUCE without reduce_to_lots', () => {
    expect(parseVerdict({ ...approve, verdict: 'REDUCE' }, known).ok).toBe(false);
  });

  it('rejects REDUCE with a non-integer or zero lot count', () => {
    expect(parseVerdict({ ...approve, verdict: 'REDUCE', reduce_to_lots: 1.5 }, known).ok).toBe(false);
    expect(parseVerdict({ ...approve, verdict: 'REDUCE', reduce_to_lots: 0 }, known).ok).toBe(false);
  });

  it('accepts REDUCE with a positive integer', () => {
    expect(parseVerdict({ ...approve, verdict: 'REDUCE', reduce_to_lots: 2 }, known).ok).toBe(true);
  });

  it('rejects delay_to other than 11:00 and DELAY without it', () => {
    expect(parseVerdict({ ...approve, verdict: 'DELAY', delay_to: '12:00' }, known).ok).toBe(false);
    expect(parseVerdict({ ...approve, verdict: 'DELAY' }, known).ok).toBe(false);
    expect(parseVerdict({ ...approve, verdict: 'DELAY', delay_to: '11:00' }, known).ok).toBe(true);
  });

  it('rejects reduce_to_lots on a non-REDUCE verdict', () => {
    expect(parseVerdict({ ...approve, reduce_to_lots: 2 }, known).ok).toBe(false);
  });

  it('rejects empty reasons, unknown verdicts, extra fields and non-objects', () => {
    expect(parseVerdict({ ...approve, reasons: [] }, known).ok).toBe(false);
    expect(parseVerdict({ ...approve, verdict: 'BUY' }, known).ok).toBe(false);
    expect(parseVerdict({ ...approve, order: 'place' }, known).ok).toBe(false);
    expect(parseVerdict('APPROVE', known).ok).toBe(false);
  });
});

describe('parseAnalystReport', () => {
  const report = { role: 'news', summary: 'Quiet tape', claims: [{ claim: 'No filings today', type: 'fact', source_ids: ['news-1'] }], missing_evidence: [] };

  it('accepts a valid report and rejects unsourced facts and unknown roles', () => {
    expect(parseAnalystReport(report, known).ok).toBe(true);
    expect(parseAnalystReport({ ...report, claims: [{ claim: 'x', type: 'fact', source_ids: [] }] }, known).ok).toBe(false);
    expect(parseAnalystReport({ ...report, role: 'bull' }, known).ok).toBe(false);
  });
});
