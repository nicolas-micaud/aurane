/** Per-colony daily quotas so one player cannot drain the GPU. In-memory; resets on UTC day. */
export class Quota {
  private counters = new Map<string, { day: number; writes: number; events: number }>();
  constructor(private readonly limits: { writes: number; events: number } = { writes: 6, events: 12 }) {}

  private bucket(colony: string): { day: number; writes: number; events: number } {
    const day = Math.floor(Date.now() / 86400000);
    let b = this.counters.get(colony);
    if (!b || b.day !== day) { b = { day, writes: 0, events: 0 }; this.counters.set(colony, b); }
    return b;
  }

  take(colony: string, kind: 'writes' | 'events'): boolean {
    const b = this.bucket(colony);
    if (b[kind] >= this.limits[kind]) return false;
    b[kind]++;
    return true;
  }

  remaining(colony: string): { writes: number; events: number } {
    const b = this.bucket(colony);
    return { writes: this.limits.writes - b.writes, events: this.limits.events - b.events };
  }
}
