// The doctrine card's rules, without a browser: the server keeps one pending doctrine per Colony.
import { describe, expect, it } from 'vitest';
import { CARD_LINES, awaitingAnswer, cardAfterDoctrine, cardAfterTalk, cardFromPending, pendingLineKey, visibleLines, type PendingCard } from '../src/ui/doctrine.js';

const held: PendingCard = { id: 'd1', readable: ['Expansion : 90 %'], question: null };

describe('doctrine card', () => {
  it('shows the pending doctrine a talk answer carries, with its question', () => {
    expect(cardAfterTalk(null, { pending: { id: 'd2', readable: [' Agression : 0 % ', ''] }, question: 'Et la capitale ?' })).toEqual({ id: 'd2', readable: ['Agression : 0 %'], question: 'Et la capitale ?' });
  });

  it('replaces the card with the next doctrine, keeps it through small talk', () => {
    expect(cardAfterTalk(held, { pending: { id: 'd3', readable: ['x'] }, question: null })?.id).toBe('d3');
    expect(cardAfterTalk(held, { pending: null, question: null })).toBe(held);
    expect(cardAfterTalk(held, { question: 'Tu veux dire quoi ?' })).toBe(held); // a question alone is in the reply bubble
    expect(cardAfterTalk(null, { pending: null })).toBeNull();
  });

  it('reads the readable lines beside pending on a doctrine answer', () => {
    expect(cardAfterDoctrine(null, { pending: { id: 'd4' }, readable: ['Défendre : capitale'], question: null })).toEqual({ id: 'd4', readable: ['Défendre : capitale'], question: null });
    expect(cardAfterDoctrine(held, { pending: null, readable: ['ignored'], question: 'Laquelle ?' })).toBe(held);
  });

  it('restores the card from GET /api/doctrine/pending, or none', () => {
    expect(cardFromPending({ id: 'd5', readable: ['a', 3, 'b'], summary: 's', reply: 'r' })).toEqual({ id: 'd5', readable: ['a', 'b'], question: null });
    expect(cardFromPending(null)).toBeNull();
    expect(cardFromPending({ readable: [] })).toBeNull();
    expect(cardFromPending('nope')).toBeNull();
  });

  it('gives each General its own line', () => {
    expect(['vane', 'kestrel', 'oriel', 'solen', 'unknown'].map(pendingLineKey)).toEqual(['pendingVane', 'pendingKestrel', 'pendingOriel', 'pendingSolen', 'pendingVane']);
  });

  it('folds a long list after a few lines so the buttons stay in view on a phone', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `ligne ${i + 1}`);
    expect(visibleLines(nine, false)).toEqual({ shown: nine.slice(0, CARD_LINES), hidden: 9 - CARD_LINES });
    expect(visibleLines(nine, true)).toEqual({ shown: nine, hidden: 0 });
    expect(visibleLines(nine.slice(0, CARD_LINES), false).hidden).toBe(0);
    expect(visibleLines(nine.slice(0, CARD_LINES + 1), false)).toEqual({ shown: nine.slice(0, CARD_LINES + 1), hidden: 0 }); // never « voir tout » for one line
  });
});

describe('a doctrine answered with a question (issue #35)', () => {
  it('waits for the answer when the General asked back and holds nothing', () => {
    expect(awaitingAnswer(null, { pending: null, question: 'Which food-rich system first?' })).toBe(true);
    expect(awaitingAnswer(null, { pending: null, question: '  ' })).toBe(false);
    expect(awaitingAnswer(null, { pending: { id: 'd2' }, question: 'Et la capitale ?' })).toBe(false); // the card asks it
    expect(awaitingAnswer(held, { pending: null, question: 'Which one?' })).toBe(false); // a doctrine waits for its yes
    expect(awaitingAnswer(null, { pending: null, question: 'x?', policyChanged: true })).toBe(false);
  });
});
