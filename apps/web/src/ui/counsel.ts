// The Counsel's bookkeeping without a browser (decision 0009, issue #33): which card that left the stack reached its
// goal and earns a "✓ Done" mark, and which only made room for the next tier's advice. Game.tsx renders; this decides.
import type { Command } from '@aurane/protocol';
import { counselDoneTitle, counselTitle, type CounselKind, type PlayerView } from '@aurane/sim';

/** A card as it was on screen: enough to tell later whether its goal was reached. */
export interface ShownCard { id: string; title: string; command: Command | null }

/**
 * Whether the goal of a card that left the Counsel is reached. The simulation only sends its top three options, so
 * a card also leaves when a more urgent one pushes it out (the first relay opens tier 1 and the doctrine card drops
 * below "Enter your system"): that card is not done and must not say so. Done means: the player answered it
 * (Do it, or went where a look-only card pointed), or the world shows its goal (the relay stands, the building is
 * there or queued, the doctrine is written).
 */
export function goalReached(card: ShownCard, v: Pick<PlayerView, 'me' | 'systems' | 'relays'>, answered: ReadonlySet<string>): boolean {
  if (answered.has(card.id)) return true;
  const cmd = card.command;
  if (cmd?.type === 'build_relay') {
    const key = [cmd.a, cmd.b].sort().join('|');
    return v.relays.some((r) => r.owner === v.me.id && [r.a, r.b].sort().join('|') === key);
  }
  if (cmd?.type === 'build') {
    const s = v.systems.find((x) => x.id === cmd.system);
    return !!s && (!!s.buildings?.includes(cmd.building) || !!s.buildQueue?.some((j) => j.building === cmd.building));
  }
  if (card.id === 'doctrine') return !!(v.me.policy.notes ?? '').trim();
  return false;
}

/** The cards that were on screen, are gone now, and reached their goal: the ones that say "✓ Done". */
export function doneCards(before: readonly ShownCard[], nowIds: ReadonlySet<string>, v: Pick<PlayerView, 'me' | 'systems' | 'relays'>, answered: ReadonlySet<string>, skip: ReadonlySet<string>): { id: string; title: string; index: number }[] {
  return before.map((c, index) => ({ c, index }))
    .filter(({ c }) => !nowIds.has(c.id) && !skip.has(c.id) && goalReached(c, v, answered))
    .map(({ c, index }) => ({ id: c.id, title: c.title, index }));
}

/** The kind of a Counsel card from its id (`${kind}:${target}`, see packages/sim counsel.ts), or null (first-minute
 *  cards, ids we do not know). */
export function counselKindOf(id: string): CounselKind | null {
  const head = id.split(':')[0]!;
  const kinds: Record<string, CounselKind> = {
    touch: 'touch_star', enter: 'enter_system', link: 'link_first', warehouse: 'warehouse', antenna: 'antenna', turret: 'turret', defend: 'defend',
    buy_energy: 'buy_energy', sell: 'sell_surplus', train: 'train', treaty: 'treaty', doctrine: 'doctrine', recap: 'read_recap',
  };
  return kinds[head] ?? null;
}

type TitleView = Pick<PlayerView, 'me' | 'systems' | 'colonies'>;

/** The title of a card from its id alone, with its target named as on the card ("Relier Israzen"): the same words
 *  after a reload, on another device, whichever voice wrote the card. `done`: the goal in the past ("Relié Arnophe"). */
export function titleOfCard(id: string, v: TitleView, lang: 'fr' | 'en', fallback?: string, done = false): string {
  const kind = counselKindOf(id);
  if (!kind) return fallback ?? id;
  const target = id.includes(':') ? id.slice(id.indexOf(':') + 1) : '';
  const star = (sid: string): string => v.systems.find((x) => x.id === sid)?.name ?? sid;
  const capital = star(v.me.capital);
  const params: Record<string, string | number> = { system: capital };
  if (kind === 'link_first') params.to = star(target);
  if (kind === 'turret' || kind === 'defend') params.system = star(target);
  if (kind === 'treaty') params.colony = v.colonies.find((c) => c.id === target)?.name ?? target;
  if (kind === 'sell_surplus') params.resource = target;
  if (kind === 'read_recap') params.draw = Number(target) + 1;
  return (done ? counselDoneTitle({ kind, params }, lang) : null) ?? counselTitle({ kind, params }, lang);
}

/** Start of the Draw hour the world is in: what was done since then is « done this Draw ». */
export const drawStart = (time: number): number => Math.floor(time / 3600) * 3600;

/**
 * The cards whose goal was reached this Draw, oldest first, said in the past (« ✓ Fait ce Tirage : Relié Arnophe »,
 * issue #35).
 * The world's journal is the record (`counsel.taken` for the simulation's cards and the places looked at,
 * `counsel.done` for the General's cards, "Do it" or by hand), so the line survives a reload; `session` adds what
 * this screen saw reached otherwise (a doctrine written, a building placed by hand), id → title.
 */
export function doneThisDraw(v: TitleView & Pick<PlayerView, 'time'>, session: ReadonlyMap<string, string>, lang: 'fr' | 'en'): { id: string; title: string }[] {
  const since = drawStart(v.time);
  const ids: string[] = [];
  for (const j of v.me.journal) {
    if ((j.kind === 'counsel.taken' || j.kind === 'counsel.done') && j.note && j.at >= since && !ids.includes(j.note)) ids.push(j.note);
  }
  for (const id of session.keys()) if (!ids.includes(id)) ids.push(id);
  return ids.filter((id) => !id.startsWith('first-')).map((id) => ({ id, title: titleOfCard(id, v, lang, session.get(id), true) }));
}
