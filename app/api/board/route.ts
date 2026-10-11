import { getDatabaseBinding } from '@/db';
import { loadBoard } from '@/lib/board/board';
import { createBoardStore } from '@/lib/board/store';

const NO_STORE = { 'Cache-Control': 'no-store' };

// The ranked board built from the latest stored snapshot. Read-only; it makes no FYERS call.
export async function GET() {
  try {
    return Response.json(await loadBoard(createBoardStore(getDatabaseBinding()), new Date()), { headers: NO_STORE });
  } catch (error) {
    console.error('board load failed', error);
    return Response.json({ error: 'Unable to load the board.' }, { status: 500, headers: NO_STORE });
  }
}
