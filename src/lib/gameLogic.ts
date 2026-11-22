import type {
  Category,
  ForbiddenMatch,
  Player,
  PlayerRankTrend,
  RoundCalculation,
  Submission,
  SuperlativeAward,
  WordEntry,
} from './types';

export const PLAYER_AVATARS = [
  '🐱', '🦊', '🐸', '🦄', '🐙', '🦖', '🐼', '🦁',
  '🐨', '🐵', '🦉', '🐧', '🐝', '🦋', '🤖', '👽',
  '🧙‍♂️', '🥷', '🤠', '🧑‍🚀',
];

export const PRESET_CATEGORY_PACKS: { label: string; emoji: string; categories: Omit<Category, 'id'>[] }[] = [
  {
    label: 'חבילת מסיבה קלאסית (20 מילים)',
    emoji: '🎉',
    categories: [
      {
        name: 'חיות עם מקצועות',
        words: [
          'חתול עורך דין',
          'פינגווין די ג׳יי במסיבה',
          'פיל נהג מונית',
          'כלב שף במסעדת יוקרה',
          'ינשוף פרופסור לפיזיקה',
        ],
      },
      {
        name: 'אוכל ישראלי מוגזם',
        words: [
          'מגדל פלאפל עד העננים',
          'חומוס בחלל החיצון',
          'שקשוקה בתוך הר געש',
          'במבה ענקית כמו גורד שחקים',
          'סופגנייה עם משקפי שמש',
        ],
      },
      {
        name: 'סרטים ואגדות בטוויסט',
        words: [
          'הארי פוטר רוכב על קורקינט חשמלי',
          'שרק עושה יוגה על חוף הים',
          'דרקון ישן על ספה בסלון',
          'סינדרלה מאחרת לאוטובוס',
          'סופרמן עומד בתור בסופר',
        ],
      },
      {
        name: 'דברים הזויים ביומיום',
        words: [
          'רובוט שותה קפה שחור בבוקר',
          'אסטרונאוט גולש על גלים',
          'קקטוס לובש כובע קאובוי',
          'דג זהב גר בתוך נורה',
          'סבתא מנצחת בתחרות סקייטבורד',
        ],
      },
    ],
  },
  {
    label: 'סרטים, סדרות וגיבורי על',
    emoji: '🎬',
    categories: [
      {
        name: 'גיבורי על בחופשה',
        words: [
          'באטמן משתזף באילת',
          'ספיידרמן מנקה חלונות',
          'תור מכין פנקייקים',
          'וונדר וומן עושה קניות בשוק',
          'איירון מן נתקע בפקק באיילון',
        ],
      },
      {
        name: 'קולנוע קלאסי',
        words: [
          'טיטאניק באמבטיה',
          'פארק היורה בגן ילדים',
          'מטריקס עם חתולים',
          'מלך האריות בסלון הביתי',
          'מלחמת הכוכבים בבית קפה',
        ],
      },
    ],
  },
  {
    label: 'ישראלית ומקומית',
    emoji: '🇮🇱',
    categories: [
      {
        name: 'רגעים ישראליים',
        words: [
          'מטקות בחוף תל אביב עם דינוזאור',
          'שישי בצהריים בשוק מחנה יהודה',
          'רכבת ישראל מלאה בפינגווינים',
          'מנגל ביום העצמאות על הירח',
          'פקק תנועה של גמלים באיילון',
        ],
      },
    ],
  },
];

export const WITTY_PROMPTING_LINES = [
  'המוחות עובדים שעות נוספות... Gemini עוד לא יודע מה מחכה לו 🤯',
  'כל שחקן מתבשל עם הפרומפט שלו — המארח על המשמר עם Ctrl+V! ⚡',
  'אל תציצו למסך של השכן! פיקאסו לא העתיק מאף אחד 🎨',
  'זה הזמן לכתוב תיאור גאוני בלי להסגיר את המילה הסודית 🤫',
  'חכו חכו שתראו מה הבינה המלאכותית תייצר מהרעיונות שלכם 😂',
];

export const WITTY_MISS_LINES = [
  'אוי לא, הפעם ה-AI ניצח אתכם! 🤖',
  'אמנות מודרנית קשה להבנה... אפילו המוזיאון התבלבל! 🖼️',
  'טוב, כנראה שהבינה המלאכותית לקחה כאן "חופש אמנותי" מוגזם 😅',
  'לא נורא! זה היה כל כך מופשט שגם פיקאסו היה מרים ידיים 🎭',
];

export const WITTY_HIT_BADGES = [
  '🎯 בול פגיעה!',
  '🔥 זיהוי של גאונים!',
  '⚡ תוך שנייה עליתם על זה!',
  '🎉 טלפתיה אמיתית!',
  '🧠 מוח של חדי-קרן!',
];

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Deduplicates and flattens all valid words across categories.
 */
