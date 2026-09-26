// A new seed or radius in the configuration starts a new season: the old world is archived, invitations
// spent on colonies of that world become usable again.
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { FileStore } from '../src/store.js';

describe('season change', () => {
  it('archives the previous world, starts a fresh galaxy and frees the invitations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aurane-season-'));
    const env = { SNAPSHOT_DIR: dir, GALAXY_RADIUS: '4', NPC_COUNT: '3', SEASON_SEED: 'beta-1', REQUIRE_INVITE: '1', INVITE_CODES: 'AUR-TEST' };
    const first = new Engine(loadConfig(env), new FileStore(dir));
    await first.init();
    const made = await first.createGuest('Nick', 'guild', 'oriel', 'aur-test');
    expect('token' in made).toBe(true);
    const oldSeed = first.world.seed;
    const oldColony = 'token' in made ? made.colony.id : '';
    await first.stop();
    expect(await first.createGuest('Again', 'guild', 'oriel', 'aur-test')).toEqual({ error: 'invalid invite' }); // spent

    // Same seed and radius: the world resumes.
    const same = new Engine(loadConfig(env), new FileStore(dir));
    await same.init();
    expect(same.world.seed).toBe(oldSeed);
    expect(same.world.colonies[oldColony]).toBeDefined();
    await same.stop();

    // New seed and radius: a new season.
    const next = new Engine(loadConfig({ ...env, SEASON_SEED: 'beta-2', GALAXY_RADIUS: '5' }), new FileStore(dir));
    await next.init();
    expect(next.world.seed).not.toBe(oldSeed);
    expect(next.world.galaxy.radius).toBe(5);
    expect(next.world.colonies[oldColony]).toBeUndefined();
    expect((await readdir(dir)).some((f) => f.startsWith('world-') && f.endsWith('.json'))).toBe(true);
    // The old token no longer opens a colony; the invitation works again.
    expect(await next.authenticate('token' in made ? made.token : '')).toBeNull();
    const again = await next.createGuest('Nick', 'guild', 'oriel', 'AUR-TEST');
    expect('token' in again).toBe(true);
    // Ids never come back from one season to the next: the new first human is not the old one's namesake (its token,
    // its account link and its General's memory are keyed on that id).
    expect('token' in again ? again.colony.id : oldColony).not.toBe(oldColony);
    expect(await next.authenticate('token' in made ? made.token : '')).toBeNull();
    await next.stop();
  });
});
