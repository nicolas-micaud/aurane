import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, PERSONAS } from '@aurane/protocol';
import { tierUnlocked, wantsEverything } from '../src/alerts.js';
import { converse } from '../src/converse.js';

describe('onboarding lines', () => {
  it('has a first word per General, language and tier, and one for "everything at once"', () => {
    for (const p of PERSONAS) for (const lang of ['fr', 'en'] as const) {
      const seen = new Set<string>();
      for (let tier = 1; tier <= 6; tier++) { const l = tierUnlocked(p, lang, tier); expect(l.length).toBeGreaterThan(40); seen.add(l); }
      expect(seen.size).toBe(6);
      expect(tierUnlocked(p, lang, 6, true)).not.toBe(tierUnlocked(p, lang, 6));
    }
    expect(tierUnlocked('vane', 'fr', 99)).toBe(tierUnlocked('vane', 'fr', 6)); // clamped
  });

  it('reads the "show me everything" intent in both languages and answers with the unlock command, no model', async () => {
    for (const t of ['Tout ouvrir, je connais le jeu.', 'Show me everything', 'skip the tutorial please', 'Ouvre tout']) expect(wantsEverything(t), t).toBe(true);
    for (const t of ['Ouvre un Marché', 'What is everything worth?', 'Je connais Vantor']) expect(wantsEverything(t), t).toBe(false);
    const ctx = { lang: 'fr' as const, current: DEFAULT_POLICY, systems: {}, colonies: {}, alliances: {}, persona: 'kestrel' as const };
    let called = 0;
    const client = { name: 'x', healthy: async () => true, chat: async () => { called++; return { text: '{}', model: 'm', provider: 'p', inputTokens: 0, outputTokens: 0, ms: 0, attempts: 1 }; } };
    const r = await converse({ text: 'Je connais le jeu, tout ouvrir.', lang: 'fr', persona: 'kestrel', history: [], ctx }, client);
    expect(r.command).toEqual({ type: 'onboarding_unlock' });
    expect(r.reply).toMatch(/vétéran/i);
    expect(called).toBe(0);
  });
});
