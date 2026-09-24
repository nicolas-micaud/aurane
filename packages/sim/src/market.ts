import type { Resource } from '@starnet/protocol';
import type { MarketOrder } from './state.js';

export interface Fill { order: string; colony: string; qty: number; price: number }
export interface ClearingResult { price: number | null; qty: number; fills: Fill[] }

/**
 * Uniform-price double auction: one settlement price per resource and region, applied to
 * every order that clears. Buyers pay at most their limit, sellers receive at least theirs.
 * Fair, simple to explain ("I sell 40 food at 3 or better"), and immune to speed.
 */
export function clearAuction(orders: readonly MarketOrder[]): ClearingResult {
  const buys = orders.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price || a.placedAt - b.placedAt);
  const sells = orders.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price || a.placedAt - b.placedAt);
  if (!buys.length || !sells.length) return { price: null, qty: 0, fills: [] };

  // Walk both books to find the clearing quantity.
  let bi = 0, si = 0, bLeft = buys[0]!.qty, sLeft = sells[0]!.qty, qty = 0;
  let lastBuy = 0, lastSell = 0;
  while (bi < buys.length && si < sells.length && buys[bi]!.price >= sells[si]!.price) {
    const q = Math.min(bLeft, sLeft);
    qty += q; bLeft -= q; sLeft -= q;
    lastBuy = buys[bi]!.price; lastSell = sells[si]!.price;
    if (bLeft === 0) { bi++; bLeft = buys[bi]?.qty ?? 0; }
    if (sLeft === 0) { si++; sLeft = sells[si]?.qty ?? 0; }
  }
  if (qty === 0) return { price: null, qty: 0, fills: [] };
  const price = Math.round(((lastBuy + lastSell) / 2) * 100) / 100;

  // Allocate at the uniform price; marginal orders may be partially filled (price-time priority).
  const fills: Fill[] = [];
  let remaining = qty;
  for (const b of buys) {
    if (remaining <= 0 || b.price < price) break;
    const q = Math.min(b.qty, remaining);
    fills.push({ order: b.id, colony: b.colony, qty: q, price });
    remaining -= q;
  }
  remaining = qty;
  for (const s of sells) {
    if (remaining <= 0 || s.price > price) break;
    const q = Math.min(s.qty, remaining);
    fills.push({ order: s.id, colony: s.colony, qty: q, price });
    remaining -= q;
  }
  return { price, qty, fills };
}

export const marketKey = (region: string, resource: Resource): string => `${region}:${resource}`;
