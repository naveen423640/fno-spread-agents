import { z } from 'zod';

export const SOURCE_KINDS = ['regime', 'price_oi', 'option_chain', 'news', 'filing', 'fundamentals', 'other'] as const;
export const ANALYST_ROLES = ['technical', 'options_oi', 'news', 'fundamentals'] as const;
export const VERDICTS = ['APPROVE', 'REDUCE', 'DELAY', 'VETO'] as const;

export const sourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  title: z.string(),
  url: z.string().nullable(),
  retrieved_at: z.string(),
}).strict();

const claimSchema = z.object({
  claim: z.string().min(1),
  type: z.enum(['fact', 'interpretation']),
  source_ids: z.array(z.string()),
}).strict();

const analystReportSchema = z.object({
  role: z.enum(ANALYST_ROLES),
  summary: z.string(),
  claims: z.array(claimSchema),
  missing_evidence: z.array(z.string()),
}).strict();

const verdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  reduce_to_lots: z.number().optional(),
  delay_to: z.literal('11:00').optional(),
  reasons: z.array(claimSchema).min(1),
  missing_evidence: z.array(z.string()),
  confidence_note: z.string(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.verdict === 'REDUCE') {
    if (value.reduce_to_lots === undefined || !Number.isInteger(value.reduce_to_lots) || value.reduce_to_lots < 1) issue('REDUCE needs an integer reduce_to_lots of at least 1');
  } else if (value.reduce_to_lots !== undefined) issue('reduce_to_lots is only allowed on REDUCE');
  if (value.verdict === 'DELAY') {
    if (value.delay_to !== '11:00') issue('DELAY needs delay_to "11:00"');
  } else if (value.delay_to !== undefined) issue('delay_to is only allowed on DELAY');
});

export type Source = z.infer<typeof sourceSchema>;
export type AnalystReport = z.infer<typeof analystReportSchema>;
export type Verdict = z.infer<typeof verdictSchema>;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function unsourcedOrUnknown(claims: { claim: string; type: string; source_ids: string[] }[], known: ReadonlySet<string>) {
  for (const item of claims) {
    if (item.type === 'fact' && item.source_ids.length === 0) return `fact without a source: "${item.claim}"`;
    const unknown = item.source_ids.find((id) => !known.has(id));
    if (unknown) return `unknown source id "${unknown}"`;
  }
  return null;
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, claimsOf: (value: T) => { claim: string; type: string; source_ids: string[] }[], known: ReadonlySet<string>): ParseResult<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ') };
  const problem = unsourcedOrUnknown(claimsOf(parsed.data), known);
  return problem ? { ok: false, error: problem } : { ok: true, value: parsed.data };
}

export function parseVerdict(raw: unknown, knownSourceIds: ReadonlySet<string>): ParseResult<Verdict> {
  return parseWith(verdictSchema, raw, (value) => value.reasons, knownSourceIds);
}

export function parseAnalystReport(raw: unknown, knownSourceIds: ReadonlySet<string>): ParseResult<AnalystReport> {
  return parseWith(analystReportSchema, raw, (value) => value.claims, knownSourceIds);
}
