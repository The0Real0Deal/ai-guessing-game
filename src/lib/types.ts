export type GamePhase =
  | 'lobby'
  | 'prompting'
  | 'guessing'
  | 'round_leaderboard'
  | 'finale';

export interface Category {
  id: string;
  name: string;
  words: string[];
}

export interface WordEntry {
  word: string;
  category: string;
}

export interface GameSettings {
  categories: Category[];
  timerSeconds: number;
  guesserPoints: number;
  creatorPoints: number;
  finaleImageData?: string | null;
  finaleImageSizeKb?: number | null;
}

export interface Player {
  id: string;
  roomCode: string;
  nickname: string;
  avatar: string;
  score: number;
  guesserScore: number;
  creatorScore: number;
  prevScore: number;
  roundDelta: number;
  connected: boolean;
  joinedAt: string;
}

export interface Submission {
  id: string;
  roomCode: string;
  roundNumber: number;
  playerId: string;
  category: string;
  secretWord: string;
  prompt: string;
  promptSubmittedAt: string | null;
  copiedAt: string | null;
  imageData: string | null;
  imageSizeKb: number | null;
  orderIndex: number;
  guessedCorrectly: boolean;
  guesserId: string | null;
  revealed: boolean;
  awardedCreatorPts: number;
  awardedGuesserPts: number;
  updatedAt: string;
}

export interface RoundHistoryItem {
  submissionId: string;
  roundNumber: number;
  category: string;
  secretWord: string;
  prompt: string;
  imageData: string;
  creatorId: string;
  creatorNickname: string;
  creatorAvatar: string;
  guessedCorrectly: boolean;
  guesserId: string | null;
  guesserNickname: string | null;
  guesserAvatar: string | null;
}

export interface RoomData {
  code: string;
  phase: GamePhase;
  settings: GameSettings;
  wordDeck: WordEntry[][];
  currentRound: number;
  totalRounds: number;
  currentCategory: string;
  currentGuessIndex: number;
  timerEndsAt: string | null;
  timerPausedRemaining: number | null;
  roundCommentary: string;
  history: RoundHistoryItem[];
  updatedAt: string;
}

export interface RoomSnapshot {
  room: RoomData;
  players: Player[];
  submissions: Submission[];
}

export interface RoundCalculation {
  totalWords: number;
  playerCount: number;
  totalRounds: number;
  leftoverWords: number;
  canStart: boolean;
  categoryCount: number;
}

export type BroadcastEvent =
  | { type: 'confetti'; style: 'reveal' | 'round' | 'finale' }
  | { type: 'state_ping'; updatedAt: string };

export type AwardIconKey = 'palette' | 'search' | 'sparkles';

export interface SuperlativeAward {
  id: string;
  icon: AwardIconKey;
  title: string;
  subtitle: string;
  winnerNames: string[];
  statLabel: string;
}

export interface PlayerRankTrend {
  player: Player;
  currentRank: number;
  prevRank: number;
  rankChange: number; // > 0 climbed, < 0 dropped, 0 steady
}

export interface ForbiddenMatch {
  word: string;
  start: number;
  end: number;
}
