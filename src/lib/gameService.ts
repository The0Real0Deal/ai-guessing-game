import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  buildRoundWordDeck,
  calculateRoundPlan,
  generateId,
  generateRoomCode,
  getRoundCategoryLabel,
  getWittyRoundCommentary,
  shuffle,
} from './gameLogic';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import type {
  BroadcastEvent,
  GameSettings,
  Player,
  RoomData,
  RoomSnapshot,
  RoundHistoryItem,
  Submission,
} from './types';

// ============================================================================
// Database row <-> Domain mappers (Supabase)
// ============================================================================

interface RoomRow {
  code: string;
  phase: RoomData['phase'];
  settings: GameSettings;
  word_deck: RoomData['wordDeck'];
  current_round: number;
  total_rounds: number;
  current_category: string;
  current_guess_index: number;
  timer_ends_at: string | null;
  timer_paused_remaining: number | null;
  round_commentary: string;
  history: RoundHistoryItem[];
  updated_at: string;
}

interface PlayerRow {
  id: string;
  room_code: string;
  nickname: string;
  avatar: string;
  score: number;
  guesser_score: number;
  creator_score: number;
  prev_score: number;
  round_delta: number;
  connected: boolean;
  joined_at: string;
}

interface SubmissionRow {
  id: string;
  room_code: string;
  round_number: number;
  player_id: string;
  category: string;
  secret_word: string;
  prompt: string;
  prompt_submitted_at: string | null;
  image_data: string | null;
  image_size_kb: number | null;
  order_index: number;
  guessed_correctly: boolean;
  guesser_id: string | null;
  revealed: boolean;
  awarded_creator_pts: number;
  awarded_guesser_pts: number;
  updated_at: string;
}

function mapRoomRow(r: RoomRow): RoomData {
  return {
    code: r.code,
    phase: r.phase,
    settings: r.settings,
    wordDeck: Array.isArray(r.word_deck) ? r.word_deck : [],
    currentRound: r.current_round ?? 0,
    totalRounds: r.total_rounds ?? 0,
    currentCategory: r.current_category || '',
    currentGuessIndex: r.current_guess_index ?? 0,
    timerEndsAt: r.timer_ends_at || null,
    timerPausedRemaining: r.timer_paused_remaining ?? null,
    roundCommentary: r.round_commentary || '',
    history: Array.isArray(r.history) ? r.history : [],
    updatedAt: r.updated_at || new Date().toISOString(),
  };
}

function mapPlayerRow(p: PlayerRow): Player {
  return {
    id: p.id,
    roomCode: p.room_code,
    nickname: p.nickname,
    avatar: p.avatar || '🐱',
    score: p.score ?? 0,
    guesserScore: p.guesser_score ?? 0,
    creatorScore: p.creator_score ?? 0,
    prevScore: p.prev_score ?? 0,
    roundDelta: p.round_delta ?? 0,
    connected: p.connected ?? true,
    joinedAt: p.joined_at || new Date().toISOString(),
  };
}

function mapSubmissionRow(s: SubmissionRow): Submission {
  return {
    id: s.id,
    roomCode: s.room_code,
    roundNumber: s.round_number,
    playerId: s.player_id,
    category: s.category,
    secretWord: s.secret_word,
    prompt: s.prompt || '',
    promptSubmittedAt: s.prompt_submitted_at || null,
    imageData: s.image_data || null,
    imageSizeKb: s.image_size_kb ?? null,
    orderIndex: s.order_index ?? 0,
    guessedCorrectly: Boolean(s.guessed_correctly),
    guesserId: s.guesser_id || null,
    revealed: Boolean(s.revealed),
    awardedCreatorPts: s.awarded_creator_pts ?? 0,
    awardedGuesserPts: s.awarded_guesser_pts ?? 0,
    updatedAt: s.updated_at || new Date().toISOString(),
  };
}

// ============================================================================
// Local sync storage & BroadcastChannel + optional Vite dev SSE bridge
// ============================================================================

const LOCAL_KEY_PREFIX = 'catgame_room_snapshot_';

function getLocalStorageKey(code: string) {
  return `${LOCAL_KEY_PREFIX}${code}`;
}

function readLocalSnapshot(code: string): RoomSnapshot | null {
  try {
    const raw = localStorage.getItem(getLocalStorageKey(code));
    return raw ? (JSON.parse(raw) as RoomSnapshot) : null;
  } catch {
    return null;
  }
}

async function fetchLocalDevServerSnapshot(code: string): Promise<RoomSnapshot | null> {
  try {
    const resp = await fetch(`/api/local-sync?code=${encodeURIComponent(code)}`);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return (await resp.json()) as RoomSnapshot;
  } catch {
    return null;
  }
}

