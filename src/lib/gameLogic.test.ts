import { describe, expect, it } from 'vitest';
import {
  buildFinaleWinnerPrompt,
  buildGeminiCopyPrompt,
  buildRoundWordDeck,
  calculateRoundPlan,
  computeRankTrends,
  computeSuperlatives,
  findForbiddenWords,
  getHostQueueStatus,
  getRoundCategoryLabel,
  sortPlayersByScore,
} from './gameLogic';
import type { Category, Player, Submission } from './types';

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
    ]);

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

describe('getRoundCategoryLabel, trends & superlatives', () => {
  it('formats single and mixed category labels in Hebrew', () => {
    expect(getRoundCategoryLabel([{ category: 'חיות' }, { category: 'חיות' }])).toBe('חיות');
    expect(getRoundCategoryLabel([{ category: 'חיות' }, { category: 'אוכל' }])).toBe(
      'מיקס: חיות + אוכל'
    );
  });

  it('sorts players, computes rank trends, and builds vector superlative awards', () => {
    const players: Player[] = [
      {
        id: 'p1',
        roomCode: '1234',
        nickname: 'דניאל',
        avatar: '🐱',
        score: 5,
        guesserScore: 4,
        creatorScore: 1,
        prevScore: 1, // was rank 2 -> climbed to rank 1
        roundDelta: 4,
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
        prevScore: 4, // was rank 1 -> dropped to rank 2
        roundDelta: 0,
        connected: true,
        joinedAt: '2026-01-01T00:00:01Z',
      },
    ];

    const sorted = sortPlayersByScore(players);
    expect(sorted[0].nickname).toBe('דניאל');

    const trends = computeRankTrends(players);
    expect(trends[0].player.nickname).toBe('דניאל');
    expect(trends[0].rankChange).toBe(1);
    expect(trends[1].player.nickname).toBe('נועה');
    expect(trends[1].rankChange).toBe(-1);

    const awards = computeSuperlatives(players);
    expect(awards.find((a) => a.id === 'picasso')?.winnerNames).toEqual(['נועה']);
    expect(awards.find((a) => a.id === 'sherlock')?.winnerNames).toEqual(['דניאל']);
  });
});

describe('findForbiddenWords, buildGeminiCopyPrompt & getHostQueueStatus', () => {
  it('flags exact and Hebrew-prefixed forbidden words while ignoring stop words', () => {
    const matches = findForbiddenWords(
      'חתול על ספה',
      'איור מצחיק של החתול יושב על כיסא ליד הספה'
    );
    expect(matches.map((m) => m.word)).toEqual(['החתול', 'הספה']);
  });

  it('returns empty array when prompt contains no forbidden words', () => {
    const matches = findForbiddenWords('חתול עורך דין', 'יצור פרוותי עם חליפה בבית משפט');
    expect(matches).toEqual([]);
  });

  it('wraps copied prompt with צור קריקטורה של prefix', () => {
    expect(buildGeminiCopyPrompt('  כלב רוקד סלסה  ')).toBe('צור קריקטורה של כלב רוקד סלסה');
  });

  it('returns accurate ordered host queue statuses', () => {
    const base: Submission = {
      id: 's1',
      roomCode: '1234',
      roundNumber: 1,
      playerId: 'p1',
      category: 'חיות',
      secretWord: 'חתול',
      prompt: '',
      promptSubmittedAt: null,
      copiedAt: null,
      imageData: null,
      imageSizeKb: null,
      orderIndex: 0,
      guessedCorrectly: false,
      guesserId: null,
      revealed: false,
      awardedCreatorPts: 0,
      awardedGuesserPts: 0,
      updatedAt: '',
    };

    expect(getHostQueueStatus(base).label).toBe('ממתין לפרומפט');
    expect(getHostQueueStatus({ ...base, prompt: 'יצור חמוד' }).label).toBe('מוכן להעתקה');
    const copied = getHostQueueStatus({ ...base, prompt: 'יצור חמוד', copiedAt: '2026-01-01T00:00:00Z' });
    expect(copied.isCopied).toBe(true);
    expect(getHostQueueStatus({ ...base, prompt: 'יצור חמוד', imageData: 'data:image/webp;base64,X' }).label).toBe('הודבקה תמונה');
    expect(getHostQueueStatus({ ...base, prompt: 'יצור חמוד', imageData: 'data:image/webp;base64,X', revealed: true }).label).toBe('הסתיים');
  });

  it('builds hilarious finale winner prompt with all player emojis, names, winner with trophy and crying losers', () => {
    const players: Player[] = [
      {
        id: 'p1',
        roomCode: '1234',
        nickname: 'דניאל',
        avatar: '🐱',
        score: 7,
        guesserScore: 4,
        creatorScore: 3,
        prevScore: 5,
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
        guesserScore: 2,
        creatorScore: 2,
        prevScore: 4,
        roundDelta: 0,
        connected: true,
        joinedAt: '2026-01-01T00:00:01Z',
      },
      {
        id: 'p3',
        roomCode: '1234',
        nickname: 'עומר',
        avatar: '🦖',
        score: 2,
        guesserScore: 1,
        creatorScore: 1,
        prevScore: 2,
        roundDelta: 0,
        connected: true,
        joinedAt: '2026-01-01T00:00:02Z',
      },
    ];

    const prompt = buildFinaleWinnerPrompt(players);
    expect(prompt).toContain('🐱');
    expect(prompt).toContain('דניאל');
    expect(prompt).toContain('🦊');
    expect(prompt).toContain('נועה');
    expect(prompt).toContain('🦖');
    expect(prompt).toContain('עומר');
    expect(prompt).toContain('גביע');
    expect(prompt).toContain('בוכות');
  });
});
