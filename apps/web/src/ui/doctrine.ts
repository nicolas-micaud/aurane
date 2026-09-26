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

/**
 * After `POST /api/talk`: the General answered a doctrine with a question and holds nothing for the player's yes. The
 * client says so under the bubble (« En attente de ta réponse — doctrine actuelle inchangée », issue #35): the order
 * was heard, nothing applies until the answer.
 */
export function awaitingAnswer(card: PendingCard | null, r: { pending?: Pending; question?: string | null; policyChanged?: boolean }): boolean {
  return !!r.question?.trim() && !r.pending && !r.policyChanged && !card;
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

/** Lines shown before « voir tout »: the card must leave its buttons in view on a 390x844 phone. */
export const CARD_LINES = 4;

/** The lines the card shows: all when expanded or when only one would be hidden (a « voir tout » for one line costs as
 *  much room as the line), else the first `max`; `hidden` is how many « voir tout » reveals. */
export function visibleLines(lines: string[], expanded: boolean, max = CARD_LINES): { shown: string[]; hidden: number } {
  if (expanded || lines.length <= max + 1) return { shown: lines, hidden: 0 };
  return { shown: lines.slice(0, max), hidden: lines.length - max };
}

function clean(lines: string[] | undefined): string[] { return (lines ?? []).map((l) => l.trim()).filter(Boolean); }
