// Decision 0011 (§ Décision, 1): no purchase may ever influence the simulation. The simulation cannot read what it
// cannot import, so this test statically scans every source file of packages/sim (and of the one workspace package
// it depends on) and fails on any import that leaves that perimeter, or any mention of entitlements, payments,
// accounts or the world server. If this test fails, do not loosen it: move the code out of the simulation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SIM = resolve(here, '..');
const SIM_SRC = join(SIM, 'src');
const PROTOCOL_SRC = resolve(SIM, '../protocol/src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** Every module specifier: static imports and re-exports, dynamic import(), require(). */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

/** Words that belong to the account and payment side of the house, never to the simulation. */
const FORBIDDEN_WORDS = /entitlement|payment|stripe|\bsku\b|accountId|account_id|apps\/world|@aurane\/world|@aurane\/general/i;

const simFiles = files(SIM_SRC);
const protocolFiles = files(PROTOCOL_SRC);

describe('simulation isolation (decision 0011)', () => {
  it('finds the sources it guards', () => {
    expect(simFiles.length).toBeGreaterThan(10);
    expect(protocolFiles.length).toBeGreaterThan(0);
  });

  it('packages/sim imports nothing but itself and @aurane/protocol', () => {
    const bad: string[] = [];
    for (const f of simFiles) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (spec === '@aurane/protocol') continue;
        if (spec.startsWith('.')) {
          const target = resolve(dirname(f), spec);
          if (target.startsWith(SIM_SRC + '/') || target === SIM_SRC) continue;
        }
        bad.push(`${relative(SIM, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('declares no dependency but @aurane/protocol', () => {
    const pkg = JSON.parse(readFileSync(join(SIM, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@aurane/protocol']);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.optionalDependencies ?? {})).toEqual([]);
  });

  it('never mentions entitlements, payments or the world server, in the simulation or what it imports', () => {
    const hits: string[] = [];
    for (const f of [...simFiles, ...protocolFiles]) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (FORBIDDEN_WORDS.test(line)) hits.push(`${relative(resolve(SIM, '..'), f)}:${i + 1}: ${line.trim()}`); });
    }
    expect(hits).toEqual([]);
  });

  it('@aurane/protocol imports nothing from the workspace', () => {
    const bad = protocolFiles.flatMap((f) => specifiers(readFileSync(f, 'utf8')).filter((s) => s.startsWith('@aurane/') || (s.startsWith('.') && !resolve(dirname(f), s).startsWith(PROTOCOL_SRC))).map((s) => `${relative(PROTOCOL_SRC, f)} → ${s}`));
    expect(bad).toEqual([]);
  });

  it('the scanner itself catches a leak', () => {
    expect(specifiers(`import { x } from '../../apps/world/src/store.js';\nconst y = await import('@aurane/world');`)).toEqual(['../../apps/world/src/store.js', '@aurane/world']);
    expect(FORBIDDEN_WORDS.test('if (hasEntitlement(colony)) speed *= 2;')).toBe(true);
  });
});
