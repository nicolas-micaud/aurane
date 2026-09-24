import { describe, expect, it } from 'vitest';
import { runSeason, summarize } from '../src/season.js';

describe('accelerated season', () => {
  it('runs three days with forty colonies without anomalies and with activity', () => {
    const opts = { seed: 'test', days: 3, colonies: 40, radius: 6, decisionMinutes: 30 };
    const w = runSeason(opts);
    const r = summarize(w, opts);
    expect(r.anomalies).toEqual([]);
    expect(r.colonies).toBe(40);
    expect(r.relays).toBeGreaterThan(40);
    expect(r.medianConnected).toBeGreaterThan(1);
  });
  it('is reproducible', () => {
    const opts = { seed: 'repro', days: 1, colonies: 12, radius: 5, decisionMinutes: 30 };
    const a = summarize(runSeason(opts), opts), b = summarize(runSeason(opts), opts);
    expect(a).toEqual(b);
  });
});
