import { describe, expect, it } from 'vitest';

import { checkRequestOrigin } from './guard';

const headers = (values: Record<string, string>) => new Headers(values);

describe('checkRequestOrigin', () => {
  it('accepts a same-origin JSON request', () => {
    expect(checkRequestOrigin(headers({ 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });

  it('accepts a JSON request with a charset and no origin headers (non-browser client)', () => {
    expect(checkRequestOrigin(headers({ 'content-type': 'application/json; charset=utf-8', host: 'localhost:3000' }))).toBeNull();
  });

  it('rejects a body that is not JSON, which is what a cross-site simple request would send', () => {
    expect(checkRequestOrigin(headers({ 'content-type': 'text/plain', host: 'localhost:3000' }))).toMatch(/application\/json/);
    expect(checkRequestOrigin(headers({ host: 'localhost:3000' }))).toMatch(/application\/json/);
  });

  it('rejects cross-site and same-site fetches and a foreign Origin', () => {
    const json = { 'content-type': 'application/json', host: 'localhost:3000' };
    expect(checkRequestOrigin(headers({ ...json, 'sec-fetch-site': 'cross-site' }))).toMatch(/cross-site/i);
    expect(checkRequestOrigin(headers({ ...json, 'sec-fetch-site': 'same-site' }))).toMatch(/cross-site/i);
    expect(checkRequestOrigin(headers({ ...json, origin: 'https://evil.example' }))).toMatch(/cross-site/i);
  });
});