async function writeLocalSnapshot(snapshot: RoomSnapshot) {
  const code = snapshot.room.code;
  snapshot.room.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(getLocalStorageKey(code), JSON.stringify(snapshot));
  } catch {
    // Ignore quota errors in extreme cases
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(`catgame-room-${code}`);
      ch.postMessage({ kind: 'snapshot', snapshot });
      ch.close();
    }
  } catch {
    // Ignore
  }

  // Also push to dev server sync bridge if running in `npm run dev`
  try {
    await fetch(`/api/local-sync?code=${encodeURIComponent(code)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
  } catch {
    // Static / production fallback without dev server — BroadcastChannel + localStorage still work
  }
}

async function emitLocalEvent(code: string, event: BroadcastEvent) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(`catgame-room-${code}`);
      ch.postMessage({ kind: 'event', event });
      ch.close();
    }
  } catch {
    // Ignore
  }

  try {
    await fetch(`/api/local-sync/event?code=${encodeURIComponent(code)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // Ignore
  }
}

// Track active Supabase channels so mutations can fire immediate broadcast pings
const activeSupabaseChannels = new Map<string, RealtimeChannel>();

async function broadcastSupabaseEvent(code: string, event: BroadcastEvent) {
  const existing = activeSupabaseChannels.get(code);
  if (existing) {
    await existing.send({
      type: 'broadcast',
      event: 'game_event',
      payload: event,
    });
    return;
  }

  const sb = getSupabaseClient();
  if (!sb) return;
  const tempChannel = sb.channel(`room-emit-${code}-${Math.random().toString(36).slice(2, 6)}`);
  await new Promise<void>((resolve) => {
    tempChannel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await tempChannel.send({
          type: 'broadcast',
          event: 'game_event',
          payload: event,
        });
        sb.removeChannel(tempChannel);
        resolve();
      }
    });
    setTimeout(() => {
      sb.removeChannel(tempChannel);
      resolve();
    }, 1500);
  });
}

// ============================================================================
// Public Game Service API
// ============================================================================

export function getSyncMode(): 'supabase' | 'local' {
  return isSupabaseConfigured() ? 'supabase' : 'local';
}

export async function getRoomSnapshot(code: string): Promise<RoomSnapshot | null> {
  const cleanCode = code.trim();
  if (!cleanCode) return null;

  const sb = getSupabaseClient();
  if (sb) {
    const [roomRes, playersRes, subsRes] = await Promise.all([
      sb.from('game_rooms').select('*').eq('code', cleanCode).maybeSingle(),
      sb
        .from('game_players')
        .select('*')
        .eq('room_code', cleanCode)
        .order('joined_at', { ascending: true }),
      sb
        .from('game_submissions')
        .select('*')
        .eq('room_code', cleanCode)
        .order('order_index', { ascending: true }),
    ]);

    if (roomRes.error) throw new Error(`שגיאת חיבור ל-Supabase: ${roomRes.error.message}`);
    if (!roomRes.data) return null;

    return {
      room: mapRoomRow(roomRes.data as RoomRow),
      players: ((playersRes.data || []) as PlayerRow[]).map(mapPlayerRow),
      submissions: ((subsRes.data || []) as SubmissionRow[]).map(mapSubmissionRow),
    };
  }

  // Local mode: prefer dev-server snapshot if available (cross-device Wi-Fi), else localStorage
  const serverSnap = await fetchLocalDevServerSnapshot(cleanCode);
  if (serverSnap) {
    try {
      localStorage.setItem(getLocalStorageKey(cleanCode), JSON.stringify(serverSnap));
    } catch {
      // ignore
    }
    return serverSnap;
  }
  return readLocalSnapshot(cleanCode);
}

export function subscribeToRoom(
  code: string,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onEvent?: (event: BroadcastEvent) => void
): () => void {
  const cleanCode = code.trim();
  const sb = getSupabaseClient();

  if (sb) {
    let debounceTimer: number | null = null;
    let disposed = false;

    const refresh = () => {
      if (disposed) return;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(async () => {
        try {
          const snap = await getRoomSnapshot(cleanCode);
          if (snap && !disposed) onSnapshot(snap);
        } catch {
          // Ignore transient fetch errors; next event will recover
        }
      }, 65);
    };

    const channel = sb
      .channel(`room:${cleanCode}`, {
        config: { broadcast: { self: false } },
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_rooms', filter: `code=eq.${cleanCode}` },
        refresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: `room_code=eq.${cleanCode}` },
        refresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_submissions', filter: `room_code=eq.${cleanCode}` },
        refresh
      )
      .on('broadcast', { event: 'game_event' }, ({ payload }) => {
        const evt = payload as BroadcastEvent;
        if (!evt) return;
        if (evt.type === 'state_ping') {
          refresh();
        } else if (onEvent) {
          onEvent(evt);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          refresh();
        }
      });

    activeSupabaseChannels.set(cleanCode, channel);

    // Resync immediately when a mobile screen wakes back up
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (activeSupabaseChannels.get(cleanCode) === channel) {
        activeSupabaseChannels.delete(cleanCode);
      }
      sb.removeChannel(channel);
    };
  }

  // Local Sync Mode (BroadcastChannel + localStorage + Vite dev SSE)
  let disposed = false;
  let bc: BroadcastChannel | null = null;
  let sse: EventSource | null = null;

  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(`catgame-room-${cleanCode}`);
    bc.onmessage = (msg) => {
      if (disposed) return;
      const data = msg.data as
        | { kind: 'snapshot'; snapshot: RoomSnapshot }
        | { kind: 'event'; event: BroadcastEvent };
      if (data?.kind === 'snapshot') {
        onSnapshot(data.snapshot);
      } else if (data?.kind === 'event' && onEvent) {
        onEvent(data.event);
      }
    };
  }

  const onStorage = (e: StorageEvent) => {
    if (disposed || e.key !== getLocalStorageKey(cleanCode) || !e.newValue) return;
    try {
      onSnapshot(JSON.parse(e.newValue) as RoomSnapshot);
    } catch {
      // ignore
    }
  };
  window.addEventListener('storage', onStorage);

  // Connect to dev SSE endpoint if in Vite dev mode
  if (import.meta.env.DEV && typeof EventSource !== 'undefined') {
    try {
      sse = new EventSource(`/api/local-sync/events?code=${encodeURIComponent(cleanCode)}`);
      sse.onmessage = (e) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(e.data) as
            | { kind: 'snapshot'; snapshot: RoomSnapshot }
            | { kind: 'event'; event: BroadcastEvent };
          if (parsed.kind === 'snapshot') {
            try {
              localStorage.setItem(getLocalStorageKey(cleanCode), JSON.stringify(parsed.snapshot));
            } catch {
              // ignore
            }
            onSnapshot(parsed.snapshot);
          } else if (parsed.kind === 'event' && onEvent) {
            onEvent(parsed.event);
          }
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  return () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    bc?.close();
    sse?.close();
  };
}

