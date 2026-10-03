// For diagnosing a missing LLM key: the names (never the values) of API-key-style variables that have a value.
// FYERS variables are left out so broker credentials never appear in a status view.
export function keyVariableNames(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => env[name] && /(API_?KEY|_KEY)$/i.test(name) && !/^FYERS_/i.test(name)).sort();
}
