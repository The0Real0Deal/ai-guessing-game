import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, Send } from 'lucide-react';
import { AnimatedLeaderboard } from '../components/AnimatedLeaderboard';
import { GrandFinaleStage } from '../components/GrandFinaleStage';
import { useCountdown } from '../hooks/useCountdown';
import { useRoom } from '../hooks/useRoom';
import { fireRevealConfetti } from '../lib/confetti';
import { PLAYER_AVATARS } from '../lib/gameLogic';
import { getOrderedGuessQueue, joinRoom, submitPrompt } from '../lib/gameService';

const PLAYER_STORAGE_PREFIX = 'catgame_player_id_';

export function PlayerMobilePage() {
  const { code: urlCode } = useParams<{ code?: string }>();
  const navigate = useNavigate();

  const [codeInput, setCodeInput] = useState(urlCode || '');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState(() => PLAYER_AVATARS[Math.floor(Math.random() * PLAYER_AVATARS.length)]);
  const [activeCode, setActiveCode] = useState<string | undefined>(undefined);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  const [promptDraft, setPromptDraft] = useState('');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [hideSecretWord, setHideSecretWord] = useState(false);
  const [submittingPrompt, setSubmittingPrompt] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [personalToast, setPersonalToast] = useState<string | null>(null);

  const lastRoundSyncedRef = useRef<number>(0);
  const lastScoredSubRef = useRef<string | null>(null);

  // Auto-reconnect if player already joined this room earlier
  useEffect(() => {
    if (!urlCode || !/^\d{4}$/.test(urlCode)) return;
    setCodeInput(urlCode);
    const savedId = localStorage.getItem(`${PLAYER_STORAGE_PREFIX}${urlCode}`);
    if (!savedId) return;

    joinRoom(urlCode, '', avatar, savedId)
      .then(({ player }) => {
        setPlayerId(player.id);
        setActiveCode(urlCode);
      })
      .catch(() => {
        localStorage.removeItem(`${PLAYER_STORAGE_PREFIX}${urlCode}`);
      });
  }, [urlCode]);

  const { snapshot, setSnapshot, loading } = useRoom(activeCode);

  const me = snapshot?.players.find((p) => p.id === playerId) || null;
  const mySubmission =
    snapshot && me
      ? snapshot.submissions.find(
          (s) => s.playerId === me.id && s.roundNumber === snapshot.room.currentRound
        ) || null
      : null;

  // Reset draft cleanly when entering a new round
  useEffect(() => {
    if (!snapshot || !mySubmission) return;
    if (lastRoundSyncedRef.current !== snapshot.room.currentRound) {
      lastRoundSyncedRef.current = snapshot.room.currentRound;
      setPromptDraft(mySubmission.prompt || '');
      setIsEditingPrompt(!mySubmission.prompt);
      setHideSecretWord(false);
      setPromptError('');
    }
  }, [snapshot?.room.currentRound, mySubmission?.id]);

  // Celebrate on the player's own phone when they score!
  const queue = snapshot ? getOrderedGuessQueue(snapshot) : [];
  const currentGuess =
    snapshot?.room.phase === 'guessing' ? queue[snapshot.room.currentGuessIndex] || null : null;

  useEffect(() => {
    if (!currentGuess?.revealed || !me) return;
    if (lastScoredSubRef.current === currentGuess.id) return;
    if (currentGuess.guessedCorrectly && (currentGuess.guesserId === me.id || currentGuess.playerId === me.id)) {
      lastScoredSubRef.current = currentGuess.id;
      fireRevealConfetti();
      const msg =
        currentGuess.guesserId === me.id
          ? `🎯 בול פגיעה! קיבלת +${currentGuess.awardedGuesserPts} נק׳ על ניחוש מבריק!`
          : `🎨 ניחשו את התמונה שלך! קיבלת +${currentGuess.awardedCreatorPts} נק׳ יוצר!`;
      setPersonalToast(msg);
      const t = window.setTimeout(() => setPersonalToast(null), 5000);
      return () => window.clearTimeout(t);
    }
  }, [currentGuess?.id, currentGuess?.revealed, currentGuess?.guessedCorrectly, me?.id]);

  const { remaining, isUrgent } = useCountdown(
    snapshot?.room.timerEndsAt || null,
    snapshot?.room.timerPausedRemaining ?? null,
    snapshot?.room.settings.timerSeconds || 60
  );

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    const cleanCode = codeInput.trim();
    if (!/^\d{4}$/.test(cleanCode)) {
      setJoinError('קוד החדר חייב להיות בן 4 ספרות.');
      return;
    }
    if (!nickname.trim()) {
      setJoinError('בחרו לעצמכם כינוי מגניב!');
      return;
    }

    setJoining(true);
    try {
      const { player, snapshot: fresh } = await joinRoom(cleanCode, nickname, avatar);
      localStorage.setItem(`${PLAYER_STORAGE_PREFIX}${cleanCode}`, player.id);
      setPlayerId(player.id);
      setActiveCode(cleanCode);
      setSnapshot(fresh);
      if (urlCode !== cleanCode) {
        navigate(`/play/${cleanCode}`, { replace: true });
      }
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : 'שגיאה בהצטרפות לחדר');
    } finally {
      setJoining(false);
    }
  };

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCode || !me || !snapshot) return;
    setPromptError('');
    if (!promptDraft.trim()) {
      setPromptError('כתבו תיאור (פרומפט) לפני השליחה למארח!');
      return;
    }

    setSubmittingPrompt(true);
    try {
      const fresh = await submitPrompt(activeCode, me.id, snapshot.room.currentRound, promptDraft);
      setSnapshot(fresh);
      setIsEditingPrompt(false);
    } catch (err: unknown) {
      setPromptError(err instanceof Error ? err.message : 'שגיאה בשליחת הפרומפט');
    } finally {
      setSubmittingPrompt(false);
    }
  };

  // JOIN SCREEN (Not yet connected to a room)
  if (!activeCode || !playerId || (!loading && (!snapshot || !me))) {
    return (
      <div className="mobile-shell">
        <div className="stage-card mobile-card">
          <div className="card-header-row">
            <button type="button" className="btn-back" onClick={() => navigate('/')}>
              → חזרה
            </button>
            <span className="sticker-tag tag-yellow mini-tag">שחקן 📱</span>
          </div>

          <h1 className="mobile-title">הצטרפות למשחק!</h1>
          <p className="muted-text">
            בחרו דמות, זרקו כינוי מצחיק והצטרפו לטירוף.
          </p>

          <form className="stack-form" onSubmit={handleJoinSubmit}>
            <div className="field-group">
              <label htmlFor="player-code">קוד חדר (4 ספרות)</label>
              <input
                id="player-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                dir="ltr"
                className="input-code"
                placeholder="1234"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>

            <div className="field-group">
              <label>בחרו אווטאר</label>
              <div className="avatar-picker-grid">
                {PLAYER_AVATARS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className={`avatar-choice ${avatar === em ? 'selected' : ''}`}
                    onClick={() => setAvatar(em)}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="player-nickname">הכינוי שלך</label>
              <input
                id="player-nickname"
                type="text"
                maxLength={22}
                placeholder="לדוגמה: דניאל המצייר"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            </div>

            {joinError && <div className="error-banner">{joinError}</div>}

            <button
              id="btn-player-join-submit"
              type="submit"
              className="btn-brutal btn-coral btn-touch"
              disabled={joining}
            >
              {joining ? 'מצטרף לחדר...' : 'יאללה, כנס לחדר! 🚀'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading || !snapshot || !me) {
    return (
      <div className="mobile-shell">
        <div className="stage-card mobile-card center-content">
          <div className="spinner-brutal" />
          <p className="muted-text">מתחבר לחדר {activeCode}...</p>
        </div>
      </div>
    );
  }

  const { room, players } = snapshot;
  const connectedCount = players.filter((p) => p.connected).length;

  return (
    <div className="mobile-shell">
      {/* Compact Mobile Top Bar */}
      <header className="mobile-topbar">
        <div className="mobile-user-chip">
          <span>{me.avatar}</span>
          <strong>{me.nickname}</strong>
        </div>
        <div className="mobile-meta-right">
          {room.phase !== 'lobby' && room.totalRounds > 0 && (
            <span className="meta-sticker meta-coral mini-pill">
              סיבוב <span dir="ltr">{room.currentRound}/{room.totalRounds}</span>
            </span>
          )}
          <span className="meta-sticker mini-pill">
            ⭐ <strong>{me.score}</strong>
          </span>
        </div>
      </header>

      {personalToast && <div className="personal-toast pop-in">{personalToast}</div>}

      {/* PHASE: LOBBY */}
      {room.phase === 'lobby' && (
        <div className="stage-card mobile-card center-content">
          <div className="mobile-big-avatar">{me.avatar}</div>
          <div className="sticker-tag tag-yellow">את/ה בפנים! 🎉</div>
          <h2>שלום {me.nickname}!</h2>
          <p className="muted-text">
            רואים את עצמך על המסך הראשי? יש כרגע <strong>{connectedCount}</strong> שחקנים בחדר.
            ממתינים שהמארח ילחץ על ״התחל משחק״!
          </p>
          <div className="waiting-chip">
            <span className="pulse-dot" />
            <span>הכינו את הדמיון... תכף מתחילים!</span>
          </div>
        </div>
      )}

      {/* PHASE: PROMPTING */}
      {room.phase === 'prompting' && (
        <div className="stage-card mobile-card">
          {mySubmission ? (
            <>
              <div className="mobile-cat-row">
                <span className="meta-sticker meta-blue mini-pill">
                  🏷️ קטגוריה: <strong>{mySubmission.category}</strong>
                </span>
              </div>

              <div className="secret-word-box">
                <div className="secret-top-row">
                  <span className="secret-label">המילה הסודית שלך לסיבוב זה:</span>
                  <button
                    type="button"
                    className="btn-privacy-toggle"
                    onClick={() => setHideSecretWord((v) => !v)}
                  >
                    {hideSecretWord ? <Eye size={16} /> : <EyeOff size={16} />}
                    {hideSecretWord ? 'הצג' : 'הסתר'}
                  </button>
                </div>

                <div className={`secret-word ${hideSecretWord ? 'is-hidden-word' : ''}`}>
                  {hideSecretWord ? '🤫 מוסתר מעיניים סקרניות' : mySubmission.secretWord}
                </div>
                <span className="secret-tip">
                  כתבו תיאור יצירתי ל-Gemini — בלי לכתוב את המילה הסודית עצמה!
                </span>
              </div>

              {/* Already has image from host */}
              {mySubmission.imageData ? (
                <div className="player-status-box ready">
                  <div className="status-emoji">🎨✅</div>
                  <h3>התמונה שלך מוכנה!</h3>
                  <p>
                    המארח כבר יצר את יצירת המופת שלך ב-Gemini! ממתינים לשאר השחקנים לפני שמתחילים לנחש.
                  </p>
                  <div className="sent-prompt-recap">
                    <span>הפרומפט ששלחת:</span>
                    <blockquote>״{mySubmission.prompt}״</blockquote>
                  </div>
                </div>
              ) : mySubmission.prompt && !isEditingPrompt ? (
                <div className="player-status-box submitted">
                  <div className="status-emoji">📨✨</div>
                  <h3>הפרומפט נשלח למארח!</h3>
                  <p>
                    המארח רואה עכשיו את התיאור שלך ומייצר את התמונה ב-Gemini. אפשר להירגע — או לערוך כל עוד התמונה לא הוכנה.
                  </p>
                  <div className="sent-prompt-recap">
                    <span>הפרומפט שלך:</span>
                    <blockquote>״{mySubmission.prompt}״</blockquote>
                  </div>
                  <button
                    type="button"
                    className="btn-brutal btn-white btn-touch"
                    onClick={() => setIsEditingPrompt(true)}
                  >
                    ✏️ ערוך ושלח מחדש
                  </button>
                </div>
              ) : (
                <form className="stack-form" onSubmit={handlePromptSubmit}>
                  <div className="field-group">
                    <label htmlFor="player-prompt-input">הפרומפט שלך ליצירת התמונה</label>
                    <textarea
                      id="player-prompt-input"
                      rows={4}
                      placeholder="לדוגמה: איור צבעוני בסגנון פיקסאר של יצור שעיר עם משקפי שמש ענקיים יושב בחוף הים עם שייק אננס..."
                      value={promptDraft}
                      onChange={(e) => setPromptDraft(e.target.value)}
                      required
                    />
                    <span className="field-hint">
                      טיפ: תארו סגנון (אנימציה / צילום ריאליסטי / ציור שמן), צבעים וסיטואציה מצחיקה!
                    </span>
                  </div>

                  {promptError && <div className="error-banner">{promptError}</div>}

                  <button
                    id="btn-submit-prompt"
                    type="submit"
                    className="btn-brutal btn-coral btn-touch"
                    disabled={submittingPrompt}
                  >
                    <Send size={18} />
                    <span>{submittingPrompt ? 'שולח למארח...' : 'שלח פרומפט למארח!'}</span>
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="center-content">
              <p className="muted-text">ממתינים להקצאת מילה מהמארח...</p>
            </div>
          )}
        </div>
      )}

      {/* PHASE: GUESSING */}
      {room.phase === 'guessing' && (
        <div className="stage-card mobile-card center-content">
          <div className="status-illustration" aria-hidden="true">👀</div>
          <div className="sticker-tag tag-yellow">זמן ניחושים!</div>
          <h2>הרימו עיניים למסך הראשי!</h2>
          <p className="muted-text">
            צעקו את הניחושים שלכם בקול רם! המנחש והיוצר מקבלים שניהם נקודות.
          </p>

          {currentGuess && (
            <div className="mobile-live-strip">
              <span className="meta-sticker meta-blue mini-pill">🏷️ {currentGuess.category}</span>
              <span className={`meta-sticker mini-pill ${isUrgent ? 'meta-coral' : ''}`}>
                ⏱️ <strong dir="ltr">{remaining}</strong> שנ׳
              </span>
            </div>
          )}

          <div className="mobile-score-grid">
            <div className="mobile-score-box">
              <span>🔍 מנחש</span>
              <strong>{me.guesserScore}</strong>
            </div>
            <div className="mobile-score-box">
              <span>🎨 יוצר</span>
              <strong>{me.creatorScore}</strong>
            </div>
            <div className="mobile-score-box is-total">
              <span>⭐ סה״כ</span>
              <strong>{me.score}</strong>
            </div>
          </div>
        </div>
      )}

      {/* PHASE: ROUND LEADERBOARD */}
      {room.phase === 'round_leaderboard' && (
        <div className="stage-card mobile-card">
          <div className="center-content" style={{ marginBottom: 16 }}>
            <div className="sticker-tag tag-yellow">סיכום סיבוב {room.currentRound} 📊</div>
            {room.roundCommentary && <p className="muted-text">{room.roundCommentary}</p>}
          </div>
          <AnimatedLeaderboard players={players} compact highlightPlayerId={me.id} />
        </div>
      )}

      {/* PHASE: GRAND FINALE */}
      {room.phase === 'finale' && (
        <div className="stage-card mobile-card">
          <GrandFinaleStage players={players} history={room.history} compact highlightPlayerId={me.id} />
        </div>
      )}
    </div>
  );
}