export function collectUniqueWords(categories: Category[]): WordEntry[] {
  const seen = new Set<string>();
  const entries: WordEntry[] = [];

  for (const cat of categories) {
    const catName = cat.name.trim() || 'כללי';
    for (const rawWord of cat.words) {
      const word = rawWord.trim();
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ word, category: catName });
    }
  }

  return entries;
}

/**
 * Dynamically calculates total rounds = Math.floor(totalWords / playerCount).
 */
export function calculateRoundPlan(categories: Category[], playerCount: number): RoundCalculation {
  const uniqueWords = collectUniqueWords(categories);
  const totalWords = uniqueWords.length;
  const activeCategories = categories.filter((c) => c.words.some((w) => w.trim().length > 0)).length;

  if (playerCount <= 0 || totalWords === 0) {
    return {
      totalWords,
      playerCount,
      totalRounds: 0,
      leftoverWords: totalWords,
      canStart: false,
      categoryCount: activeCategories,
    };
  }

  const totalRounds = Math.floor(totalWords / playerCount);
  const leftoverWords = totalWords % playerCount;

  return {
    totalWords,
    playerCount,
    totalRounds,
    leftoverWords,
    canStart: totalRounds >= 1 && playerCount >= 1,
    categoryCount: activeCategories,
  };
}

/**
 * Builds an exact deck of `Math.floor(totalWords / playerCount)` rounds.
 * - Guarantees ZERO duplicate words across the entire game.
 * - Groups same-category words into themed rounds whenever a category has enough words,
 *   then shuffles remaining words across categories for any remaining full rounds.
 * - Leftover words (`totalWords % playerCount`) are left unused.
 */
export function buildRoundWordDeck(categories: Category[], playerCount: number): WordEntry[][] {
  if (playerCount <= 0) return [];
  const allEntries = collectUniqueWords(categories);
  const totalRounds = Math.floor(allEntries.length / playerCount);
  if (totalRounds <= 0) return [];

  // Group unique entries by category
  const byCategory = new Map<string, WordEntry[]>();
  for (const entry of allEntries) {
    const list = byCategory.get(entry.category) || [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const shuffledCategoryNames = shuffle(Array.from(byCategory.keys()));
  const categoryPools = shuffledCategoryNames.map((name) => ({
    name,
    items: shuffle(byCategory.get(name)!),
  }));

  const rounds: WordEntry[][] = [];

  // Pass 1: form pure single-category rounds while any category has >= playerCount words
  let formedPure = true;
  while (formedPure && rounds.length < totalRounds) {
    formedPure = false;
    for (const pool of categoryPools) {
      if (rounds.length >= totalRounds) break;
      if (pool.items.length >= playerCount) {
        rounds.push(pool.items.splice(0, playerCount));
        formedPure = true;
      }
    }
  }

  // Pass 2: combine all leftover words from all categories and form remaining full rounds
  const leftovers = shuffle(categoryPools.flatMap((p) => p.items));
  while (rounds.length < totalRounds && leftovers.length >= playerCount) {
    rounds.push(leftovers.splice(0, playerCount));
  }

  // Shuffle round order so themed & mixed rounds feel playful and surprising
  return shuffle(rounds);
}

/**
 * Returns a clean Hebrew category title for a round's submissions.
 */
export function getRoundCategoryLabel(entries: { category: string }[]): string {
  const unique = Array.from(new Set(entries.map((e) => e.category).filter(Boolean)));
  if (unique.length === 0) return 'כללי';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `מיקס: ${unique[0]} + ${unique[1]}`;
  return `מיקס קטגוריות (${unique.length} נושאים)`;
}

export function sortPlayersByScore(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.guesserScore !== a.guesserScore) return b.guesserScore - a.guesserScore;
    if (b.creatorScore !== a.creatorScore) return b.creatorScore - a.creatorScore;
    return a.nickname.localeCompare(b.nickname, 'he');
  });
}

