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
  if (c?.alliance) for (const m of w.alliances[c.alliance]?.members ?? []) out.add(m);
  for (const id of w.treatiesByColony[colony] ?? []) {
    const t = w.treaties[id]!;
    if (t.kind !== 'transit' && t.kind !== 'federation') continue;
    if (t.until !== null && t.until <= w.time) continue;
    if (t.a === colony) out.add(t.b);
    else if (t.b === colony) out.add(t.a);
  }
  return out;
}
