import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff, Lock, Pencil, Send } from 'lucide-react';
import { AnimatedLeaderboard } from '../components/AnimatedLeaderboard';
import { GrandFinaleStage } from '../components/GrandFinaleStage';
import { useCountdown } from '../hooks/useCountdown';
import { useRoom } from '../hooks/useRoom';
import { fireRevealConfetti } from '../lib/confetti';
import { findForbiddenWords, PLAYER_AVATARS } from '../lib/gameLogic';
import { getOrderedGuessQueue, joinRoom, submitPrompt } from '../lib/gameService';

const PLAYER_STORAGE_PREFIX = 'catgame_player_id_';
const LAST_SESSION_KEY = 'catgame_last_player_session';
const DRAFT_STORAGE_PREFIX = 'catgame_prompt_draft_';

interface SavedPlayerSession {
  roomCode: string;
  playerId: string;
  nickname: string;
  avatar: string;
}

function savePlayerSession(session: SavedPlayerSession) {
  try {
    localStorage.setItem(`${PLAYER_STORAGE_PREFIX}${session.roomCode}`, session.playerId);
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore storage errors
  }
}

function readLastPlayerSession(): SavedPlayerSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedPlayerSession) : null;
  } catch {
    return null;
  }
}

export function PlayerMobilePage() {
  const { code: urlCode } = useParams<{ code?: string }>();
  const navigate = useNavigate();

  const [codeInput, setCodeInput] = useState(urlCode || '');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState(
    () => PLAYER_AVATARS[Math.floor(Math.random() * PLAYER_AVATARS.length)]
  );
  const [activeCode, setActiveCode] = useState<string | undefined>(undefined);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);

  const [promptDraft, setPromptDraft] = useState('');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [hideSecretWord, setHideSecretWord] = useState(false);
  const [submittingPrompt, setSubmittingPrompt] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [personalToast, setPersonalToast] = useState<string | null>(null);

  const lastSyncedSubIdRef = useRef<string | null>(null);
  const lastScoredSubRef = useRef<string | null>(null);

  // Automatic page refresh / reconnect recovery for both /play/:code and /play
  useEffect(() => {
    const lastSession = readLastPlayerSession();
    const targetCode =
      urlCode && /^\d{4}$/.test(urlCode) ? urlCode : lastSession?.roomCode;

    if (!targetCode) return;
    setCodeInput(targetCode);

    const savedId =
      localStorage.getItem(`${PLAYER_STORAGE_PREFIX}${targetCode}`) ||
      (lastSession?.roomCode === targetCode ? lastSession.playerId : null);

    if (!savedId) return;

    setRestoringSession(true);
    joinRoom(
      targetCode,
      lastSession?.nickname || '',
      lastSession?.avatar || avatar,
      savedId
    )
      .then(({ player }) => {
        savePlayerSession({
          roomCode: targetCode,
          playerId: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
        });
        setPlayerId(player.id);
        setNickname(player.nickname);
        setAvatar(player.avatar);
        setActiveCode(targetCode);
        if (urlCode !== targetCode) {
          navigate(`/play/${targetCode}`, { replace: true });
        }
      })
      .catch(() => {
        localStorage.removeItem(`${PLAYER_STORAGE_PREFIX}${targetCode}`);
        if (lastSession?.roomCode === targetCode) {
          localStorage.removeItem(LAST_SESSION_KEY);
        }
      })
      .finally(() => {
        setRestoringSession(false);
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

  const isPromptLocked = Boolean(mySubmission?.copiedAt || mySubmission?.imageData);

  // Force exit edit mode immediately if Host locks the prompt by copying or pasting an image
  useEffect(() => {
    if (isPromptLocked && isEditingPrompt) {
      setIsEditingPrompt(false);
    }
  }, [isPromptLocked, isEditingPrompt]);

  // Restore or reset draft cleanly when entering a round or starting a new game in the same room
  useEffect(() => {
    if (snapshot?.room.phase === 'lobby') {
      lastSyncedSubIdRef.current = null;
      lastScoredSubRef.current = null;
      setPromptDraft('');
      setIsEditingPrompt(false);
      return;
    }
    if (!snapshot || !mySubmission || !activeCode) return;
    if (lastSyncedSubIdRef.current !== mySubmission.id) {
      lastSyncedSubIdRef.current = mySubmission.id;
      const draftKey = `${DRAFT_STORAGE_PREFIX}${activeCode}_${mySubmission.id}`;
      const savedDraft = localStorage.getItem(draftKey);
      const initialPrompt = mySubmission.prompt || savedDraft || '';
      setPromptDraft(initialPrompt);
      setIsEditingPrompt(!mySubmission.prompt && !isPromptLocked);
      setHideSecretWord(false);
      setPromptError('');
    }
  }, [snapshot?.room.phase, mySubmission?.id, activeCode, isPromptLocked]);

  // Persist unsent draft text across accidental mobile reloads (scoped per submission ID)
  useEffect(() => {
    if (!activeCode || !snapshot || snapshot.room.phase !== 'prompting' || !mySubmission) return;
    const draftKey = `${DRAFT_STORAGE_PREFIX}${activeCode}_${mySubmission.id}`;
    try {
      if (promptDraft) {
        localStorage.setItem(draftKey, promptDraft);
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      // ignore
    }
  }, [promptDraft, activeCode, snapshot?.room.phase, mySubmission?.id]);

  // Immediate live forbidden-word detection
  const forbiddenMatches = useMemo(() => {
    if (!mySubmission?.secretWord || !promptDraft) return [];
    return findForbiddenWords(mySubmission.secretWord, promptDraft);
  }, [mySubmission?.secretWord, promptDraft]);

  const uniqueForbiddenWords = useMemo(
    () => Array.from(new Set(forbiddenMatches.map((m) => m.word))),
    [forbiddenMatches]
  );

  const hasForbiddenWords = forbiddenMatches.length > 0;

  // Build highlighted segments for visual forbidden-word feedback
  const highlightedSegments = useMemo(() => {
    if (!hasForbiddenWords) return [];
    const segments: { text: string; forbidden: boolean }[] = [];
    let cursor = 0;
    for (const match of forbiddenMatches) {
      if (match.start > cursor) {
        segments.push({ text: promptDraft.slice(cursor, match.start), forbidden: false });
      }
      segments.push({ text: promptDraft.slice(match.start, match.end), forbidden: true });
      cursor = match.end;
    }
    if (cursor < promptDraft.length) {
      segments.push({ text: promptDraft.slice(cursor), forbidden: false });
    }
    return segments;
  }, [promptDraft, forbiddenMatches, hasForbiddenWords]);

  // Celebrate on the player's own phone when they score!
  const queue = snapshot ? getOrderedGuessQueue(snapshot) : [];
  const currentGuess =
    snapshot?.room.phase === 'guessing' ? queue[snapshot.room.currentGuessIndex] || null : null;

  useEffect(() => {
    if (!currentGuess?.revealed || !me) return;
    if (lastScoredSubRef.current === currentGuess.id) return;
    if (
      currentGuess.guessedCorrectly &&
      (currentGuess.guesserId === me.id || currentGuess.playerId === me.id)
    ) {
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
      savePlayerSession({
        roomCode: cleanCode,
        playerId: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
      });
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
    if (hasForbiddenWords) {
      setPromptError(
        `אסור להשתמש במילים מהמושג הסודי: ${uniqueForbiddenWords.join(', ')}`
      );
      return;
    }
    if (isPromptLocked) {
      setPromptError('הפרומפט כבר ננעל כי המארח התחיל להכין את התמונה שלך!');
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

  if (restoringSession) {
    return (
      <div className="mobile-shell">
        <div className="stage-card mobile-card center-content">
          <div className="spinner-brutal" />
          <p className="muted-text">משחזר את החיבור שלך למשחק...</p>
        </div>
      </div>
    );
  }

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
          <p className="muted-text">בחרו דמות, זרקו כינוי מצחיק והצטרפו לטירוף.</p>

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
                  קטגוריה: <strong>{mySubmission.category}</strong>
                </span>
              </div>

              <div className="secret-word-box">
                <div className="secret-top-row">
                  <span className="secret-label">המושג הסודי שלך לסיבוב זה:</span>
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
                  {hideSecretWord ? 'מוסתר מעיניים סקרניות' : mySubmission.secretWord}
                </div>
                <span className="secret-tip">
                  כתבו תיאור יצירתי ל-Gemini — אסור לכלול מילים מתוך המושג הסודי!
                </span>
              </div>

              {/* State 1: Image already pasted by host */}
              {mySubmission.imageData ? (
                <div className="player-status-box ready">
                  <div className="status-emoji">🎨✅</div>
                  <h3>התמונה שלך מוכנה!</h3>
                  <p>
                    המארח כבר הדביק את יצירת המופת שלך! ממתינים לשאר השחקנים לפני שמתחילים לנחש.
                  </p>
                  <div className="sent-prompt-recap">
                    <span>הפרומפט ששלחת:</span>
                    <blockquote>״{mySubmission.prompt}״</blockquote>
                  </div>
                </div>
              ) : mySubmission.prompt && !isEditingPrompt ? (
                /* State 2: Prompt submitted — editable until Host copies (locks) it */
                <div className="player-status-box submitted">
                  <div className="status-emoji">{mySubmission.copiedAt ? '🔒⚡' : '📨✨'}</div>
                  <h3>
                    {mySubmission.copiedAt
                      ? 'המארח כבר עובד על התמונה שלך!'
                      : 'הפרומפט נשלח למארח!'}
                  </h3>
                  <p>
                    {mySubmission.copiedAt
                      ? 'הפרומפט ננעל לעריכה כי המארח כבר העתיק אותו ל-Gemini.'
                      : 'כל עוד המארח לא התחיל לעבד את הפרומפט, אפשר עדיין לשפר אותו.'}
                  </p>

                  <div className="sent-prompt-recap">
                    <span>הפרומפט שלך:</span>
                    <blockquote>״{mySubmission.prompt}״</blockquote>
                  </div>

                  {mySubmission.copiedAt ? (
                    <div className="prompt-locked-pill">
                      <Lock size={15} />
                      <span>נעול לעריכה — בתהליך יצירה אצל המארח</span>
                    </div>
                  ) : (
                    <button
                      id="btn-edit-prompt"
                      type="button"
                      className="btn-brutal btn-white btn-touch"
                      onClick={() => {
                        setPromptDraft(mySubmission.prompt);
                        setIsEditingPrompt(true);
                      }}
                    >
                      <Pencil size={17} />
                      <span>ערוך פרומפט</span>
                    </button>
                  )}
                </div>
              ) : (
                /* State 3: Writing / Editing Prompt with Live Forbidden-Word Feedback */
                <form className="stack-form" onSubmit={handlePromptSubmit}>
                  <div className="field-group">
                    <label htmlFor="player-prompt-input">הפרומפט שלך ליצירת התמונה</label>
                    <textarea
                      id="player-prompt-input"
                      rows={4}
                      className={hasForbiddenWords ? 'textarea-forbidden' : ''}
                      placeholder="לדוגמה: איור צבעוני של יצור שעיר עם משקפי שמש ענקיים יושב בחוף הים עם שייק אננס..."
                      value={promptDraft}
                      onChange={(e) => {
                        setPromptDraft(e.target.value);
                        setPromptError('');
                      }}
                      required
                    />
                    <span className="field-hint">
                      טיפ: תארו סגנון, צבעים וסיטואציה מצחיקה בלי לכתוב מילים מהמושג הסודי!
                    </span>
                  </div>

                  {/* Immediate Visual Forbidden-Word Highlighting + Warning */}
                  {hasForbiddenWords && (
                    <div className="forbidden-alert-box pop-in" role="alert">
                      <div className="forbidden-alert-head">
                        <AlertTriangle size={18} strokeWidth={2.6} />
                        <strong>אופס! מילה אסורה מהמושג הסודי:</strong>
                      </div>
                      <p className="forbidden-alert-desc">
                        הסירו את {uniqueForbiddenWords.length === 1 ? 'המילה' : 'המילים'}:{' '}
                        {uniqueForbiddenWords.map((w, idx) => (
                          <span key={idx} className="forbidden-chip">
                            {w}
                          </span>
                        ))}
                      </p>
                      <div className="forbidden-highlight-preview">
                        {highlightedSegments.map((seg, idx) =>
                          seg.forbidden ? (
                            <mark key={idx} className="forbidden-mark">
                              {seg.text}
                            </mark>
                          ) : (
                            <span key={idx}>{seg.text}</span>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {promptError && <div className="error-banner">{promptError}</div>}

                  <button
                    id="btn-submit-prompt"
                    type="submit"
                    className="btn-brutal btn-coral btn-touch"
                    disabled={submittingPrompt || hasForbiddenWords || !promptDraft.trim()}
                  >
                    <Send size={18} />
                    <span>
                      {submittingPrompt
                        ? 'שולח למארח...'
                        : hasForbiddenWords
                        ? 'הסירו מילים אסורות כדי לשלוח'
                        : mySubmission.prompt
                        ? 'שמור ושלח פרומפט מעודכן'
                        : 'שלח פרומפט למארח!'}
                    </span>
                  </button>

                  {mySubmission.prompt && (
                    <button
                      type="button"
                      className="btn-brutal btn-white btn-sm"
                      onClick={() => {
                        setPromptDraft(mySubmission.prompt);
                        setIsEditingPrompt(false);
                      }}
                    >
                      ביטול עריכה
                    </button>
                  )}
                </form>
              )}
            </>
          ) : (
            <div className="center-content">
              <p className="muted-text">ממתינים להקצאת מושג מהמארח...</p>
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
              <span className="meta-sticker meta-blue mini-pill">{currentGuess.category}</span>
              <span className={`meta-sticker mini-pill ${isUrgent ? 'meta-coral' : ''}`}>
                ⏱️ <strong dir="ltr">{remaining}</strong> שנ׳
              </span>
            </div>
          )}

          <div className="mobile-score-grid">
            <div className="mobile-score-box">
              <span>מנחש</span>
              <strong>{me.guesserScore}</strong>
            </div>
            <div className="mobile-score-box">
              <span>יוצר</span>
              <strong>{me.creatorScore}</strong>
            </div>
            <div className="mobile-score-box is-total">
              <span>סה״כ</span>
              <strong>{me.score}</strong>
            </div>
          </div>
        </div>
      )}

      {/* PHASE: ROUND LEADERBOARD */}
      {room.phase === 'round_leaderboard' && (
        <div className="stage-card mobile-card">
          <div className="center-content" style={{ marginBottom: 16 }}>
            <div className="sticker-tag tag-yellow">סיכום סיבוב {room.currentRound}</div>
            {room.roundCommentary && <p className="muted-text">{room.roundCommentary}</p>}
          </div>
          <AnimatedLeaderboard players={players} compact highlightPlayerId={me.id} />
        </div>
      )}

      {/* PHASE: GRAND FINALE */}
      {room.phase === 'finale' && (
        <div className="stage-card mobile-card">
          <GrandFinaleStage
            players={players}
            history={room.history}
            compact
            highlightPlayerId={me.id}
          />
        </div>
      )}
    </div>
  );
}
