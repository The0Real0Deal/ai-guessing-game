import { beforeEach, describe, expect, it } from 'vitest';
import {
  attachPlayerImage,
  awardPointsAndReveal,
  createRoom,
  getOrderedGuessQueue,
  joinRoom,
  markPromptCopied,
  nextGuessOrLeaderboard,
  nextRoundOrFinale,
  resetRoomForNewGame,
  startGame,
  startGuessingPhase,
  submitPrompt,
  undoReveal,
} from './gameService';
import type { GameSettings } from './types';

// Simple in-memory localStorage mock for Vitest node environment
const store = new Map<string, string>();
const mockStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v);
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
  clear: () => {
    store.clear();
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  configurable: true,
});

const SAMPLE_SETTINGS: GameSettings = {
  categories: [
    { id: 'c1', name: 'חיות', words: ['חתול עורך דין', 'כלב שף', 'פיל די ג׳יי', 'ינשוף מורה'] },
    { id: 'c2', name: 'אוכל', words: ['פיצה בחלל', 'חומוס מוגזם', 'במבה ענקית'] },
  ], // 7 unique words => with 3 players => Math.floor(7/3) = 2 full rounds (1 leftover)
  timerSeconds: 60,
  guesserPoints: 2,
  creatorPoints: 1,
};