export async function createRoom(settings: GameSettings): Promise<RoomSnapshot> {
  const plan = calculateRoundPlan(settings.categories, 1);
  if (plan.totalWords === 0) {
    throw new Error('אנא הוסיפו לפחות קטגוריה אחת עם מילים לניחוש.');
  }

  let code = generateRoomCode();
  const now = new Date().toISOString();

  const room: RoomData = {
    code,
    phase: 'lobby',
    settings,
    wordDeck: [],
    currentRound: 0,
    totalRounds: 0,
    currentCategory: '',
    currentGuessIndex: 0,
    timerEndsAt: null,
    timerPausedRemaining: null,
    roundCommentary: '',
    history: [],
    updatedAt: now,
  };

  const sb = getSupabaseClient();
  if (sb) {
    // Ensure unique 4-digit room code
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: existing } = await sb
        .from('game_rooms')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      if (!existing) break;
      code = generateRoomCode();
    }
    room.code = code;

    const { error } = await sb.from('game_rooms').insert({
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      word_deck: [],
      current_round: 0,
      total_rounds: 0,
      current_category: '',
      current_guess_index: 0,
      timer_ends_at: null,
      timer_paused_remaining: null,
      round_commentary: '',
      history: [],
      updated_at: now,
    });

    if (error) {
      throw new Error(`לא ניתן ליצור חדר ב-Supabase: ${error.message}`);
    }

    return { room, players: [], submissions: [] };
  }

  const snapshot: RoomSnapshot = { room, players: [], submissions: [] };
  await writeLocalSnapshot(snapshot);
  return snapshot;
}