export function getWittyRoundCommentary(
  players: Player[],
  currentRound: number,
  totalRounds: number
): string {
  const sorted = sortPlayersByScore(players);
  if (sorted.length === 0) return 'איזה סיבוב מטורף!';

  const leader = sorted[0];
  const runnerUp = sorted[1];

  const topClimber = [...players].sort((a, b) => b.roundDelta - a.roundDelta)[0];

  if (currentRound >= totalRounds) {
    return `הסיבוב האחרון הושלם! מוכנים לגלות מי לוקח את הגביע? 🏆`;
  }

  if (runnerUp && leader.score === runnerUp.score && leader.score > 0) {
    return `שוויון דרמטי בצמרת בין ${leader.nickname} ל-${runnerUp.nickname}! המתח בשיאו 🔥`;
  }

  if (runnerUp && leader.score - runnerUp.score === 1 && leader.score > 0) {
    return `צמוד כמו חניה בתל אביב! ${leader.nickname} מוביל/ה בנקודה אחת בלבד 😱`;
  }

  if (topClimber && topClimber.roundDelta >= 2) {
    return `וואו! ${topClimber.nickname} התפוצץ/ה בסיבוב הזה עם +${topClimber.roundDelta} נקודות! 🚀`;
  }

  if (leader.score === 0) {
    return 'עדיין אפס נקודות לכולם — ה-AI מנצח בינתיים! בואו נראה לו בסיבוב הבא 😂';
  }

  return `${leader.nickname} תופס/ת את הפסגה, אבל הכל עוד פתוח לסיבוב הבא! ⚡`;
}

export function computeSuperlatives(players: Player[]): SuperlativeAward[] {
  if (players.length === 0) return [];
  const awards: SuperlativeAward[] = [];

  const maxCreator = Math.max(...players.map((p) => p.creatorScore));
  if (maxCreator > 0) {
    const winners = players.filter((p) => p.creatorScore === maxCreator);
    awards.push({
      id: 'picasso',
      icon: 'palette',
      title: 'פיקאסו של הפרומפטים',
      subtitle: 'הכי הרבה יצירות שפוצחו בהצלחה בסלון',
      winnerNames: winners.map((w) => w.nickname),
      statLabel: `${maxCreator} נק׳ יוצר`,
    });
  }

  const maxGuesser = Math.max(...players.map((p) => p.guesserScore));
  if (maxGuesser > 0) {
    const winners = players.filter((p) => p.guesserScore === maxGuesser);
    awards.push({
      id: 'sherlock',
      icon: 'search',
      title: 'שרלוק הולמס של הערב',
      subtitle: 'העין הכי חדה והתגובה הכי מהירה בחדר',
      winnerNames: winners.map((w) => w.nickname),
      statLabel: `${maxGuesser} נק׳ מנחש`,
    });
  }

  const lowest = Math.min(...players.map((p) => p.score));
  const highest = Math.max(...players.map((p) => p.score));
  if (players.length >= 2 && lowest < highest) {
    const sweet = players.filter((p) => p.score === lowest);
    awards.push({
      id: 'abstract',
      icon: 'sparkles',
      title: 'פרס האמנות המופשטת',
      subtitle: 'יצירות שהיו פשוט מקדימות את זמנן',
      winnerNames: sweet.map((w) => w.nickname),
      statLabel: `${lowest} נק׳ — ומקסימום יצירתיות`,
    });
  }

  return awards;
}

/**
 * Computes current rank, previous rank (before the latest round), and rankChange
 * so inter-round leaderboards can display climb/drop trend indicators.
 */
export function computeRankTrends(players: Player[]): PlayerRankTrend[] {
  const sortedCurrent = sortPlayersByScore(players);
  const sortedPrev = [...players].sort((a, b) => {
    if (b.prevScore !== a.prevScore) return b.prevScore - a.prevScore;
    return a.nickname.localeCompare(b.nickname, 'he');
  });

  const prevRankMap = new Map<string, number>();
  sortedPrev.forEach((p, idx) => {
    // Players with identical prevScore share the same previous rank
    if (idx > 0 && sortedPrev[idx - 1].prevScore === p.prevScore) {
      prevRankMap.set(p.id, prevRankMap.get(sortedPrev[idx - 1].id)!);
    } else {
      prevRankMap.set(p.id, idx + 1);
    }
  });

  return sortedCurrent.map((player, idx) => {
    const currentRank = idx + 1;
    const prevRank = prevRankMap.get(player.id) ?? currentRank;
    return {
      player,
      currentRank,
      prevRank,
      rankChange: prevRank - currentRank,
    };
  });
}

const HEBREW_STOP_WORDS = new Set([
  'של', 'על', 'עם', 'את', 'אל', 'מן', 'גם', 'או', 'לא', 'זה', 'זו', 'זאת', 'בתוך', 'בלי', 'עד', 'כמו',
]);

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts meaningful forbidden tokens from the player's secret target concept
 * and returns every offending span in the player's prompt (including Hebrew prefixes ה/ב/ל/מ/ו/כ/ש).
 */
