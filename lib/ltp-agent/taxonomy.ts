// The fixed vocabulary of the post-trade review. The model must pick from these; anything else is mapped to `other` with a note.
export const MISTAKE_TAGS = [
  'level_shifted_after_entry', 'scenario_flipped_after_entry', 'entered_late_hit', 'coa2_conflict_ignored', 'soc_conflict', 'stop_too_tight', 'stop_too_wide', 'target_too_far',
  'premium_decay', 'gamma_spike', 'slippage_or_spread', 'late_in_day', 'expiry_day_effect', 'proxy_extension_error', 'data_gap', 'other',
] as const;
export type MistakeTag = (typeof MISTAKE_TAGS)[number];

export const OUTCOME_CLASSES = ['good_trade_good_result', 'good_trade_bad_result', 'bad_trade', 'lucky_win'] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];