export async function updateRoomSettings(code: string, settings: GameSettings): Promise<RoomSnapshot> {
  const sb = getSupabaseClient();
  const now = new Date().toISOString();

  if (sb) {
    const { error } = await sb
      .from('game_rooms')
      .update({ settings, updated_at: now })
      .eq('code', code);
    if (error) throw new Error(error.message);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    const snap = await getRoomSnapshot(code);
    if (!snap) throw new Error('החדר לא נמצא');
    return snap;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  snap.room.settings = settings;
  await writeLocalSnapshot(snap);
  return snap;
}

export async function joinRoom(
  code: string,
  nickname: string,
  avatar: string,
  existingPlayerId?: string
): Promise<{ player: Player; snapshot: RoomSnapshot }> {
  const cleanCode = code.trim();
  const cleanName = nickname.trim().slice(0, 22);
  if (!cleanName && !existingPlayerId) {
    throw new Error('אנא בחרו כינוי מדליק לפני ההצטרפות.');
  }

  const snap = await getRoomSnapshot(cleanCode);
  if (!snap) {
    throw new Error('קוד החדר לא נמצא! בדקו את 4 הספרות שעל המסך הראשי.');
  }

  // Reconnect existing player
  if (existingPlayerId) {
    const existing = snap.players.find((p) => p.id === existingPlayerId);
    if (existing) {
      const sb = getSupabaseClient();
      if (sb) {
        await sb.from('game_players').update({ connected: true }).eq('id', existing.id);
        await broadcastSupabaseEvent(cleanCode, { type: 'state_ping', updatedAt: new Date().toISOString() });
        const fresh = (await getRoomSnapshot(cleanCode))!;
        return { player: fresh.players.find((p) => p.id === existing.id) || existing, snapshot: fresh };
      }
      existing.connected = true;
      await writeLocalSnapshot(snap);
      return { player: existing, snapshot: snap };
    }
  }

  // Match by nickname if rejoining mid-game
  const sameName = snap.players.find(
    (p) => p.nickname.trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (sameName) {
    if (snap.room.phase !== 'lobby') {
      const sb = getSupabaseClient();
      if (sb) {
        await sb.from('game_players').update({ connected: true }).eq('id', sameName.id);
        await broadcastSupabaseEvent(cleanCode, { type: 'state_ping', updatedAt: new Date().toISOString() });
        const fresh = (await getRoomSnapshot(cleanCode))!;
        return { player: fresh.players.find((p) => p.id === sameName.id) || sameName, snapshot: fresh };
      }
      sameName.connected = true;
      await writeLocalSnapshot(snap);
      return { player: sameName, snapshot: snap };
    }
    throw new Error('הכינוי הזה כבר תפוס בחדר! בחרו כינוי אחר או הוסיפו אימוג׳י 😉');
  }

  if (snap.room.phase !== 'lobby') {
    throw new Error('המשחק כבר התחיל! אם התנתקתם, הזינו בדיוק את הכינוי הקודם שלכם כדי לחזור.');
  }

  const newPlayer: Player = {
    id: generateId('p'),
    roomCode: cleanCode,
    nickname: cleanName,
    avatar: avatar || '🐱',
    score: 0,
    guesserScore: 0,
    creatorScore: 0,
    prevScore: 0,
    roundDelta: 0,
    connected: true,
    joinedAt: new Date().toISOString(),
  };

  const sb = getSupabaseClient();
  if (sb) {
    const { error } = await sb.from('game_players').insert({
      id: newPlayer.id,
      room_code: newPlayer.roomCode,
      nickname: newPlayer.nickname,
      avatar: newPlayer.avatar,
      score: 0,
      guesser_score: 0,
      creator_score: 0,
      prev_score: 0,
      round_delta: 0,
      connected: true,
      joined_at: newPlayer.joinedAt,
    });
    if (error) throw new Error(error.message);
    await broadcastSupabaseEvent(cleanCode, { type: 'state_ping', updatedAt: new Date().toISOString() });
    const fresh = (await getRoomSnapshot(cleanCode))!;
    return { player: newPlayer, snapshot: fresh };
  }

  snap.players.push(newPlayer);
  await writeLocalSnapshot(snap);
  return { player: newPlayer, snapshot: snap };
}

export async function removePlayer(code: string, playerId: string): Promise<RoomSnapshot> {
  const sb = getSupabaseClient();
  if (sb) {
    await sb.from('game_players').delete().eq('id', playerId).eq('room_code', code);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: new Date().toISOString() });
    const fresh = await getRoomSnapshot(code);
    if (!fresh) throw new Error('החדר לא נמצא');
    return fresh;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  snap.players = snap.players.filter((p) => p.id !== playerId);
  snap.submissions = snap.submissions.filter((s) => s.playerId !== playerId);
  await writeLocalSnapshot(snap);
  return snap;
}

export async function startGame(code: string): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const activePlayers = snap.players.filter((p) => p.connected);
  if (activePlayers.length < 1) {
    throw new Error('נדרש לפחות שחקן אחד מחובר כדי להתחיל את המשחק.');
  }

  const wordDeck = buildRoundWordDeck(snap.room.settings.categories, activePlayers.length);
  if (wordDeck.length < 1) {
    throw new Error(
      `אין מספיק מילים ל-${activePlayers.length} שחקנים! הוסיפו לפחות ${activePlayers.length} מילים ייחודיות.`
    );
  }

  const round1Words = shuffle(wordDeck[0]);
  const round1Category = getRoundCategoryLabel(round1Words);
  const now = new Date().toISOString();

  const round1Submissions: Submission[] = activePlayers.map((player, idx) => ({
    id: generateId('sub'),
    roomCode: code,
    roundNumber: 1,
    playerId: player.id,
    category: round1Words[idx].category,
    secretWord: round1Words[idx].word,
    prompt: '',
    promptSubmittedAt: null,
    imageData: null,
    imageSizeKb: null,
    orderIndex: idx,
    guessedCorrectly: false,
    guesserId: null,
    revealed: false,
    awardedCreatorPts: 0,
    awardedGuesserPts: 0,
    updatedAt: now,
  }));

  const sb = getSupabaseClient();
  if (sb) {
    await sb.from('game_submissions').delete().eq('room_code', code);

    await sb
      .from('game_players')
      .update({ score: 0, guesser_score: 0, creator_score: 0, prev_score: 0, round_delta: 0 })
      .eq('room_code', code);

    const { error: subErr } = await sb.from('game_submissions').insert(
      round1Submissions.map((s) => ({
        id: s.id,
        room_code: s.roomCode,
        round_number: s.roundNumber,
        player_id: s.playerId,
        category: s.category,
        secret_word: s.secretWord,
        prompt: '',
        prompt_submitted_at: null,
        image_data: null,
        image_size_kb: null,
        order_index: s.orderIndex,
        guessed_correctly: false,
        guesser_id: null,
        revealed: false,
        awarded_creator_pts: 0,
        awarded_guesser_pts: 0,
        updated_at: now,
      }))
    );
    if (subErr) throw new Error(subErr.message);

    const { error: roomErr } = await sb
      .from('game_rooms')
      .update({
        phase: 'prompting',
        word_deck: wordDeck,
        current_round: 1,
        total_rounds: wordDeck.length,
        current_category: round1Category,
        current_guess_index: 0,
        timer_ends_at: null,
        timer_paused_remaining: null,
        round_commentary: '',
        history: [],
        updated_at: now,
      })
      .eq('code', code);
    if (roomErr) throw new Error(roomErr.message);

    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  snap.players = snap.players.map((p) => ({
    ...p,
    score: 0,
    guesserScore: 0,
    creatorScore: 0,
    prevScore: 0,
    roundDelta: 0,
  }));
  snap.submissions = round1Submissions;
  snap.room = {
    ...snap.room,
    phase: 'prompting',
    wordDeck,
    currentRound: 1,
    totalRounds: wordDeck.length,
    currentCategory: round1Category,
    currentGuessIndex: 0,
    timerEndsAt: null,
    timerPausedRemaining: null,
    roundCommentary: '',
    history: [],
    updatedAt: now,
  };
  await writeLocalSnapshot(snap);
  return snap;
}

export async function submitPrompt(
  code: string,
  playerId: string,
  roundNumber: number,
  prompt: string
): Promise<RoomSnapshot> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('כתבו תיאור (פרומפט) לפני השליחה!');
  const now = new Date().toISOString();

  const sb = getSupabaseClient();
  if (sb) {
    const { error } = await sb
      .from('game_submissions')
      .update({
        prompt: cleanPrompt,
        prompt_submitted_at: now,
        updated_at: now,
      })
      .eq('room_code', code)
      .eq('player_id', playerId)
      .eq('round_number', roundNumber);

    if (error) throw new Error(error.message);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  const sub = snap.submissions.find(
    (s) => s.playerId === playerId && s.roundNumber === roundNumber
  );
  if (!sub) throw new Error('לא נמצאה משימה לסיבוב זה');
  sub.prompt = cleanPrompt;
  sub.promptSubmittedAt = now;
  sub.updatedAt = now;
  await writeLocalSnapshot(snap);
  return snap;
}

export async function attachPlayerImage(
  code: string,
  submissionId: string,
  imageData: string,
  imageSizeKb: number
): Promise<RoomSnapshot> {
  const now = new Date().toISOString();
  const sb = getSupabaseClient();

  if (sb) {
    const { error } = await sb
      .from('game_submissions')
      .update({
        image_data: imageData,
        image_size_kb: imageSizeKb,
        updated_at: now,
      })
      .eq('id', submissionId)
      .eq('room_code', code);

    if (error) throw new Error(error.message);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  const sub = snap.submissions.find((s) => s.id === submissionId);
  if (!sub) throw new Error('לא נמצאה רשומת שחקן');
  sub.imageData = imageData;
  sub.imageSizeKb = imageSizeKb;
  sub.updatedAt = now;
  await writeLocalSnapshot(snap);
  return snap;
}

export async function clearPlayerImage(code: string, submissionId: string): Promise<RoomSnapshot> {
  const now = new Date().toISOString();
  const sb = getSupabaseClient();

  if (sb) {
    const { error } = await sb
      .from('game_submissions')
      .update({
        image_data: null,
        image_size_kb: null,
        updated_at: now,
      })
      .eq('id', submissionId)
      .eq('room_code', code);
    if (error) throw new Error(error.message);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  const sub = snap.submissions.find((s) => s.id === submissionId);
  if (sub) {
    sub.imageData = null;
    sub.imageSizeKb = null;
    sub.updatedAt = now;
  }
  await writeLocalSnapshot(snap);
  return snap;
}

export async function startGuessingPhase(code: string): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const readySubs = snap.submissions.filter(
    (s) => s.roundNumber === snap.room.currentRound && Boolean(s.imageData)
  );
  if (readySubs.length === 0) {
    throw new Error('אנא הדביקו לפחות תמונה אחת לפני המעבר לשלב הניחושים!');
  }

  const shuffledReady = shuffle(readySubs);
  const now = new Date();
  const timerEndsAt = new Date(now.getTime() + snap.room.settings.timerSeconds * 1000).toISOString();
  const firstCategory = shuffledReady[0].category;

  const sb = getSupabaseClient();
  if (sb) {
    await Promise.all(
      shuffledReady.map((s, idx) =>
        sb
          .from('game_submissions')
          .update({ order_index: idx, updated_at: now.toISOString() })
          .eq('id', s.id)
      )
    );

    const { error } = await sb
      .from('game_rooms')
      .update({
        phase: 'guessing',
        current_guess_index: 0,
        current_category: firstCategory,
        timer_ends_at: timerEndsAt,
        timer_paused_remaining: null,
        updated_at: now.toISOString(),
      })
      .eq('code', code);
    if (error) throw new Error(error.message);

    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now.toISOString() });
    return (await getRoomSnapshot(code))!;
  }

  shuffledReady.forEach((s, idx) => {
    const target = snap.submissions.find((item) => item.id === s.id);
    if (target) target.orderIndex = idx;
  });
  snap.room.phase = 'guessing';
  snap.room.currentGuessIndex = 0;
  snap.room.currentCategory = firstCategory;
  snap.room.timerEndsAt = timerEndsAt;
  snap.room.timerPausedRemaining = null;
  await writeLocalSnapshot(snap);
  return snap;
}

