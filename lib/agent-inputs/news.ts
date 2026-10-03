import type { AnalystInput } from '../agents/orchestrator';
import type { Source } from '../agents/schemas';
import { marketSnapshot } from '../market-snapshot';
import { unavailable, type GatherArgs, type GatherDeps } from './common';

const MAX_ITEMS = 8;
const SOURCE_NOTE = 'Google News RSS; terms of use and long-term availability are unverified.';

const decode = (text: string) => text
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .trim();

function tag(block: string, name: string) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? decode(match[1]) : '';
}

export function parseRss(xml: string): { title: string; link: string; published: Date }[] {
  const items: { title: string; link: string; published: Date }[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const published = new Date(tag(match[1], 'pubDate'));
    const title = tag(match[1], 'title');
    if (!title || Number.isNaN(published.getTime())) continue;
    items.push({ title, link: tag(match[1], 'link'), published });
  }
  return items;
}

export async function gatherNews(args: GatherArgs, deps: GatherDeps): Promise<AnalystInput> {
  const { symbol, asOf, now } = args;
  const name = marketSnapshot.find((stock) => stock.symbol === symbol)?.name ?? symbol;
  try {
    const url = new URL('https://news.google.com/rss/search');
    url.searchParams.set('q', `${name} NSE`);
    url.searchParams.set('hl', 'en-IN');
    url.searchParams.set('gl', 'IN');
    url.searchParams.set('ceid', 'IN:en');
    const response = await deps.fetchImpl(url.toString(), { headers: { Accept: 'application/rss+xml' } });
    if (!response.ok) return unavailable('news', asOf, `news feed answered HTTP ${response.status}`);
    const cutoff = new Date(`${asOf}T23:59:59+05:30`).getTime();
    const items = parseRss(await response.text()).filter((item) => item.published.getTime() <= cutoff).slice(0, MAX_ITEMS);
    if (!items.length) return unavailable('news', asOf, 'no news items found on or before the as-of date');
    const sources: Source[] = items.map((item, index) => ({ id: `news-${index + 1}`, kind: 'news', title: item.title.slice(0, 200), url: item.link || null, retrieved_at: now.toISOString() }));
    return {
      role: 'news',
      asOf,
      available: true,
      sources,
      payload: { count: items.length, sourceNote: SOURCE_NOTE },
      untrustedText: items.map((item, index) => ({ sourceId: `news-${index + 1}`, text: `${item.title} (${item.published.toISOString()})`.slice(0, 500) })),
    };
  } catch {
    return unavailable('news', asOf, 'news feed could not be reached');
  }
}
