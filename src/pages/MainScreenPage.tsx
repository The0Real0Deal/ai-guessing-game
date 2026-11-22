import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pause, UserPlus } from 'lucide-react';
import { AnimatedLeaderboard } from '../components/AnimatedLeaderboard';
import { GrandFinaleStage } from '../components/GrandFinaleStage';
import { QRCodeCard } from '../components/QRCodeCard';
import { useCountdown } from '../hooks/useCountdown';
import { useRoom } from '../hooks/useRoom';
import {
  fireGrandFinaleConfetti,
  fireRevealConfetti,
  fireRoundLeaderboardConfetti,
} from '../lib/confetti';
import {
  calculateRoundPlan,
  getSubmissionProgress,
  WITTY_HIT_BADGES,
  WITTY_MISS_LINES,
  WITTY_PROMPTING_LINES,
} from '../lib/gameLogic';
import { getOrderedGuessQueue } from '../lib/gameService';
import type { BroadcastEvent } from '../lib/types';

interface LobbyJoinFeedItem {
  id: string;
  nickname: string;
  avatar: string;
  joinedAt: number;
}

export function MainScreenPage() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [wittyIndex, setWittyIndex] = useState(0);
  const [revealStage, setRevealStage] = useState<0 | 1 | 2>(0);
  const [joinFeed, setJoinFeed] = useState<LobbyJoinFeedItem[]>([]);

  const lastRevealedIdRef = useRef<string | null>(null);
  const seenPlayerIdsRef = useRef<Set<string>>(new Set());
  const initializedLobbyRef = useRef(false);

  const handleBroadcastEvent = useCallback((evt: BroadcastEvent) => {
    if (evt.type === 'confetti') {
      if (evt.style === 'reveal') fireRevealConfetti();
      else if (evt.style === 'round') fireRoundLeaderboardConfetti();
      else if (evt.style === 'finale') fireGrandFinaleConfetti();
    }
  }, []);

  const { snapshot, loading, error } = useRoom(code, handleBroadcastEvent);

  // Track real-time lobby joins for the animated Live Lobby Join Feed
  useEffect(() => {
    if (!snapshot) return;
    const connected = snapshot.players.filter((p) => p.connected);

    if (!initializedLobbyRef.current) {
      connected.forEach((p) => seenPlayerIdsRef.current.add(p.id));
      initializedLobbyRef.current = true;
      return;
    }

    const newlyJoined = connected.filter((p) => !seenPlayerIdsRef.current.has(p.id));
    if (newlyJoined.length > 0) {
      newlyJoined.forEach((p) => seenPlayerIdsRef.current.add(p.id));
      const now = Date.now();
      setJoinFeed((prev) => [
        ...newlyJoined.map((p) => ({
          id: `${p.id}_${now}`,
          nickname: p.nickname,
          avatar: p.avatar,
          joinedAt: now,
        })),
        ...prev,
      ].slice(0, 4));
    }
  }, [snapshot?.players]);

  // Rotate witty Hebrew waiting lines during prompting phase
  useEffect(() => {
    if (snapshot?.room.phase !== 'prompting') return;
    const id = window.setInterval(() => {
      setWittyIndex((i) => (i + 1) % WITTY_PROMPTING_LINES.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [snapshot?.room.phase]);

  const queue = snapshot ? getOrderedGuessQueue(snapshot) : [];
  const currentGuess =
    snapshot?.room.phase === 'guessing' ? queue[snapshot.room.currentGuessIndex] || null : null;

  // Staged Reveal choreography: Stage 1 (concept + credits) immediately -> Stage 2 (exact prompt) after 1.7s
  useEffect(() => {
    if (!currentGuess?.revealed) {
      setRevealStage(0);
      return;
    }

    setRevealStage(1);
    if (currentGuess.guessedCorrectly && lastRevealedIdRef.current !== currentGuess.id) {
      lastRevealedIdRef.current = currentGuess.id;
      fireRevealConfetti();
    }

    const promptRevealTimer = window.setTimeout(() => {
      setRevealStage(2);
    }, 1700);

    return () => window.clearTimeout(promptRevealTimer);
  }, [currentGuess?.id, currentGuess?.revealed, currentGuess?.guessedCorrectly]);

  const { remaining, isRunning, isUrgent, progressPct } = useCountdown(
    snapshot?.room.timerEndsAt || null,
    snapshot?.room.timerPausedRemaining ?? null,
    snapshot?.room.settings.timerSeconds || 60
  );

  const isTimerPaused =
    Boolean(snapshot?.room.phase === 'guessing') &&
    !isRunning &&
    snapshot?.room.timerPausedRemaining !== null &&
    remaining > 0 &&
    !currentGuess?.revealed;

  // If no code in URL yet -> show clean attach screen
  if (!code) {
    const handleAttach = (e: React.FormEvent) => {
      e.preventDefault();
      const cleaned = joinCodeInput.trim();
      if (/^\d{4}$/.test(cleaned)) {
        navigate(`/screen/${cleaned}`);
      }
    };

    return (
      <div className="center-stage-wrap">
        <div className="stage-card attach-card">
          <button type="button" className="btn-back" onClick={() => navigate('/')}>
            → חזרה לדף הבית
          </button>
          <div className="sticker-tag tag-yellow">מסך ראשי להקרנה 📺</div>
          <h2>חיבור לחדר קיים</h2>
          <p className="muted-text">
            הזינו את קוד החדר בן 4 הספרות שהופיע בלוח הבקרה של המארח כדי להקרין את המשחק על המסך הגדול.
          </p>
          <form className="stack-form" onSubmit={handleAttach}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]{4}"
              dir="ltr"
              className="input-code"
              placeholder="1234"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              required
            />
            <button type="submit" className="btn-brutal btn-coral btn-lg">
              התחבר למסך הראשי 🚀
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="center-stage-wrap">
        <div className="stage-card loading-card">
          <div className="spinner-brutal" />
          <h2>מתחבר לחדר {code}...</h2>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="center-stage-wrap">
        <div className="stage-card attach-card">
          <h2>אופס! החדר לא נמצא 😅</h2>
          <p className="muted-text">{error || 'בדקו את קוד החדר או צרו חדר חדש מלוח המארח.'}</p>
          <div className="action-row-center">
            <button type="button" className="btn-brutal btn-coral" onClick={() => navigate('/screen')}>
              נסה קוד אחר
            </button>
            <button type="button" className="btn-brutal btn-white" onClick={() => navigate('/')}>
              דף הבית
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { room, players, submissions } = snapshot;
  const connectedPlayers = players.filter((p) => p.connected);
  const joinUrl = `${window.location.origin}/play/${room.code}`;
  const shortJoinUrl = `${window.location.host}/play/${room.code}`;
  const roundPlan = calculateRoundPlan(room.settings.categories, connectedPlayers.length);
  const roundSubs = submissions.filter((s) => s.roundNumber === room.currentRound);
  const progress = getSubmissionProgress(submissions, room.currentRound);

  const creator = currentGuess ? players.find((p) => p.id === currentGuess.playerId) : null;
  const guesser =
    currentGuess?.guesserId ? players.find((p) => p.id === currentGuess.guesserId) : null;
  const hitBadge =
    WITTY_HIT_BADGES[(room.currentGuessIndex + room.currentRound) % WITTY_HIT_BADGES.length];
  const missLine =
    WITTY_MISS_LINES[(room.currentGuessIndex + room.currentRound) % WITTY_MISS_LINES.length];

  return (
    <div className="tv-shell">
      {/* Persistent Game-Show Header */}
      <header className="tv-topbar">
        <div className="tv-brand">
          <span className="brand-sticker">🎨</span>
          <span>צייר לי חתול!</span>
        </div>

        <div className="tv-meta-pills">
          {room.currentCategory && room.phase !== 'lobby' && room.phase !== 'finale' && (
            <span className="meta-sticker meta-blue">
              קטגוריה: <strong>{room.currentCategory}</strong>
            </span>
          )}
          {room.phase !== 'lobby' && room.totalRounds > 0 && (
            <span className="meta-sticker meta-coral">
              סיבוב <strong dir="ltr">{room.currentRound}/{room.totalRounds}</strong>
            </span>
          )}
          <span className="meta-sticker">
            חדר <strong dir="ltr">{room.code}</strong>
          </span>
        </div>
      </header>

      <main className="tv-stage">
        {/* PHASE 1: LOBBY WITH PROMINENT QR + SHORT URL + LIVE JOIN FEED */}
        {room.phase === 'lobby' && (
          <div className="tv-lobby-layout">
            <div className="stage-card tv-lobby-hero">
              <div className="tv-lobby-info">
                <div className="sticker-tag tag-yellow">הצטרפו עכשיו מהטלפון!</div>
                <h1 className="tv-join-heading">סרקו את ה-QR או היכנסו לכתובת המקוצרת</h1>

                <div className="tv-code-row">
                  <span className="tv-code-label">קוד חדר:</span>
                  <span className="room-code-digits" dir="ltr">{room.code}</span>
                </div>

                <div className="tv-short-url-box">
                  <span className="short-url-label">כתובת מהירה:</span>
                  <span className="tv-short-url-value" dir="ltr">{shortJoinUrl}</span>
                </div>

                <div className="tv-stats-strip">
                  <div className="stat-chip">
                    <span className="stat-num">{roundPlan.categoryCount}</span>
                    <span className="stat-lbl">קטגוריות</span>
                  </div>
                  <div className="stat-chip">
                    <span className="stat-num">{roundPlan.totalWords}</span>
                    <span className="stat-lbl">מילים בקופה</span>
                  </div>
                  <div className="stat-chip stat-highlight">
                    <span className="stat-num">
                      {connectedPlayers.length > 0 ? roundPlan.totalRounds : '—'}
                    </span>
                    <span className="stat-lbl">סיבובים במשחק</span>
                  </div>
                </div>
              </div>

              <QRCodeCard url={joinUrl} size={260} caption="סרקו עם המצלמה והיכנסו מיד!" />
            </div>

            {/* Live Lobby Join Feed Ticker */}
            {joinFeed.length > 0 && (
              <div className="live-join-feed" aria-live="polite">
                {joinFeed.map((item) => (
                  <div key={item.id} className="join-feed-pill pop-in">
                    <UserPlus size={15} strokeWidth={2.6} />
                    <span>
                      {item.avatar} <strong>{item.nickname}</strong> הצטרף/ה לחדר!
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="stage-card tv-players-panel">
              <div className="panel-title-row">
                <h2>שחקנים בלובי ({connectedPlayers.length})</h2>
                <span className="waiting-inline">
                  <span className="pulse-dot" />
                  ממתינים שהמארח יזניק את המשחק...
                </span>
              </div>

              {connectedPlayers.length === 0 ? (
                <div className="empty-lobby-box">
                  <span className="empty-emoji" aria-hidden="true">👀</span>
                  <p>הבמה מוכנה! סרקו את ה-QR או הקלידו {shortJoinUrl} כדי להצטרף</p>
                </div>
              ) : (
                <div className="tv-players-grid">
                  {connectedPlayers.map((p, idx) => (
                    <div
                      key={p.id}
                      className="tv-player-card pop-in"
                      style={{ animationDelay: `${Math.min(idx, 10) * 55}ms` }}
                    >
                      <span className="tv-player-avatar">{p.avatar}</span>
                      <span className="tv-player-name">{p.nickname}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PHASE 2: PROMPTING & HOST IMAGE GENERATION */}
        {room.phase === 'prompting' && (
          <div className="tv-prompting-layout">
            <div className="marquee-banner">
              <div className="sticker-tag tag-yellow">
                סיבוב {room.currentRound} מתוך {room.totalRounds} • קטגוריה: {room.currentCategory}
              </div>
              <h1 className="stage-heading">מבשלים פרומפטים בטלפונים! ✍️🎨</h1>
              <p className="witty-rotating">{WITTY_PROMPTING_LINES[wittyIndex]}</p>

              <div className="tv-progress-wrap">
                <div className="tv-progress-bar">
                  <div
                    className="tv-progress-fill"
                    style={{
                      width: `${progress.total > 0 ? Math.round((progress.imagesDone / progress.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="tv-progress-label">
                  {progress.imagesDone} מתוך {progress.total} תמונות מוכנות להצגה
                </span>
              </div>
            </div>

            <div className="tv-status-grid">
              {connectedPlayers.map((p) => {
                const sub = roundSubs.find((s) => s.playerId === p.id);
                const hasImage = Boolean(sub?.imageData);
                const hasPrompt = Boolean(sub?.prompt?.trim());

                let stateClass = 'state-thinking';
                let stateLabel = 'חושב על פרומפט... 💭';
                if (hasImage) {
                  stateClass = 'state-ready';
                  stateLabel = 'התמונה מוכנה! 🎨';
                } else if (hasPrompt) {
                  stateClass = 'state-forging';
                  stateLabel = 'פרומפט נשלח! המארח מצייר... ⚡';
                }

                return (
                  <div key={p.id} className={`tv-status-card ${stateClass}`}>
                    <div className="tv-status-avatar">{p.avatar}</div>
                    <div className="tv-status-name">{p.nickname}</div>
                    <div className={`status-pill ${stateClass}`}>{stateLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PHASE 3: GUESSING STAGE WITH STAGED REVEAL & PAUSE INDICATOR */}
        {room.phase === 'guessing' && currentGuess && (
          <div className="tv-guessing-layout">
            <div className="tv-guessing-top">
              <div className="counter-sticker">
                תמונה <strong>{room.currentGuessIndex + 1}</strong> מתוך <strong>{queue.length}</strong>
              </div>

              <div className="category-hero-pill">🏷️ {currentGuess.category}</div>

              <div
                className={`timer-pill-lg ${isUrgent ? 'urgent' : ''} ${
                  isTimerPaused ? 'is-paused' : ''
                }`}
              >
                {isTimerPaused ? <Pause size={22} strokeWidth={2.8} /> : <span>⏱️</span>}
                <strong dir="ltr">{remaining}</strong>
                <span>{isTimerPaused ? 'מושהה' : 'שנ׳'}</span>
              </div>
            </div>

            <div className="timer-rail">
              <div
                className={`timer-rail-fill ${isUrgent ? 'urgent' : ''} ${
                  isTimerPaused ? 'is-paused' : ''
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="tv-canvas-stage">
              <img
                key={currentGuess.id}
                src={currentGuess.imageData || ''}
                alt="יצירת AI לניחוש"
                className="tv-guess-image zoom-in"
              />

              {/* Staged Reveal Overlay: Stage 1 = Concept & Credits -> Stage 2 = Exact Prompt */}
              {currentGuess.revealed && revealStage >= 1 && (
                <div
                  className={`tv-reveal-overlay ${
                    currentGuess.guessedCorrectly ? 'is-hit' : 'is-miss'
                  }`}
                >
                  <div className="reveal-pill">
                    {currentGuess.guessedCorrectly ? hitBadge : '⏱️ חשיפת המושג!'}
                  </div>

                  <div className="reveal-stage-label">המושג הסודי היה:</div>
                  <div className="reveal-secret-word pop-in">{currentGuess.secretWord}</div>

                  {!currentGuess.guessedCorrectly && (
                    <p className="reveal-miss-roast">{missLine}</p>
                  )}

                  <div className="reveal-credits-row pop-in">
                    {creator && (
                      <div className="credit-card credit-creator">
                        <span className="credit-role">יוצר/ת</span>
                        <span className="credit-person">
                          {creator.avatar} {creator.nickname}
                        </span>
                        {currentGuess.awardedCreatorPts > 0 && (
                          <span className="credit-pts" dir="ltr">
                            +{currentGuess.awardedCreatorPts} נק׳
                          </span>
                        )}
                      </div>
                    )}

                    {guesser && (
                      <div className="credit-card credit-guesser">
                        <span className="credit-role">מנחש/ת</span>
                        <span className="credit-person">
                          {guesser.avatar} {guesser.nickname}
                        </span>
                        {currentGuess.awardedGuesserPts > 0 && (
                          <span className="credit-pts" dir="ltr">
                            +{currentGuess.awardedGuesserPts} נק׳
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stage 2: Exact Player Prompt Reveal */}
                  {currentGuess.prompt && (
                    revealStage >= 2 ? (
                      <div className="reveal-prompt-bubble staged-prompt-in">
                        <span className="prompt-label">הפרומפט המדויק שהשחקן כתב:</span>
                        <span className="prompt-quote">״{currentGuess.prompt}״</span>
                      </div>
                    ) : (
                      <div className="reveal-prompt-pending">
                        <span className="pulse-dot" />
                        <span>חושפים את הפרומפט המקורי...</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            {!currentGuess.revealed && (
              <div className={`tv-guess-cta ${isTimerPaused ? 'is-paused' : ''}`}>
                <span>
                  {isTimerPaused
                    ? '⏸️ הטיימר מושהה כרגע — קחו נשימה והמשיכו תכף!'
                    : '🗣️ צעקו את הניחוש שלכם בקול רם! מי הראשון שיעלה על המושג?'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* PHASE 4: END-OF-ROUND ANIMATED LEADERBOARD WITH TREND INDICATORS */}
        {room.phase === 'round_leaderboard' && (
          <div className="tv-leaderboard-wrap">
            <AnimatedLeaderboard
              players={players}
              commentary={room.roundCommentary}
              roundNumber={room.currentRound}
              totalRounds={room.totalRounds}
            />
          </div>
        )}

        {/* PHASE 5: GRAND FINALE (ZERO EMOJIS, VECTOR/TYPOGRAPHIC + HIGHLIGHTS) */}
        {room.phase === 'finale' && (
          <GrandFinaleStage players={players} history={room.history} />
        )}
      </main>
    </div>
  );
}