export async function controlTimer(
  code: string,
  action: 'start' | 'pause' | 'reset' | 'add15'
): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const nowMs = Date.now();
  const defaultSec = snap.room.settings.timerSeconds;
  let timerEndsAt = snap.room.timerEndsAt;
  let timerPausedRemaining = snap.room.timerPausedRemaining;

  const currentRemaining = timerEndsAt
    ? Math.max(0, Math.ceil((new Date(timerEndsAt).getTime() - nowMs) / 1000))
    : timerPausedRemaining ?? defaultSec;

  if (action === 'pause') {
    timerEndsAt = null;
    timerPausedRemaining = currentRemaining;
  } else if (action === 'start') {
    const secs = currentRemaining > 0 ? currentRemaining : defaultSec;
    timerEndsAt = new Date(nowMs + secs * 1000).toISOString();
    timerPausedRemaining = null;
  } else if (action === 'reset') {
    timerEndsAt = new Date(nowMs + defaultSec * 1000).toISOString();
    timerPausedRemaining = null;
  } else if (action === 'add15') {
    const secs = currentRemaining + 15;
    if (timerEndsAt) {
      timerEndsAt = new Date(nowMs + secs * 1000).toISOString();
    } else {
      timerPausedRemaining = secs;
    }
  }

  const nowIso = new Date().toISOString();
  const sb = getSupabaseClient();
  if (sb) {
    await sb
      .from('game_rooms')
      .update({
        timer_ends_at: timerEndsAt,
        timer_paused_remaining: timerPausedRemaining,
        updated_at: nowIso,
      })
      .eq('code', code);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: nowIso });
    return (await getRoomSnapshot(code))!;
  }

  snap.room.timerEndsAt = timerEndsAt;
  snap.room.timerPausedRemaining = timerPausedRemaining;
  await writeLocalSnapshot(snap);
  return snap;
}

function buildHistoryItem(
  sub: Submission,
  players: Player[],
  guessedCorrectly: boolean,
  guesserId: string | null
): RoundHistoryItem {
  const creator = players.find((p) => p.id === sub.playerId);
  const guesser = guesserId ? players.find((p) => p.id === guesserId) : null;
  return {
    submissionId: sub.id,
    roundNumber: sub.roundNumber,
    category: sub.category,
    secretWord: sub.secretWord,
    prompt: sub.prompt,
    imageData: sub.imageData || '',
    creatorId: sub.playerId,
    creatorNickname: creator?.nickname || 'שחקן',
    creatorAvatar: creator?.avatar || '🎨',
    guessedCorrectly,
    guesserId: guesser?.id || null,
    guesserNickname: guesser?.nickname || null,
    guesserAvatar: guesser?.avatar || null,
  };
}

