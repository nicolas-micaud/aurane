import type { World } from './state.js';

export function sameAlliance(w: World, a: string, b: string): boolean {
  if (a === b) return true;
  const ca = w.colonies[a], cb = w.colonies[b];
  return !!ca?.alliance && ca.alliance === cb?.alliance;
}

export function treatyBetween(w: World, a: string, b: string, kind: string): boolean {
  for (const id of w.treatiesByColony[a] ?? []) {
    const t = w.treaties[id]!;
    if (t.kind !== kind) continue;
    if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) {
      if (t.until === null || t.until > w.time) return true;
    }
  }
  return false;
}

/** Allies are alliance members and federation partners. */
export function isAlly(w: World, a: string, b: string): boolean {
  return sameAlliance(w, a, b) || treatyBetween(w, a, b, 'federation');
}

export function canTransit(w: World, mover: string, relayOwner: string): boolean {
  return mover === relayOwner || isAlly(w, mover, relayOwner) || treatyBetween(w, mover, relayOwner, 'transit');
}

export function atPeace(w: World, a: string, b: string): boolean {
  return isAlly(w, a, b) || treatyBetween(w, a, b, 'nap');
}

/** Owners whose relays `colony` may use for movement and trade reach. */
export function transitSet(w: World, colony: string): Set<string> {
  const out = new Set<string>([colony]);
  const c = w.colonies[colony];
  // A colony younger than the season's threshold (or one sharing our origin) lends nobody its relays: no throwaway bridges.
  const lends = (id: string): boolean => {
    const o = w.colonies[id];
    if (!o || id === colony) return true;
    if (w.time - o.createdAt < w.rules.youngColonyHours * 3600) return false;
    if (!w.rules.sameOriginTrade && c?.origin && c.origin === o.origin) return false;
    return true;
  };
  if (c?.alliance) for (const m of w.alliances[c.alliance]?.members ?? []) if (lends(m)) out.add(m);
  for (const id of w.treatiesByColony[colony] ?? []) {
    const t = w.treaties[id]!;
    if (t.kind !== 'transit' && t.kind !== 'federation') continue;
    if (t.until !== null && t.until <= w.time) continue;
    if (t.a === colony && lends(t.b)) out.add(t.b);
    else if (t.b === colony && lends(t.a)) out.add(t.a);
  }
  return out;
}
