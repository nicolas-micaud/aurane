// The doctrine card (DOCTRINE_CONFIRM, on by default): what the General will do while the player is away, in plain
// lines, waiting for "Apply" or "Not like that". Pure functions over the server's answers, so the rules are tested
// without a browser: the server keeps one pending doctrine per Colony, a new one replaces it, a message without an
// order leaves it as it is.

export interface PendingCard { id: string; readable: string[]; question: string | null }

type Pending = { id: string; readable?: string[] } | null | undefined;

/** After `POST /api/talk`: a new pending doctrine replaces the card; small talk or a question keeps the current one. */
export function cardAfterTalk(current: PendingCard | null, r: { pending?: Pending; question?: string | null }): PendingCard | null {
  if (!r.pending) return current;
  return { id: r.pending.id, readable: clean(r.pending.readable), question: r.question?.trim() || null };
}

/** After `POST /api/doctrine`: the readable lines come beside `pending: { id }`. */
export function cardAfterDoctrine(current: PendingCard | null, r: { pending?: Pending; readable?: string[]; question?: string | null }): PendingCard | null {
  if (!r.pending) return current;
  return { id: r.pending.id, readable: clean(r.pending.readable ?? r.readable), question: r.question?.trim() || null };
}

/** `GET /api/doctrine/pending`, on load: the card as the player left it, or none. */
export function cardFromPending(body: unknown): PendingCard | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { id?: unknown; readable?: unknown };
  if (typeof b.id !== 'string' || !b.id) return null;
  return { id: b.id, readable: clean(Array.isArray(b.readable) ? b.readable.filter((l): l is string => typeof l === 'string') : []), question: null };
}

/** The persona's line under the card title: each General asks for the yes in its own voice. */
export function pendingLineKey(persona: string): 'pendingVane' | 'pendingKestrel' | 'pendingOriel' | 'pendingSolen' {
  switch (persona) {
    case 'kestrel': return 'pendingKestrel';
    case 'oriel': return 'pendingOriel';
    case 'solen': return 'pendingSolen';
    default: return 'pendingVane';
  }
}

function clean(lines: string[] | undefined): string[] { return (lines ?? []).map((l) => l.trim()).filter(Boolean); }