export async function awardPointsAndReveal(
  code: string,
  submissionId: string,
  guesserId: string | null
): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const sub = snap.submissions.find((s) => s.id === submissionId);
  if (!sub) throw new Error('התמונה לא נמצאה');
  if (sub.revealed) return snap;

  const creator = snap.players.find((p) => p.id === sub.playerId);
  const guesser = guesserId ? snap.players.find((p) => p.id === guesserId) : null;

  const creatorPts = guesser ? snap.room.settings.creatorPoints : 0;
  const guesserPts = guesser ? snap.room.settings.guesserPoints : 0;
  const guessedCorrectly = Boolean(guesser);
  const now = new Date().toISOString();

  const historyItem = buildHistoryItem(sub, snap.players, guessedCorrectly, guesser?.id || null);
  const nextHistory = [
    ...snap.room.history.filter((h) => h.submissionId !== sub.id),
    historyItem,
  ];

  const sb = getSupabaseClient();
  if (sb) {
    const updates: PromiseLike<unknown>[] = [
      sb
        .from('game_submissions')
        .update({
          guessed_correctly: guessedCorrectly,
          guesser_id: guesser?.id || null,
          revealed: true,
          awarded_creator_pts: creatorPts,
          awarded_guesser_pts: guesserPts,
          updated_at: now,
        })
        .eq('id', sub.id),
      sb
        .from('game_rooms')
        .update({
          timer_ends_at: null,
          timer_paused_remaining: 0,
          history: nextHistory,
          updated_at: now,
        })
        .eq('code', code),
    ];

    if (guesser && creator && creator.id === guesser.id) {
      // Edge case: solo testing where guesser == creator
      const totalPts = creatorPts + guesserPts;
      updates.push(
        sb
          .from('game_players')
          .update({
            score: creator.score + totalPts,
            creator_score: creator.creatorScore + creatorPts,
            guesser_score: creator.guesserScore + guesserPts,
            round_delta: creator.roundDelta + totalPts,
          })
          .eq('id', creator.id)
      );
    } else {
      if (guesser && guesserPts > 0) {
        updates.push(
          sb
            .from('game_players')
            .update({
              score: guesser.score + guesserPts,
              guesser_score: guesser.guesserScore + guesserPts,
              round_delta: guesser.roundDelta + guesserPts,
            })
            .eq('id', guesser.id)
        );
      }
      if (creator && creatorPts > 0) {
        updates.push(
          sb
            .from('game_players')
            .update({
              score: creator.score + creatorPts,
              creator_score: creator.creatorScore + creatorPts,
              round_delta: creator.roundDelta + creatorPts,
            })
            .eq('id', creator.id)
        );
      }
    }

    await Promise.all(updates);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    if (guessedCorrectly) {
      await broadcastSupabaseEvent(code, { type: 'confetti', style: 'reveal' });
    }
    return (await getRoomSnapshot(code))!;
  }

  sub.guessedCorrectly = guessedCorrectly;
  sub.guesserId = guesser?.id || null;
  sub.revealed = true;
  sub.awardedCreatorPts = creatorPts;
  sub.awardedGuesserPts = guesserPts;
  sub.updatedAt = now;

  if (guesser && creator && creator.id === guesser.id) {
    creator.score += creatorPts + guesserPts;
    creator.creatorScore += creatorPts;
    creator.guesserScore += guesserPts;
    creator.roundDelta += creatorPts + guesserPts;
  } else {
    if (guesser && guesserPts > 0) {
      guesser.score += guesserPts;
      guesser.guesserScore += guesserPts;
      guesser.roundDelta += guesserPts;
    }
    if (creator && creatorPts > 0) {
      creator.score += creatorPts;
      creator.creatorScore += creatorPts;
      creator.roundDelta += creatorPts;
    }
  }

  snap.room.timerEndsAt = null;
  snap.room.timerPausedRemaining = 0;
  snap.room.history = nextHistory;
  await writeLocalSnapshot(snap);
  if (guessedCorrectly) {
    await emitLocalEvent(code, { type: 'confetti', style: 'reveal' });
  }
  return snap;
}

