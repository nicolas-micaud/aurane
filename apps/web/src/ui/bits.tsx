// Small shared pieces of the game UI.
import type { Resource } from '@aurane/protocol';
import { Icon } from './Icon.js';

export const RES: Resource[] = ['metal', 'energy', 'food', 'crystal'];
export const fmt = (n: number): string => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0));
export const hms = (s: number): string => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };

export function Cost({ cost }: { cost: Partial<Record<Resource, number | undefined>> }) {
  return <span class="cost">{RES.filter((r) => cost[r]).map((r) => <span key={r} class={`r-${r}`}><Icon name={r} size={12} />{cost[r]}</span>)}</span>;
}
