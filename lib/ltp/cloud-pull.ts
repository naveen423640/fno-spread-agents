// Merges days recorded by the cloud recorder (cloud-recorder/) into this app's database. Server-side: the recorder's secret never reaches the browser.
import { importExport, type Export } from '@/cloud-recorder/src/import';
import type { D1Like } from '@/lib/agents/store';
import { UNDERLYINGS } from './recorder';

export type CloudPullResult = { ok: true; snapshots: number; gaps: number } | { ok: false; status: number; error: string };

export async function pullFromCloud(deps: { db: D1Like; url: string | undefined; secret: string | undefined; dates: string[]; fetchImpl?: typeof fetch }): Promise<CloudPullResult> {
  if (!deps.url || !deps.secret) return { ok: false, status: 503, error: 'Set LTP_RECORDER_URL and LTP_RECORDER_SECRET in .env.local and restart the app.' };
  const base = deps.url.replace(/\/$/, '');
  let snapshots = 0;
  let gaps = 0;
  try {
    for (const date of deps.dates) {
      for (const underlying of UNDERLYINGS) {
        const response = await (deps.fetchImpl ?? fetch)(`${base}/export?date=${date}&underlying=${encodeURIComponent(underlying)}`, { headers: { Authorization: `Bearer ${deps.secret}` } });
        if (!response.ok) return { ok: false, status: 502, error: `The cloud recorder answered ${response.status}${response.status === 401 ? ': LTP_RECORDER_SECRET is not the secret set on the Worker.' : '.'}` };
        const done = await importExport(deps.db, (await response.json()) as Export);
        snapshots += done.snapshots;
        gaps += done.gaps;
      }
    }
    return { ok: true, snapshots, gaps };
  } catch {
    return { ok: false, status: 502, error: 'Could not pull from the cloud recorder.' };
  }
}