export async function undoReveal(code: string, submissionId: string): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const sub = snap.submissions.find((s) => s.id === submissionId);
  if (!sub || !sub.revealed) return snap;

  const creator = snap.players.find((p) => p.id === sub.playerId);
  const guesser = sub.guesserId ? snap.players.find((p) => p.id === sub.guesserId) : null;
  const now = new Date().toISOString();
  const nextHistory = snap.room.history.filter((h) => h.submissionId !== sub.id);

  const sb = getSupabaseClient();
  if (sb) {
    const updates: PromiseLike<unknown>[] = [
      sb
        .from('game_submissions')
        .update({
          guessed_correctly: false,
          guesser_id: null,
          revealed: false,
          awarded_creator_pts: 0,
          awarded_guesser_pts: 0,
          updated_at: now,
        })
        .eq('id', sub.id),
      sb
        .from('game_rooms')
        .update({ history: nextHistory, updated_at: now })
        .eq('code', code),
    ];

    if (guesser && creator && creator.id === guesser.id) {
      const totalPts = sub.awardedCreatorPts + sub.awardedGuesserPts;
      updates.push(
        sb
          .from('game_players')
          .update({
            score: Math.max(0, creator.score - totalPts),
            creator_score: Math.max(0, creator.creatorScore - sub.awardedCreatorPts),
            guesser_score: Math.max(0, creator.guesserScore - sub.awardedGuesserPts),
            round_delta: Math.max(0, creator.roundDelta - totalPts),
          })
          .eq('id', creator.id)
      );
    } else {
      if (guesser && sub.awardedGuesserPts > 0) {
        updates.push(
          sb
            .from('game_players')
            .update({
              score: Math.max(0, guesser.score - sub.awardedGuesserPts),
              guesser_score: Math.max(0, guesser.guesserScore - sub.awardedGuesserPts),
              round_delta: Math.max(0, guesser.roundDelta - sub.awardedGuesserPts),
            })
            .eq('id', guesser.id)
        );
      }
      if (creator && sub.awardedCreatorPts > 0) {
        updates.push(
          sb
            .from('game_players')
            .update({
              score: Math.max(0, creator.score - sub.awardedCreatorPts),
              creator_score: Math.max(0, creator.creatorScore - sub.awardedCreatorPts),
              round_delta: Math.max(0, creator.roundDelta - sub.awardedCreatorPts),
            })
            .eq('id', creator.id)
        );
      }
    }

    await Promise.all(updates);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  if (guesser && creator && creator.id === guesser.id) {
    const totalPts = sub.awardedCreatorPts + sub.awardedGuesserPts;
    creator.score = Math.max(0, creator.score - totalPts);
    creator.creatorScore = Math.max(0, creator.creatorScore - sub.awardedCreatorPts);
    creator.guesserScore = Math.max(0, creator.guesserScore - sub.awardedGuesserPts);
    creator.roundDelta = Math.max(0, creator.roundDelta - totalPts);
  } else {
    if (guesser && sub.awardedGuesserPts > 0) {
      guesser.score = Math.max(0, guesser.score - sub.awardedGuesserPts);
      guesser.guesserScore = Math.max(0, guesser.guesserScore - sub.awardedGuesserPts);
      guesser.roundDelta = Math.max(0, guesser.roundDelta - sub.awardedGuesserPts);
    }
    if (creator && sub.awardedCreatorPts > 0) {
      creator.score = Math.max(0, creator.score - sub.awardedCreatorPts);
      creator.creatorScore = Math.max(0, creator.creatorScore - sub.awardedCreatorPts);
      creator.roundDelta = Math.max(0, creator.roundDelta - sub.awardedCreatorPts);
    }
  }

  sub.guessedCorrectly = false;
  sub.guesserId = null;
  sub.revealed = false;
  sub.awardedCreatorPts = 0;
  sub.awardedGuesserPts = 0;
  sub.updatedAt = now;
  snap.room.history = nextHistory;
  await writeLocalSnapshot(snap);
  return snap;
}

export function getOrderedGuessQueue(snap: RoomSnapshot): Submission[] {
  return snap.submissions
    .filter((s) => s.roundNumber === snap.room.currentRound && Boolean(s.imageData))
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

export async function nextGuessOrLeaderboard(code: string): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');

  const queue = getOrderedGuessQueue(snap);
  const currentSub = queue[snap.room.currentGuessIndex];
  const now = new Date();
  let nextHistory = [...snap.room.history];

  // Record unrevealed skipped image into gallery history too
  if (currentSub && !nextHistory.some((h) => h.submissionId === currentSub.id)) {
    nextHistory.push(buildHistoryItem(currentSub, snap.players, currentSub.guessedCorrectly, currentSub.guesserId));
  }

  const nextIdx = snap.room.currentGuessIndex + 1;
  const sb = getSupabaseClient();

  if (nextIdx < queue.length) {
    const nextSub = queue[nextIdx];
    const timerEndsAt = new Date(
      now.getTime() + snap.room.settings.timerSeconds * 1000
    ).toISOString();

    if (sb) {
      await sb
        .from('game_rooms')
        .update({
          current_guess_index: nextIdx,
          current_category: nextSub.category,
          timer_ends_at: timerEndsAt,
          timer_paused_remaining: null,
          history: nextHistory,
          updated_at: now.toISOString(),
        })
        .eq('code', code);
      await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now.toISOString() });
      return (await getRoomSnapshot(code))!;
    }

    snap.room.currentGuessIndex = nextIdx;
    snap.room.currentCategory = nextSub.category;
    snap.room.timerEndsAt = timerEndsAt;
    snap.room.timerPausedRemaining = null;
    snap.room.history = nextHistory;
    await writeLocalSnapshot(snap);
    return snap;
  }

  // Round completed -> transition to animated End-of-Round Leaderboard!
  const commentary = getWittyRoundCommentary(
    snap.players,
    snap.room.currentRound,
    snap.room.totalRounds
  );

  if (sb) {
    await sb
      .from('game_rooms')
      .update({
        phase: 'round_leaderboard',
        timer_ends_at: null,
        timer_paused_remaining: null,
        round_commentary: commentary,
        history: nextHistory,
        updated_at: now.toISOString(),
      })
      .eq('code', code);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now.toISOString() });
    await broadcastSupabaseEvent(code, { type: 'confetti', style: 'round' });
    return (await getRoomSnapshot(code))!;
  }

  snap.room.phase = 'round_leaderboard';
  snap.room.timerEndsAt = null;
  snap.room.timerPausedRemaining = null;
  snap.room.roundCommentary = commentary;
  snap.room.history = nextHistory;
  await writeLocalSnapshot(snap);
  await emitLocalEvent(code, { type: 'confetti', style: 'round' });
  return snap;
}

