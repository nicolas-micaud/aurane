// The General shows, then does (decision 0009): "Show me" takes the player to the very button a card would press
// and makes it blink; "Do it" goes there first, acts, then leaves the path on screen so the player can do it alone
// next time. This module holds the signals the screens read; Game.tsx drives them.
import { signal } from '@preact/signals';
import type { Command, Resource } from '@aurane/protocol';

/** The control being pointed at (each button knows its key) and the sentence that says where it lives. */
export const teach = signal<{ key: string; hint: string; done: boolean } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export function pointAt(key: string | null, hint: string, done = false, ms = 15000): void {
  teach.value = { key: key ?? '', hint, done };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { teach.value = null; }, ms);
}

export function stopTeaching(): void { if (timer) clearTimeout(timer); timer = null; teach.value = null; }

/** Class for a control: 'teach' while the General points at it. Components read `teach` once and call this. */
export const teachClass = (tv: { key: string; done: boolean } | null, key: string): string => (tv && !tv.done && tv.key === key ? 'teach' : '');

/** Where the system view lands when it opens for a demonstration: which dock tab, which orbit's free slot. */
export const pendingDemo = signal<{ system: string; dock: 'plateau' | 'fleets'; orbit: 1 | 2 | 3 | null } | null>(null);

/** Arms the system scene to flash the next thing that appears on the plateau (bumped right before the General acts). */
export const sceneFlashReq = signal(0);

/** The Market form pre-filled with the General's order, so "Show me" shows the exact order to place. */
export const marketPrefill = signal<{ region: string; resource: Resource; side: 'buy' | 'sell'; qty: number; price: number } | null>(null);

/** The key of the button that would send this command, when a screen has one. */
export function teachKey(cmd: Command): string | null {
  switch (cmd.type) {
    case 'build_relay': return `link:${cmd.b}`;
    case 'build': return `build:${cmd.building}`;
    case 'train': return `train:${cmd.unit}`;
    case 'fleet_order': return `fleet:${cmd.order}:${cmd.fleet}`;
    case 'market_order': return 'market:place';
    case 'treaty': return `treaty:${cmd.kind}:${cmd.with}`;
    case 'decree': return `decree:${cmd.kind}`;
    default: return null;
  }
}
