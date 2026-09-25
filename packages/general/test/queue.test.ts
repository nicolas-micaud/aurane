import { describe, expect, it } from 'vitest';
import { MemoryJobStore, PlayerQuota, Scheduler, limitsFromEnv, type Clock, type Job } from '../src/queue/index.js';

class FakeClock implements Clock {
  t = 1_000_000;
  now(): number { return this.t; }
  async sleep(ms: number): Promise<void> { this.t += ms; }
}

describe('scheduler', () => {
  it('runs live dialogue before briefings before the gazette, oldest first within a priority', async () => {
    const clock = new FakeClock();
    const s = new Scheduler(new MemoryJobStore(), clock);
    const order: string[] = [];
    for (const k of ['talk', 'briefing', 'gazette', 'reaction', 'doctrine'] as const) s.handle(k, async (j: Job) => { order.push(`${j.kind}:${String(j.payload)}`); return j.payload; });
    await s.enqueue('gazette', 'gazette', 'g1');
    clock.t += 1;
    await s.enqueue('briefing', 'briefing', 'b1');
    clock.t += 1;
    await s.enqueue('talk', 'talk', 't1');
    clock.t += 1;
    await s.enqueue('briefing', 'briefing', 'b2');
    clock.t += 1;
    await s.enqueue('doctrine', 'doctrine', 'd1');
    expect(await s.drain()).toBe(5);
    expect(order).toEqual(['talk:t1', 'doctrine:d1', 'briefing:b1', 'briefing:b2', 'gazette:g1']);
  });

  it('spreads non-urgent jobs over the window, dedups by key, expires stale jobs', async () => {
    const clock = new FakeClock();
    const store = new MemoryJobStore();
    const s = new Scheduler(store, clock);
    let ran = 0;
    s.handle('briefing', async () => { ran++; return 'ok'; });
    const a = await s.enqueue('briefing', 'briefing', 'x', { key: 'brief:C1', spreadMs: 60000, random: () => 0.5 });
    const b = await s.enqueue('briefing', 'briefing', 'x', { key: 'brief:C1', spreadMs: 60000, random: () => 0.5 });
    expect(b.reused).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await s.drain()).toBe(0);           // jittered 30 s ahead: nothing runs yet
    clock.t += 30000;
    expect(await s.drain()).toBe(1);
    expect(ran).toBe(1);
    expect(await a.result).toBe('ok');
    const stale = await s.enqueue('briefing', 'briefing', 'y', { ttlMs: 1000 });
    clock.t += 5000;
    await s.drain();
    await expect(stale.result).rejects.toThrow(/expired/);
    expect((await store.counts()).expired).toBe(1);
  });

  it('answers with the fallback when the job misses its deadline, and the job still completes', async () => {
    const clock = new FakeClock();
    const s = new Scheduler(new MemoryJobStore(), clock);
    let release: (() => void) | null = null;
    s.handle('talk', async () => { await new Promise<void>((r) => { release = r; }); return 'late answer'; });
    const p = s.enqueueWithDeadline('talk', 'talk', 'hello', 20, () => 'in-character fallback');
    // the drain starts the handler, which blocks until released
    const drained = s.drain();
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(r.result).toBe('in-character fallback');
    release!();
    await drained;
    expect((await s.counts()).done).toBe(1);
  });

  it('requeues jobs left running by a crashed process', async () => {
    const store = new MemoryJobStore();
    await store.put({ id: 'j1', kind: 'gazette', task: 'gazette', priority: 4, colony: null, key: null, payload: 1, createdAt: 0, runAfter: 0, expiresAt: 1e15, attempts: 1, state: 'running' });
    expect(await store.recoverRunning()).toBe(1);
    expect((await store.counts()).queued).toBe(1);
  });
});

describe('player quota', () => {
  it('caps dialogue per hour and per day, doctrine and briefings per day, and resets on the clock', () => {
    let t = 0;
    const q = new PlayerQuota({ talkPerHour: 2, talkPerDay: 3, doctrinePerDay: 1, briefingPerDay: 1 }, () => t);
    expect(q.take('c', 'talk')).toBe(true);
    expect(q.take('c', 'talk')).toBe(true);
    expect(q.take('c', 'talk')).toBe(false);       // hour cap
    t = 3600000;
    expect(q.take('c', 'talk')).toBe(true);        // new hour
    expect(q.take('c', 'talk')).toBe(false);       // day cap (3)
    expect(q.take('c', 'doctrine')).toBe(true);
    expect(q.take('c', 'doctrine')).toBe(false);
    expect(q.take('c', 'briefing')).toBe(true);
    expect(q.take('c', 'briefing')).toBe(false);
    expect(q.remaining('c').talkDay).toBe(0);
    t = 86400000;
    expect(q.take('c', 'talk')).toBe(true);        // new day
    expect(q.take('other', 'doctrine')).toBe(true); // per colony
  });
  it('reads limits from the environment with sane defaults', () => {
    expect(limitsFromEnv({}).talkPerHour).toBe(20);
    expect(limitsFromEnv({ LLM_QUOTA_TALK_HOUR: '5', LLM_QUOTA_DOCTRINE_DAY: 'x' } as NodeJS.ProcessEnv)).toMatchObject({ talkPerHour: 5, doctrinePerDay: 12 });
  });
});
