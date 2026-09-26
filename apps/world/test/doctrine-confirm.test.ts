// Doctrine confirmation (on by default): the player reads what the General will do while they are away before
// it governs the Colony. A pending doctrine survives a restart, is replaced by the next one, and is dropped when
// left unanswered past its TTL; the active doctrine stays in force meanwhile.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { FilePendingDoctrineStore } from '../src/llmstore.js';
import { FileStore } from '../src/store.js';

const env = (dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '2', SEASON_SEED: 'doctrine-test', ...extra });

async function boot(dir: string, extra: Record<string, string> = {}): Promise<Engine> {
  const cfg = loadConfig(env(dir, extra));
  const engine = new Engine(cfg, new FileStore(dir), { env: {}, pendingStore: new FilePendingDoctrineStore(dir) });
  await engine.init();
  await engine.general.init();
  return engine;
}

describe('doctrine confirmation', () => {
  it('is on by default; DOCTRINE_CONFIRM=0 (or false) turns it off', () => {
    expect(loadConfig({}).doctrineConfirm).toBe(true);
    expect(loadConfig({ DOCTRINE_CONFIRM: '1' }).doctrineConfirm).toBe(true);
    expect(loadConfig({ DOCTRINE_CONFIRM: '0' }).doctrineConfirm).toBe(false);
    expect(loadConfig({ DOCTRINE_CONFIRM: 'false' }).doctrineConfirm).toBe(false);
    expect(loadConfig({}).doctrinePendingTtlMs).toBe(24 * 3600 * 1000);
    expect(loadConfig({ DOCTRINE_PENDING_TTL_H: '2' }).doctrinePendingTtlMs).toBe(2 * 3600 * 1000);
  });

  it('holds the doctrine, keeps the active one, replaces the pending one with the next, and survives a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-doctrine-'));
    let engine = await boot(dir);
    const made = await engine.createGuest('Nick', 'guild', 'oriel');
    if ('error' in made) throw new Error(made.error);
    const id = made.colony.id;
    const before = structuredClone(engine.world.colonies[id]!.policy);

    const first = (await engine.doctrine(id, 'Défends la capitale, ne déclenche jamais la guerre sans moi.', 'fr'))!;
    expect(first.applied).toBe(false);
    expect(first.pending).not.toBeNull();
    expect(engine.world.colonies[id]!.policy).toEqual(before);

    const second = (await engine.doctrine(id, 'Étends-toi vite, attaque les faibles.', 'fr'))!;
    expect(second.pending!.id).not.toBe(first.pending!.id);
    expect(engine.general.pendingDoctrine(id)!.id).toBe(second.pending!.id);
    expect(engine.confirmDoctrine(id, first.pending!.id).ok).toBe(false); // the replaced one is gone

    await engine.stop();
    engine = await boot(dir);
    expect(engine.general.pendingDoctrine(id)?.id).toBe(second.pending!.id);
    expect(engine.world.colonies[id]!.policy).toEqual(before);
    expect(engine.confirmDoctrine(id, second.pending!.id).ok).toBe(true);
    expect(engine.general.pendingDoctrine(id)).toBeNull();

    // Once confirmed, a restart does not bring it back.
    await engine.stop();
    engine = await boot(dir);
    expect(engine.general.pendingDoctrine(id)).toBeNull();
    await engine.stop();
  });

  it('drops a doctrine left unanswered past its TTL, and a discarded one; the active doctrine stays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-doctrine-'));
    const engine = await boot(dir, { DOCTRINE_PENDING_TTL_H: '1' });
    const made = await engine.createGuest('Kes', 'corsairs', 'kestrel');
    if ('error' in made) throw new Error(made.error);
    const id = made.colony.id;
    const before = structuredClone(engine.world.colonies[id]!.policy);

    const r = (await engine.doctrine(id, 'Défends la capitale.', 'fr'))!;
    const later = Date.now() + 2 * 3600 * 1000;
    expect(engine.general.confirmDoctrine(id, r.pending!.id, later).ok).toBe(false);
    expect(engine.general.pendingDoctrine(id)).toBeNull();
    expect(engine.world.colonies[id]!.policy).toEqual(before);

    const again = (await engine.doctrine(id, 'Défends la capitale.', 'fr'))!;
    expect(engine.general.pendingDoctrine(id)?.id).toBe(again.pending!.id);
    engine.general.discardDoctrine(id);
    expect(engine.general.pendingDoctrine(id)).toBeNull();
    await engine.general.flushPending();
    expect(await new FilePendingDoctrineStore(dir).loadAll()).toEqual([]);
    expect(engine.world.colonies[id]!.policy).toEqual(before);
    await engine.stop();
  });

  it('applies at once when confirmation is turned off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-doctrine-'));
    const engine = await boot(dir, { DOCTRINE_CONFIRM: '0' });
    const made = await engine.createGuest('Old', 'concordat', 'vane');
    if ('error' in made) throw new Error(made.error);
    const r = (await engine.doctrine(made.colony.id, 'Ne déclenche jamais la guerre.', 'fr'))!;
    expect(r.applied).toBe(true);
    expect(r.pending).toBeNull();
    expect(engine.world.colonies[made.colony.id]!.policy.aggression).toBe(0);
    await engine.stop();
  });
});