export function findForbiddenWords(secretWord: string, prompt: string): ForbiddenMatch[] {
  if (!secretWord.trim() || !prompt.trim()) return [];

  const rawTokens = secretWord
    .split(/[\s,.;:!?()[\]{}"'״׳\-–—/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const meaningfulTokens = rawTokens.filter((t) => !HEBREW_STOP_WORDS.has(t));
  const forbiddenTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;
  if (forbiddenTokens.length === 0) return [];

  const matches: ForbiddenMatch[] = [];
  const tokenRegex = /[\u0590-\u05FFA-Za-z0-9״׳']+/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(prompt)) !== null) {
    const rawToken = m[0];
    const normalized = rawToken.toLowerCase();

    for (const forbidden of forbiddenTokens) {
      const fNorm = forbidden.toLowerCase();
      // Direct match or Hebrew single-letter prefix (ה, ב, ל, מ, ו, כ, ש) + forbidden word
      const isHebrew = /[\u0590-\u05FF]/.test(fNorm);
      const pattern = isHebrew
        ? new RegExp(`^[הובכלמש]?${escapeRegExp(fNorm)}$`, 'i')
        : new RegExp(`^${escapeRegExp(fNorm)}s?$`, 'i');

      if (pattern.test(normalized)) {
        matches.push({
          word: rawToken,
          start: m.index,
          end: m.index + rawToken.length,
        });
        break;
      }
    }
  }

  return matches;
}

export function buildGeminiCopyPrompt(playerPrompt: string): string {
  return `צור קריקטורה של ${playerPrompt.trim()}`;
}

/**
 * Generates a hilarious Hebrew Gemini caricature prompt for the Grand Finale:
 * All players appear as their emoji characters with their Hebrew names on them;
 * the winner(s) stand on top holding a trophy and laughing down at everyone else,
 * while all the other players cry comically below.
 */
export function buildFinaleWinnerPrompt(players: Player[]): string {
  const sorted = sortPlayersByScore(players);
  if (sorted.length === 0) return '';

  const topScore = sorted[0].score;
  const winners = sorted.filter((p) => p.score === topScore);
  const losers = sorted.filter((p) => p.score < topScore);

  const formatChar = (p: Player) => `דמות של ${p.avatar} עם תגית שם ברורה "${p.nickname}"`;

  const winnersText = winners.map(formatChar).join(' ו-');
  const isPluralWinners = winners.length > 1;

  if (losers.length === 0) {
    return `צור קריקטורה צבעונית, מוגזמת ומצחיקה בסגנון פיקסאר של טקס ניצחון במסיבה: בראש פודיום מוזהב עומדים ${winnersText}, מרימים יחד גביע זהב ענק וצוחקים בקול רם בניצחון מוחץ. על כל דמות כתוב השם שלה בעברית בצורה ברורה. סגנון קומיקס קליל, קונפטי באוויר ותאורה חגיגית.`;
  }

  const losersText = losers.map(formatChar).join(', ');
  const winnerAction = isPluralWinners
    ? `למעלה בראש פודיום מוזהב גבוה עומדים ${winnersText}, מרימים גביע זהב ענק וצוחקים על כולם מלמעלה`
    : `למעלה בראש פודיום מוזהב גבוה עומד/ת ${winnersText}, מרים/ה גביע זהב ענק וצוחק/ת על כולם מלמעלה`;

  return `צור קריקטורה צבעונית, מוגזמת ומצחיקה בסגנון פיקסאר של טקס סיום משחק: ${winnerAction}. למטה סביב הפודיום נמצאות שאר הדמויות וכולן בוכות בצורה דרמטית וקורעת מצחוק עם דמעות ענקיות: ${losersText}. הקפד שהשם של כל שחקן יופיע בבירור על הדמות שלו בעברית, עם הבעות פנים מוגזמות ומצחיקות, קונפטי באוויר ותאורת במה חגיגית.`;
}

export type HostQueueStatusKey = 'waiting' | 'ready_to_copy' | 'image_pasted' | 'finished';

export interface HostQueueStatus {
  key: HostQueueStatusKey;
  label: string;
  isCopied: boolean;
}

export function getHostQueueStatus(sub: Submission): HostQueueStatus {
  const isCopied = Boolean(sub.copiedAt);
  if (sub.revealed) {
    return { key: 'finished', label: 'הסתיים', isCopied };
  }
  if (sub.imageData) {
    return { key: 'image_pasted', label: 'הודבקה תמונה', isCopied };
  }
  if (sub.prompt.trim().length > 0) {
    return { key: 'ready_to_copy', label: 'מוכן להעתקה', isCopied };
  }
  return { key: 'waiting', label: 'ממתין לפרומפט', isCopied };
}

export function getSubmissionProgress(submissions: Submission[], roundNumber: number) {
  const roundSubs = submissions.filter((s) => s.roundNumber === roundNumber);
  const total = roundSubs.length;
  const promptsDone = roundSubs.filter((s) => s.prompt.trim().length > 0).length;
  const imagesDone = roundSubs.filter((s) => Boolean(s.imageData)).length;
  return { total, promptsDone, imagesDone, allImagesReady: total > 0 && imagesDone === total };
}