export async function nextRoundOrFinale(code: string): Promise<RoomSnapshot> {
  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  const now = new Date().toISOString();
  const sb = getSupabaseClient();

  if (snap.room.currentRound >= snap.room.totalRounds) {
    if (sb) {
      await sb
        .from('game_rooms')
        .update({
          phase: 'finale',
          timer_ends_at: null,
          timer_paused_remaining: null,
          updated_at: now,
        })
        .eq('code', code);
      await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
      await broadcastSupabaseEvent(code, { type: 'confetti', style: 'finale' });
      return (await getRoomSnapshot(code))!;
    }

    snap.room.phase = 'finale';
    snap.room.timerEndsAt = null;
    snap.room.timerPausedRemaining = null;
    await writeLocalSnapshot(snap);
    await emitLocalEvent(code, { type: 'confetti', style: 'finale' });
    return snap;
  }

  // Advance to next round
  const nextRound = snap.room.currentRound + 1;
  const activePlayers = snap.players.filter((p) => p.connected);
  const deckWords = snap.room.wordDeck[nextRound - 1];
  if (!deckWords || deckWords.length < activePlayers.length) {
    // Safety fallback to finale if player count somehow exceeded pre-dealt deck
    snap.room.phase = 'finale';
    if (sb) {
      await sb.from('game_rooms').update({ phase: 'finale', updated_at: now }).eq('code', code);
      await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
      return (await getRoomSnapshot(code))!;
    }
    await writeLocalSnapshot(snap);
    return snap;
  }

  const assignedWords = shuffle(deckWords);
  const nextCategory = getRoundCategoryLabel(assignedWords);

  const nextSubmissions: Submission[] = activePlayers.map((player, idx) => ({
    id: generateId('sub'),
    roomCode: code,
    roundNumber: nextRound,
    playerId: player.id,
    category: assignedWords[idx].category,
    secretWord: assignedWords[idx].word,
    prompt: '',
    promptSubmittedAt: null,
    imageData: null,
    imageSizeKb: null,
    orderIndex: idx,
    guessedCorrectly: false,
    guesserId: null,
    revealed: false,
    awardedCreatorPts: 0,
    awardedGuesserPts: 0,
    updatedAt: now,
  }));

  if (sb) {
    // Snapshot prevScore & reset roundDelta for animated leaderboard delta next round
    await Promise.all(
      snap.players.map((p) =>
        sb
          .from('game_players')
          .update({ prev_score: p.score, round_delta: 0 })
          .eq('id', p.id)
      )
    );

    const { error: subErr } = await sb.from('game_submissions').insert(
      nextSubmissions.map((s) => ({
        id: s.id,
        room_code: s.roomCode,
        round_number: s.roundNumber,
        player_id: s.playerId,
        category: s.category,
        secret_word: s.secretWord,
        prompt: '',
        prompt_submitted_at: null,
        image_data: null,
        image_size_kb: null,
        order_index: s.orderIndex,
        guessed_correctly: false,
        guesser_id: null,
        revealed: false,
        awarded_creator_pts: 0,
        awarded_guesser_pts: 0,
        updated_at: now,
      }))
    );
    if (subErr) throw new Error(subErr.message);

    await sb
      .from('game_rooms')
      .update({
        phase: 'prompting',
        current_round: nextRound,
        current_category: nextCategory,
        current_guess_index: 0,
        timer_ends_at: null,
        timer_paused_remaining: null,
        updated_at: now,
      })
      .eq('code', code);

    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  snap.players = snap.players.map((p) => ({
    ...p,
    prevScore: p.score,
    roundDelta: 0,
  }));
  snap.submissions.push(...nextSubmissions);
  snap.room.phase = 'prompting';
  snap.room.currentRound = nextRound;
  snap.room.currentCategory = nextCategory;
  snap.room.currentGuessIndex = 0;
  snap.room.timerEndsAt = null;
  snap.room.timerPausedRemaining = null;
  await writeLocalSnapshot(snap);
  return snap;
}

export async function resetRoomForNewGame(code: string): Promise<RoomSnapshot> {
  const now = new Date().toISOString();
  const sb = getSupabaseClient();

  if (sb) {
    await sb.from('game_submissions').delete().eq('room_code', code);
    await sb
      .from('game_players')
      .update({ score: 0, guesser_score: 0, creator_score: 0, prev_score: 0, round_delta: 0 })
      .eq('room_code', code);
    await sb
      .from('game_rooms')
      .update({
        phase: 'lobby',
        word_deck: [],
        current_round: 0,
        total_rounds: 0,
        current_category: '',
        current_guess_index: 0,
        timer_ends_at: null,
        timer_paused_remaining: null,
        round_commentary: '',
        history: [],
        updated_at: now,
      })
      .eq('code', code);
    await broadcastSupabaseEvent(code, { type: 'state_ping', updatedAt: now });
    return (await getRoomSnapshot(code))!;
  }

  const snap = await getRoomSnapshot(code);
  if (!snap) throw new Error('החדר לא נמצא');
  snap.players = snap.players.map((p) => ({
    ...p,
    score: 0,
    guesserScore: 0,
    creatorScore: 0,
    prevScore: 0,
    roundDelta: 0,
  }));
  snap.submissions = [];
  snap.room.phase = 'lobby';
  snap.room.wordDeck = [];
  snap.room.currentRound = 0;
  snap.room.totalRounds = 0;
  snap.room.currentCategory = '';
  snap.room.currentGuessIndex = 0;
  snap.room.timerEndsAt = null;
  snap.room.timerPausedRemaining = null;
  snap.room.roundCommentary = '';
  snap.room.history = [];
  await writeLocalSnapshot(snap);
  return snap;
}

export async function sendCelebration(
  code: string,
  style: 'reveal' | 'round' | 'finale'
): Promise<void> {
  const sb = getSupabaseClient();
  if (sb) {
    await broadcastSupabaseEvent(code, { type: 'confetti', style });
  } else {
    await emitLocalEvent(code, { type: 'confetti', style });
  }
}