describe('End-to-end multiplayer game flow (local sync driver)', () => {
  beforeEach(() => {
    store.clear();
  });

  it('runs full 2-round party game with dynamic rounds, manual image paste, dual scoring, undo, leaderboard, and finale', async () => {
    // 1. Host creates room
    const created = await createRoom(SAMPLE_SETTINGS);
    const code = created.room.code;
    expect(code).toMatch(/^\d{4}$/);
    expect(created.room.phase).toBe('lobby');

    // 2. Three players join from mobile
    const { player: p1 } = await joinRoom(code, 'דניאל', '🐱');
    const { player: p2 } = await joinRoom(code, 'נועה', '🦊');
    const { player: p3 } = await joinRoom(code, 'עומר', '🦖');

    // 3. Host starts game -> 7 words / 3 players = 2 rounds
    const started = await startGame(code);
    expect(started.room.phase).toBe('prompting');
    expect(started.room.totalRounds).toBe(2);
    expect(started.room.currentRound).toBe(1);
    expect(started.submissions).toHaveLength(3);

    const round1Words = started.submissions.map((s) => s.secretWord);
    expect(new Set(round1Words).size).toBe(3);

    // 4. Players submit prompts from phones; p1 edits before lock, then gets locked once Host copies
    await submitPrompt(code, p1.id, 1, 'פרומפט ראשוני');
    await submitPrompt(code, p1.id, 1, 'פרומפט ראשון מצחיק ומעודכן');
    const p1Sub = started.submissions.find((s) => s.playerId === p1.id)!;
    const afterCopy = await markPromptCopied(code, p1Sub.id);
    expect(afterCopy.submissions.find((s) => s.id === p1Sub.id)?.copiedAt).not.toBeNull();
    await expect(submitPrompt(code, p1.id, 1, 'ניסיון עריכה אחרי נעילה')).rejects.toThrow();

    await submitPrompt(code, p2.id, 1, 'פרומפט שני צבעוני');
    const afterPrompts = await submitPrompt(code, p3.id, 1, 'פרומפט שלישי מטורף');
    expect(afterPrompts.submissions.every((s) => s.prompt.length > 0)).toBe(true);

    // 5. Host pastes compressed Gemini images for all 3 players
    for (const sub of afterPrompts.submissions) {
      await attachPlayerImage(code, sub.id, `data:image/webp;base64,FAKE_${sub.id}`, 48);
    }

    // 6. Start guessing phase
    const guessing = await startGuessingPhase(code);
    expect(guessing.room.phase).toBe('guessing');
    expect(guessing.room.currentGuessIndex).toBe(0);
    expect(guessing.room.timerEndsAt).not.toBeNull();

    const queue = getOrderedGuessQueue(guessing);
    expect(queue).toHaveLength(3);

    // 7. Image 1: Host awards points to guesser + creator, then tests undo, then re-awards
    const img1 = queue[0];
    const guesserFor1 = [p1, p2, p3].find((p) => p.id !== img1.playerId)!;
    const afterAward1 = await awardPointsAndReveal(code, img1.id, guesserFor1.id);
    const updatedGuesser1 = afterAward1.players.find((p) => p.id === guesserFor1.id)!;
    const updatedCreator1 = afterAward1.players.find((p) => p.id === img1.playerId)!;
    expect(updatedGuesser1.score).toBe(2);
    expect(updatedGuesser1.guesserScore).toBe(2);
    expect(updatedCreator1.score).toBe(1);
    expect(updatedCreator1.creatorScore).toBe(1);

    // Undo should restore scores to 0
    const afterUndo = await undoReveal(code, img1.id);
    expect(afterUndo.players.find((p) => p.id === guesserFor1.id)!.score).toBe(0);
    expect(afterUndo.players.find((p) => p.id === img1.playerId)!.score).toBe(0);

    // Re-award image 1
    await awardPointsAndReveal(code, img1.id, guesserFor1.id);

    // 8. Advance through images 2 & 3 -> End-of-Round Leaderboard
    const img2State = await nextGuessOrLeaderboard(code);
    expect(img2State.room.currentGuessIndex).toBe(1);
    await awardPointsAndReveal(code, queue[1].id, null); // Nobody guessed -> 0 pts

    const img3State = await nextGuessOrLeaderboard(code);
    expect(img3State.room.currentGuessIndex).toBe(2);
    const guesserFor3 = [p1, p2, p3].find((p) => p.id !== queue[2].playerId)!;
    await awardPointsAndReveal(code, queue[2].id, guesserFor3.id);

    const lb1 = await nextGuessOrLeaderboard(code);
    expect(lb1.room.phase).toBe('round_leaderboard');
    expect(lb1.room.roundCommentary.length).toBeGreaterThan(0);

    // 9. Advance to Round 2 -> ensure zero duplicate words from Round 1
    const round2 = await nextRoundOrFinale(code);
    expect(round2.room.phase).toBe('prompting');
    expect(round2.room.currentRound).toBe(2);
    const r2Subs = round2.submissions.filter((s) => s.roundNumber === 2);
    expect(r2Subs).toHaveLength(3);
    const allWordsAcrossGame = [...round1Words, ...r2Subs.map((s) => s.secretWord)];
    expect(new Set(allWordsAcrossGame).size).toBe(6);

    // Paste 1 image in Round 2, guess it, move to leaderboard -> Grand Finale
    await submitPrompt(code, r2Subs[0].playerId, 2, 'פרומפט סופי');
    await attachPlayerImage(code, r2Subs[0].id, 'data:image/webp;base64,FINAL', 52);
    await startGuessingPhase(code);
    const r2Guesser = [p1, p2, p3].find((p) => p.id !== r2Subs[0].playerId)!;
    await awardPointsAndReveal(code, r2Subs[0].id, r2Guesser.id);
    const lb2 = await nextGuessOrLeaderboard(code);
    expect(lb2.room.phase).toBe('round_leaderboard');

    const finale = await nextRoundOrFinale(code);
    expect(finale.room.phase).toBe('finale');
    expect(finale.room.history.length).toBe(4);

    // 10. Reset room for new game keeps connected players & resets scores
    const reset = await resetRoomForNewGame(code);
    expect(reset.room.phase).toBe('lobby');
    expect(reset.players).toHaveLength(3);
    expect(reset.players.every((p) => p.score === 0)).toBe(true);
    expect(reset.submissions).toHaveLength(0);
  });
});
