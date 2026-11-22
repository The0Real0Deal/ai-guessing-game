import { describe, expect, it } from 'vitest';
import {
  buildRoundWordDeck,
  calculateRoundPlan,
  computeSuperlatives,
  getRoundCategoryLabel,
  sortPlayersByScore,
} from './gameLogic';
import type { Category, Player } from './types';

function makeCategories(counts: { name: string; count: number }[]): Category[] {
  let idx = 1;
  return counts.map((c, ci) => ({
    id: `cat_${ci}`,
    name: c.name,
    words: Array.from({ length: c.count }, () => `מילה_${idx++}`),
  }));
}

describe('calculateRoundPlan', () => {
  it('computes exact Math.floor(totalWords / playerCount) for 20 words and 5 players', () => {
    const cats = makeCategories([
      { name: 'חיות', count: 10 },
      { name: 'אוכל', count: 10 },
    ]);
    const plan = calculateRoundPlan(cats, 5);
    expect(plan.totalWords).toBe(20);
    expect(plan.totalRounds).toBe(4);
    expect(plan.leftoverWords).toBe(0);
    expect(plan.canStart).toBe(true);
  });

  it('leaves 1 leftover word unused for 21 words and 5 players', () => {
    const cats = makeCategories([
      { name: 'חיות', count: 11 },
      { name: 'אוכל', count: 10 },
    ]);
    const plan = calculateRoundPlan(cats, 5);
    expect(plan.totalWords).toBe(21);
    expect(plan.totalRounds).toBe(4);
    expect(plan.leftoverWords).toBe(1);
    expect(plan.canStart).toBe(true);
  });

  it('prevents starting when fewer unique words than players', () => {
    const cats = makeCategories([{ name: 'חיות', count: 3 }]);
    const plan = calculateRoundPlan(cats, 5);
    expect(plan.totalRounds).toBe(0);
    expect(plan.canStart).toBe(false);
  });

  it('deduplicates repeated words across categories', () => {
    const cats: Category[] = [
      { id: '1', name: 'א', words: ['חתול', 'כלב', 'חתול', '  '] },
      { id: '2', name: 'ב', words: ['כלב', 'פיל', 'דרקון'] },
    ];
    const plan = calculateRoundPlan(cats, 2);
    expect(plan.totalWords).toBe(4);
    expect(plan.totalRounds).toBe(2);
  });
});

describe('buildRoundWordDeck', () => {
  it('allocates exact rounds with zero duplicates across the entire game', () => {
    const cats = makeCategories([
      { name: 'סרטים', count: 7 },
      { name: 'אוכל', count: 8 },
      { name: 'חיות', count: 6 },
    ]); // 21 words total, 5 players => 4 rounds, 20 words used, 1 unused

    const deck = buildRoundWordDeck(cats, 5);
    expect(deck).toHaveLength(4);
    for (const round of deck) {
      expect(round).toHaveLength(5);
    }

    const allAssigned = deck.flat().map((e) => e.word);
    expect(allAssigned).toHaveLength(20);
    expect(new Set(allAssigned).size).toBe(20);
  });

  it('groups pure single-category rounds whenever categories have enough words', () => {
    const cats = makeCategories([
      { name: 'סרטים', count: 5 },
      { name: 'חיות', count: 5 },
      { name: 'אוכל', count: 5 },
    ]);
    const deck = buildRoundWordDeck(cats, 5);
    expect(deck).toHaveLength(3);
    for (const round of deck) {
      const uniqueCats = new Set(round.map((w) => w.category));
      expect(uniqueCats.size).toBe(1);
    }
  });
});

describe('getRoundCategoryLabel & leaderboard helpers', () => {
  it('formats single and mixed category labels in Hebrew', () => {
    expect(getRoundCategoryLabel([{ category: 'חיות' }, { category: 'חיות' }])).toBe('חיות');
    expect(getRoundCategoryLabel([{ category: 'חיות' }, { category: 'אוכל' }])).toBe(
      'מיקס: חיות + אוכל'
    );
  });

  it('sorts players by score and computes superlative awards', () => {
    const players: Player[] = [
      {
        id: 'p1',
        roomCode: '1234',
        nickname: 'דניאל',
        avatar: '🐱',
        score: 5,
        guesserScore: 4,
        creatorScore: 1,
        prevScore: 3,
        roundDelta: 2,
        connected: true,
        joinedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'p2',
        roomCode: '1234',
        nickname: 'נועה',
        avatar: '🦊',
        score: 4,
        guesserScore: 1,
        creatorScore: 3,
        prevScore: 2,
        roundDelta: 2,
        connected: true,
        joinedAt: '2026-01-01T00:00:01Z',
      },
    ];

    const sorted = sortPlayersByScore(players);
    expect(sorted[0].nickname).toBe('דניאל');

    const awards = computeSuperlatives(players);
    expect(awards.find((a) => a.id === 'picasso')?.winnerNames).toEqual(['נועה']);
    expect(awards.find((a) => a.id === 'sherlock')?.winnerNames).toEqual(['דניאל']);
  });
});
