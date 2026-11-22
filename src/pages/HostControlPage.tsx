import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  UserX,
} from 'lucide-react';
import { AnimatedLeaderboard } from '../components/AnimatedLeaderboard';
import { CategoryEditor } from '../components/CategoryEditor';
import { QRCodeCard } from '../components/QRCodeCard';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { useCountdown } from '../hooks/useCountdown';
import { useRoom } from '../hooks/useRoom';
import {
  buildGeminiCopyPrompt,
  calculateRoundPlan,
  generateId,
  getHostQueueStatus,
  getSubmissionProgress,
  PRESET_CATEGORY_PACKS,
  sortPlayersByScore,
} from '../lib/gameLogic';
import {
  attachPlayerImage,
  awardPointsAndReveal,
  clearPlayerImage,
  controlTimer,
  createRoom,
  getOrderedGuessQueue,
  markPromptCopied,
  nextGuessOrLeaderboard,
  nextRoundOrFinale,
  removePlayer,
  resetRoomForNewGame,
  sendCelebration,
  startGame,
  startGuessingPhase,
  undoReveal,
  updateRoomSettings,
} from '../lib/gameService';
import {
  compressImageBlob,
  extractImageFileFromTransfer,
  readImageFromClipboardApi,
} from '../lib/imageCompressor';
import type { Category, GameSettings, Submission } from '../lib/types';

function createDefaultCategories(): Category[] {
  return PRESET_CATEGORY_PACKS[0].categories.map((c) => ({
    id: generateId('cat'),
    name: c.name,
    words: [...c.words],
  }));
}

export function HostControlPage() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();

  // Pre-game setup state (/host)
  const [setupCategories, setSetupCategories] = useState<Category[]>(createDefaultCategories);
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [guesserPoints, setGuesserPoints] = useState(1);
  const [creatorPoints, setCreatorPoints] = useState(1);
  const [creating, setCreating] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Live room state (/host/:code)
  const { snapshot, setSnapshot, loading, error } = useRoom(code);
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [showLobbyEditor, setShowLobbyEditor] = useState(false);
  const [showMiniQr, setShowMiniQr] = useState(false);
  const [activePasteSubId, setActivePasteSubId] = useState<string | null>(null);
  const [compressingSubId, setCompressingSubId] = useState<string | null>(null);
  const [dragOverSubId, setDragOverSubId] = useState<string | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);

  // Per-item toggle for "הצג מושג למנחש" (Host-only high-contrast concept reveal)
  const [revealedConcepts, setRevealedConcepts] = useState<Record<string, boolean>>({});

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Ordered player queue for the active round
  const roundSubs = snapshot
    ? [...snapshot.submissions]
        .filter((s) => s.roundNumber === snapshot.room.currentRound)
        .sort((a, b) => a.orderIndex - b.orderIndex)
    : [];

  // Auto-select first submission missing an image during prompting phase
  useEffect(() => {
    if (snapshot?.room.phase !== 'prompting') return;
    if (activePasteSubId && roundSubs.some((s) => s.id === activePasteSubId)) return;
    const firstMissing = roundSubs.find((s) => !s.imageData) || roundSubs[0];
    if (firstMissing) setActivePasteSubId(firstMissing.id);
  }, [snapshot?.room.phase, snapshot?.room.currentRound, roundSubs.length]);

  const toggleConceptVisibility = (subId: string) => {
    setRevealedConcepts((prev) => ({ ...prev, [subId]: !prev[subId] }));
  };

  const handleImageBlobForSubmission = useCallback(
    async (subId: string, blob: Blob) => {
      if (!code) return;
      setActionError('');
      setCompressingSubId(subId);
      try {
        const compressed = await compressImageBlob(blob);
        const fresh = await attachPlayerImage(code, subId, compressed.dataUrl, compressed.sizeKb);
        setSnapshot(fresh);
        const pastedSub = fresh.submissions.find((s) => s.id === subId);
        const pastedPlayer = pastedSub
          ? fresh.players.find((p) => p.id === pastedSub.playerId)
          : null;
        setPasteFeedback(
          `✅ התמונה של ${pastedPlayer?.nickname || 'השחקן'} הודבקה ונדחסה (${compressed.sizeKb} KB)!`
        );
        window.setTimeout(() => setPasteFeedback(null), 3400);

        // Auto-advance active paste target to the next player still needing an image
        const freshRoundSubs = [...fresh.submissions]
          .filter((s) => s.roundNumber === fresh.room.currentRound)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const nextMissing = freshRoundSubs.find((s) => s.id !== subId && !s.imageData);
        if (nextMissing) {
          setActivePasteSubId(nextMissing.id);
        }
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'שגיאה בעיבוד התמונה');
      } finally {
        setCompressingSubId(null);
      }
    },
    [code, setSnapshot]
  );

  // Global Ctrl+V / Cmd+V listener ANYWHERE in the Host Control Panel!
  useEffect(() => {
    if (!code || snapshot?.room.phase !== 'prompting') return;

    const onWindowPaste = (e: ClipboardEvent) => {
      const imageFile = extractImageFileFromTransfer(e.clipboardData);
      if (!imageFile) return;

      e.preventDefault();
      const targetSubId =
        activePasteSubId ||
        roundSubs.find((s) => !s.imageData)?.id ||
        roundSubs[0]?.id;

      if (targetSubId) {
        handleImageBlobForSubmission(targetSubId, imageFile);
      }
    };

    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [code, snapshot?.room.phase, activePasteSubId, roundSubs, handleImageBlobForSubmission]);

  const { remaining, isRunning, isUrgent } = useCountdown(
    snapshot?.room.timerEndsAt || null,
    snapshot?.room.timerPausedRemaining ?? null,
    snapshot?.room.settings.timerSeconds || 60
  );

  // ============================================================================
  // PRE-GAME SETUP SCREEN (/host)
  // ============================================================================
  if (!code) {
    const plan = calculateRoundPlan(setupCategories, 1);

    const handleCreateRoom = async (e: React.FormEvent) => {
      e.preventDefault();
      setSetupError('');
      const cleanedCategories: Category[] = setupCategories
        .map((c) => ({
          id: c.id,
          name: c.name.trim() || 'כללי',
          words: c.words.map((w) => w.trim()).filter(Boolean),
        }))
        .filter((c) => c.words.length > 0);

      if (cleanedCategories.length === 0) {
        setSetupError('הוסיפו לפחות קטגוריה אחת עם מילים לניחוש.');
        return;
      }

      const settings: GameSettings = {
        categories: cleanedCategories,
        timerSeconds: Math.max(10, Math.min(300, timerSeconds)),
        guesserPoints: Math.max(1, Math.min(10, guesserPoints)),
        creatorPoints: Math.max(1, Math.min(10, creatorPoints)),
      };

      setCreating(true);
      try {
        const snap = await createRoom(settings);
        setSnapshot(snap);
        navigate(`/host/${snap.room.code}`);
      } catch (err: unknown) {
        setSetupError(err instanceof Error ? err.message : 'שגיאה ביצירת החדר');
      } finally {
        setCreating(false);
      }
    };

    return (
      <div className="host-setup-shell">
        <div className="host-setup-topbar">
          <button type="button" className="btn-back" onClick={() => navigate('/')}>
            → חזרה לדף הבית
          </button>
          <SyncStatusBadge />
        </div>

        <section className="stage-card host-setup-card">
          <div className="sticker-tag tag-yellow">מסך בקרת מארח (פרטי) 🎛️</div>
          <h1 className="stage-heading">הגדרת משחק חדש</h1>
          <p className="muted-text">
            בנו קטגוריות ומילים לניחוש. מספר הסיבובים יחושב אוטומטית לפי כמות המילים חלקי מספר השחקנים שיצטרפו!
          </p>

          <form className="stack-form" onSubmit={handleCreateRoom}>
            <CategoryEditor categories={setupCategories} onChange={setSetupCategories} />

            <div className="settings-grid-3">
              <div className="field-group">
                <label htmlFor="setup-timer">⏱️ זמן ניחוש לתמונה (שניות)</label>
                <input
                  id="setup-timer"
                  type="number"
                  min={10}
                  max={300}
                  value={timerSeconds}
                  onChange={(e) => setTimerSeconds(Number(e.target.value) || 60)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="setup-guesser-pts">🔍 נקודות למנחש</label>
                <input
                  id="setup-guesser-pts"
                  type="number"
                  min={1}
                  max={10}
                  value={guesserPoints}
                  onChange={(e) => setGuesserPoints(Number(e.target.value) || 1)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="setup-creator-pts">🎨 נקודות ליוצר</label>
                <input
                  id="setup-creator-pts"
                  type="number"
                  min={1}
                  max={10}
                  value={creatorPoints}
                  onChange={(e) => setCreatorPoints(Number(e.target.value) || 1)}
                />
              </div>
            </div>

            {setupError && <div className="error-banner">{setupError}</div>}

            <button
              id="btn-create-room"
              type="submit"
              className="btn-brutal btn-coral btn-xl"
              disabled={creating || plan.totalWords === 0}
            >
              {creating ? 'פותח חדר...' : '🚀 צור חדר ופתח לוח בקרה'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  // ============================================================================
  // LIVE HOST CONTROL PANEL (/host/:code)
  // ============================================================================
  if (loading) {
    return (
      <div className="center-stage-wrap">
        <div className="stage-card loading-card">
          <div className="spinner-brutal" />
          <h2>טוען את לוח המארח לחדר {code}...</h2>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="center-stage-wrap">
        <div className="stage-card attach-card">
          <h2>החדר {code} לא נמצא 😅</h2>
          <p className="muted-text">{error}</p>
          <button type="button" className="btn-brutal btn-coral" onClick={() => navigate('/host')}>
            צור חדר חדש
          </button>
        </div>
      </div>
    );
  }

  const { room, players } = snapshot;
  const connectedPlayers = players.filter((p) => p.connected);
  const roundPlan = calculateRoundPlan(room.settings.categories, connectedPlayers.length);
  const progress = getSubmissionProgress(snapshot.submissions, room.currentRound);
  const queue = getOrderedGuessQueue(snapshot);
  const currentGuess = room.phase === 'guessing' ? queue[room.currentGuessIndex] || null : null;
  const currentCreator = currentGuess
    ? players.find((p) => p.id === currentGuess.playerId) || null
    : null;
  const currentGuesser = currentGuess?.guesserId
    ? players.find((p) => p.id === currentGuess.guesserId) || null
    : null;

  const activePasteSub = roundSubs.find((s) => s.id === activePasteSubId) || roundSubs[0] || null;
  const activePastePlayer = activePasteSub
    ? players.find((p) => p.id === activePasteSub.playerId) || null
    : null;
  const activePasteIndex = activePasteSub
    ? roundSubs.findIndex((s) => s.id === activePasteSub.id) + 1
    : 0;

  const playUrl = `${window.location.origin}/play/${room.code}`;
  const screenUrl = `${window.location.origin}/screen/${room.code}`;

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setActionError('');
    setBusyAction(key);
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'room' in (res as Record<string, unknown>)) {
        setSnapshot(res as typeof snapshot);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'אירעה שגיאה בביצוע הפעולה');
    } finally {
      setBusyAction(null);
    }
  };

  // Copies `צור קריקטורה של [Prompt]` + persistently marks as "הועתק" (locking player edits)
  const copyPromptText = async (sub: Submission) => {
    if (!sub.prompt.trim()) return;
    const formattedPrompt = buildGeminiCopyPrompt(sub.prompt);
    try {
      await navigator.clipboard.writeText(formattedPrompt);
    } catch {
      // Fallback textarea copy if clipboard API is restricted
      const ta = document.createElement('textarea');
      ta.value = formattedPrompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    setActivePasteSubId(sub.id);
    const p = players.find((pl) => pl.id === sub.playerId);
    setCopiedToast(`הועתק ללוח: "${formattedPrompt}" (${p?.nickname || 'שחקן'})`);
    window.setTimeout(() => setCopiedToast(null), 3200);

    try {
      const fresh = await markPromptCopied(room.code, sub.id);
      setSnapshot(fresh);
    } catch {
      // ignore non-critical sync error
    }
  };

  const handlePasteButtonClick = async (subId: string) => {
    setActivePasteSubId(subId);
    setActionError('');
    try {
      const blob = await readImageFromClipboardApi();
      if (!blob) {
        setActionError('אין תמונה בלוח ההעתקה! העתיקו תמונה מ-Gemini (לחיצה ימנית → העתק תמונה) ואז הדביקו.');
        return;
      }
      await handleImageBlobForSubmission(subId, blob);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'לחצו Ctrl+V בכל מקום במסך כדי להדביק!');
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(playUrl);
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleUpdateLobbyCategories = async (nextCategories: Category[]) => {
    const cleaned: Category[] = nextCategories.map((c) => ({
      ...c,
      name: c.name,
      words: c.words,
    }));
    const nextSettings: GameSettings = {
      ...room.settings,
      categories: cleaned,
    };
    setSnapshot({
      ...snapshot,
      room: { ...room, settings: nextSettings },
    });
    try {
      await updateRoomSettings(room.code, nextSettings);
    } catch {
      // ignore transient typing sync error
    }
  };

  return (
    <div className="host-console-shell">
      {/* Persistent Private Host Header */}
      <header className="host-topbar">
        <div className="host-topbar-right">
          <span className="brand-sticker">🎛️</span>
          <div className="host-title-block">
            <strong>לוח בקרת מארח (פרטי)</strong>
            <span className="host-code-inline">
              חדר <strong dir="ltr">{room.code}</strong>
              {room.phase !== 'lobby' && room.totalRounds > 0 && (
                <> • סיבוב <strong dir="ltr">{room.currentRound}/{room.totalRounds}</strong></>
              )}
            </span>
          </div>
        </div>

        <div className="host-topbar-actions">
          <SyncStatusBadge />

          <button
            type="button"
            className="btn-brutal btn-yellow btn-sm"
            onClick={() => window.open(screenUrl, `screen_${room.code}`)}
          >
            <ExternalLink size={16} />
            <span>📺 פתח מסך ראשי (לטלוויזיה)</span>
          </button>

          <button
            type="button"
            className="btn-brutal btn-white btn-sm"
            onClick={handleCopyInviteLink}
          >
            {copiedInvite ? <Check size={16} /> : <Copy size={16} />}
            <span>{copiedInvite ? 'קישור הועתק!' : 'קישור לשחקנים'}</span>
          </button>
        </div>
      </header>

      <main className="host-console-main">
        {actionError && <div className="error-banner host-global-alert">{actionError}</div>}
        {copiedToast && <div className="info-banner host-global-alert">{copiedToast}</div>}
        {pasteFeedback && <div className="success-banner host-global-alert">{pasteFeedback}</div>}

        {/* ================================================================ */}
        {/* HOST LOBBY CONTROL                                               */}
        {/* ================================================================ */}
        {room.phase === 'lobby' && (
          <div className="host-lobby-grid">
            <div className="stage-card">
              <div className="host-section-head">
                <div>
                  <span className="sticker-tag tag-yellow mini-tag">שלב הכנה ולובי</span>
                  <h2>שחקנים שמחוברים לחדר ({connectedPlayers.length})</h2>
                </div>
                <button
                  type="button"
                  className="btn-mini-brutal"
                  onClick={() => setShowMiniQr((v) => !v)}
                >
                  {showMiniQr ? 'הסתר QR' : '📱 הצג QR גם כאן'}
                </button>
              </div>

              {showMiniQr && (
                <div className="host-mini-qr-wrap">
                  <QRCodeCard url={playUrl} size={170} caption={`קוד חדר: ${room.code}`} />
                </div>
              )}

              <div className="dual-screen-tip">
                <span>📺</span>
                <div>
                  <strong>הגדרת שני מסכים:</strong> לחצו למעלה על <strong>״פתח מסך ראשי״</strong> וגררו את החלון שנפתח לטלוויזיה / למקרן. את העמוד הזה תשאירו פרטי אצלכם!
                </div>
              </div>

              {connectedPlayers.length === 0 ? (
                <div className="empty-state-box">
                  <p>ממתינים לשחקנים שיסרקו את ה-QR במסך הראשי (או יכנסו לקישור)...</p>
                  <code className="join-link-code" dir="ltr">{playUrl}</code>
                </div>
              ) : (
                <div className="host-players-chips">
                  {connectedPlayers.map((p) => (
                    <div key={p.id} className="host-player-pill">
                      <span className="hp-avatar">{p.avatar}</span>
                      <span className="hp-name">{p.nickname}</span>
                      <button
                        type="button"
                        className="btn-kick"
                        title="הסר שחקן"
                        onClick={() => runAction(`kick-${p.id}`, () => removePlayer(room.code, p.id))}
                      >
                        <UserX size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Live Dynamic Rounds Calculation */}
              <div className={`dynamic-rounds-banner ${roundPlan.canStart ? 'ok' : 'warn'}`}>
                <div className="drb-title">🧮 חישוב סיבובים דינמי</div>
                {connectedPlayers.length === 0 ? (
                  <p>
                    בקופה יש <strong>{roundPlan.totalWords}</strong> מילים ב-<strong>{roundPlan.categoryCount}</strong> קטגוריות.
                    ברגע שיצטרפו שחקנים נחשב אוטומטית את מספר הסיבובים!
                  </p>
                ) : roundPlan.canStart ? (
                  <p>
                    <strong>{roundPlan.totalWords}</strong> מילים ÷ <strong>{connectedPlayers.length}</strong> שחקנים ={' '}
                    <span className="drb-rounds">{roundPlan.totalRounds} סיבובים מלאים!</span>
                    {roundPlan.leftoverWords > 0 && (
                      <> ({roundPlan.leftoverWords === 1 ? 'מילה 1 לא תנוצל' : `${roundPlan.leftoverWords} מילים לא ינוצלו`})</>
                    )}
                  </p>
                ) : (
                  <p>
                    ⚠️ יש כרגע רק <strong>{roundPlan.totalWords}</strong> מילים ל-<strong>{connectedPlayers.length}</strong> שחקנים.
                    הוסיפו עוד <strong>{connectedPlayers.length - roundPlan.totalWords}</strong> מילים לפחות כדי להתחיל!
                  </p>
                )}
              </div>

              <div className="host-lobby-actions">
                <button
                  id="btn-host-start-game"
                  type="button"
                  className="btn-brutal btn-green btn-xl"
                  disabled={!roundPlan.canStart || busyAction === 'start'}
                  onClick={() => runAction('start', () => startGame(room.code))}
                >
                  {busyAction === 'start'
                    ? 'מזניק משחק...'
                    : `🚀 התחל משחק! (${roundPlan.totalRounds} סיבובים)`}
                </button>

                <button
                  type="button"
                  className="btn-brutal btn-white"
                  onClick={() => setShowLobbyEditor((v) => !v)}
                >
                  {showLobbyEditor ? 'סגור עריכת מילים' : '✏️ ערוך קטגוריות ומילים'}
                </button>
              </div>
            </div>

            {showLobbyEditor && (
              <div className="stage-card">
                <h3>עריכת קטגוריות ומילים לפני ההתחלה</h3>
                <CategoryEditor
                  categories={room.settings.categories}
                  onChange={handleUpdateLobbyCategories}
                  connectedPlayerCount={connectedPlayers.length}
                />
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* HOST LIVE ROUND MANAGEMENT: ORDERED QUEUE + GLOBAL PASTE         */}
        {/* ================================================================ */}
        {room.phase === 'prompting' && (
          <div className="host-prompting-wrap">
            <div className="stage-card host-round-banner">
              <div className="hrb-top">
                <div>
                  <span className="sticker-tag tag-yellow mini-tag">
                    סיבוב {room.currentRound} מתוך {room.totalRounds} • קטגוריה: {room.currentCategory}
                  </span>
                  <h2>תור השחקנים והדבקת תמונות מ-Gemini</h2>
                </div>

                <div className="hrb-counters">
                  <div className="counter-box">
                    <span>פרומפטים שהתקבלו</span>
                    <strong dir="ltr">{progress.promptsDone}/{progress.total}</strong>
                  </div>
                  <div className={`counter-box ${progress.allImagesReady ? 'is-complete' : ''}`}>
                    <span>תמונות מוכנות</span>
                    <strong dir="ltr">{progress.imagesDone}/{progress.total}</strong>
                  </div>
                </div>
              </div>

              {/* Global Ctrl+V Active Target Strip */}
              {activePasteSub && activePastePlayer && (
                <div className="global-paste-banner">
                  <div className="gpb-left">
                    <ClipboardPaste size={20} strokeWidth={2.5} />
                    <span>
                      יעד הדבקה פעיל: <strong>#{activePasteIndex} {activePastePlayer.nickname}</strong> — פשוט לחצו{' '}
                      <kbd dir="ltr">Ctrl+V</kbd> / <kbd dir="ltr">Cmd+V</kbd> <strong>בכל מקום במסך</strong> להדבקת תמונה!
                    </span>
                  </div>
                  <span className="gpb-tip">העתקת פרומפט מצרפת אוטומטית: ״צור קריקטורה של...״</span>
                </div>
              )}

              {/* Compact Ordered Queue Overview Bar */}
              <div className="queue-overview-bar">
                {roundSubs.map((sub, idx) => {
                  const p = players.find((pl) => pl.id === sub.playerId);
                  if (!p) return null;
                  const qStatus = getHostQueueStatus(sub);
                  const isSelected = activePasteSubId === sub.id;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      className={`queue-chip status-${qStatus.key} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setActivePasteSubId(sub.id)}
                    >
                      <span className="qc-num">#{idx + 1}</span>
                      <span className="qc-name">{p.nickname}</span>
                      <span className="qc-status">{qStatus.label}</span>
                      {qStatus.isCopied && <span className="qc-copied-tag">הועתק</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ordered Player Cards */}
            <div className="host-submissions-grid">
              {roundSubs.map((sub, idx) => {
                const player = players.find((p) => p.id === sub.playerId);
                if (!player) return null;

                const qStatus = getHostQueueStatus(sub);
                const isSelected = activePasteSubId === sub.id;
                const isCompressing = compressingSubId === sub.id;
                const isDragOver = dragOverSubId === sub.id;
                const hasPrompt = Boolean(sub.prompt.trim());
                const hasImage = Boolean(sub.imageData);
                const isConceptShown = Boolean(revealedConcepts[sub.id]);

                return (
                  <article
                    key={sub.id}
                    className={`host-sub-card ${isSelected ? 'is-active-paste' : ''} ${
                      hasImage ? 'has-image' : hasPrompt ? 'has-prompt' : ''
                    }`}
                    onClick={() => setActivePasteSubId(sub.id)}
                  >
                    <div className="hsc-header">
                      <div className="hsc-player">
                        <span className="hsc-queue-num">#{idx + 1}</span>
                        <span className="hsc-avatar">{player.avatar}</span>
                        <div>
                          <div className="hsc-name">{player.nickname}</div>
                          <span className="hsc-cat-tag">קטגוריה: {sub.category}</span>
                        </div>
                      </div>

                      <div className="hsc-badges-col">
                        <span className={`hsc-status st-${qStatus.key}`}>{qStatus.label}</span>
                        {qStatus.isCopied && (
                          <span className="copied-badge">
                            <Check size={12} strokeWidth={3} /> הועתק
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Reveal Target Concept Toggle ("הצג מושג למנחש") */}
                    <div className="hsc-concept-section">
                      <button
                        type="button"
                        className={`btn-reveal-concept ${isConceptShown ? 'is-open' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleConceptVisibility(sub.id);
                        }}
                      >
                        {isConceptShown ? <EyeOff size={16} /> : <Eye size={16} />}
                        <span>{isConceptShown ? 'הסתר מושג' : 'הצג מושג למנחש'}</span>
                      </button>

                      {isConceptShown && (
                        <div className="high-contrast-concept-card pop-in">
                          <span className="hccc-label">המושג הסודי:</span>
                          <div className="hccc-word">{sub.secretWord}</div>
                        </div>
                      )}
                    </div>

                    {/* Submitted Prompt from Player Phone + One-Click Caricature Copy */}
                    <div className="hsc-prompt-box">
                      <div className="hsc-prompt-head">
                        <span className="hsc-label">הפרומפט מהנייד:</span>
                        {hasPrompt && (
                          <button
                            type="button"
                            className={`btn-copy-prompt ${qStatus.isCopied ? 'is-copied' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              copyPromptText(sub);
                            }}
                          >
                            {qStatus.isCopied ? (
                              <>
                                <Check size={14} strokeWidth={3} /> הועתק (העתק שוב)
                              </>
                            ) : (
                              <>
                                <Copy size={14} /> העתק ״צור קריקטורה של...״
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {hasPrompt ? (
                        <p className="hsc-prompt-text">{sub.prompt}</p>
                      ) : (
                        <p className="hsc-prompt-empty">השחקן עדיין כותב את הפרומפט בטלפון...</p>
                      )}
                    </div>

                    {/* Dedicated Image Dropzone / Ctrl+V Paste Target */}
                    <div
                      tabIndex={0}
                      className={`image-dropzone ${isSelected ? 'selected' : ''} ${
                        isDragOver ? 'drag-over' : ''
                      } ${hasImage ? 'filled' : ''}`}
                      onFocus={() => setActivePasteSubId(sub.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSubId(sub.id);
                      }}
                      onDragLeave={() => setDragOverSubId(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverSubId(null);
                        const file = extractImageFileFromTransfer(e.dataTransfer);
                        if (file) {
                          handleImageBlobForSubmission(sub.id, file);
                        }
                      }}
                    >
                      <input
                        ref={(el) => {
                          fileInputRefs.current[sub.id] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden-file-input"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageBlobForSubmission(sub.id, file);
                          e.target.value = '';
                        }}
                      />

                      {isCompressing ? (
                        <div className="dropzone-loading">
                          <div className="spinner-brutal sm" />
                          <span>דוחס ומסנכרן תמונה...</span>
                        </div>
                      ) : hasImage ? (
                        <div className="dropzone-preview">
                          <img src={sub.imageData!} alt={sub.secretWord} />
                          <div className="dropzone-preview-bar">
                            <span className="size-pill">⚡ {sub.imageSizeKb || '?'} KB</span>
                            <div className="dropzone-mini-actions">
                              <button
                                type="button"
                                className="btn-mini-brutal"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fileInputRefs.current[sub.id]?.click();
                                }}
                              >
                                החלף
                              </button>
                              <button
                                type="button"
                                className="btn-icon-danger"
                                title="מחק תמונה"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runAction(`clear-${sub.id}`, () =>
                                    clearPlayerImage(room.code, sub.id)
                                  );
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="dropzone-empty">
                          <div className="dropzone-hint">
                            {isSelected ? (
                              <strong className="paste-ready-tag">
                                יעד פעיל! לחצו <kbd dir="ltr">Ctrl+V</kbd> בכל מקום במסך
                              </strong>
                            ) : (
                              <span>לחצו לבחירת יעד הדבקה (<kbd dir="ltr">Ctrl+V</kbd>) או גררו תמונה</span>
                            )}
                          </div>

                          <div className="dropzone-btn-row">
                            <button
                              type="button"
                              className="btn-mini-brutal btn-mini-yellow"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePasteButtonClick(sub.id);
                              }}
                            >
                              <ClipboardPaste size={15} /> הדבק מהלוח
                            </button>

                            <button
                              type="button"
                              className="btn-mini-brutal"
                              onClick={(e) => {
                                e.stopPropagation();
                                fileInputRefs.current[sub.id]?.click();
                              }}
                            >
                              <Upload size={15} /> העלה תמונה
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="host-sticky-footer">
              <button
                id="btn-start-guessing"
                type="button"
                className={`btn-brutal btn-xl ${progress.allImagesReady ? 'btn-green' : 'btn-coral'}`}
                disabled={progress.imagesDone === 0 || busyAction === 'start-guessing'}
                onClick={() => runAction('start-guessing', () => startGuessingPhase(room.code))}
              >
                {busyAction === 'start-guessing'
                  ? 'מעביר למסך הראשי...'
                  : progress.allImagesReady
                  ? `🎭 כל ${progress.imagesDone} התמונות מוכנות! התחל ניחושים עכשיו!`
                  : `🎭 התחל ניחושים עם ${progress.imagesDone} מתוך ${progress.total} תמונות`}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* HOST LIVE GUESSING & SCORING CONTROLS                            */}
        {/* ================================================================ */}
        {room.phase === 'guessing' && currentGuess && (
          <div className="host-guessing-wrap">
            {/* Ordered Queue Progress Strip during Guessing */}
            <div className="stage-card host-guess-queue-strip">
              {queue.map((item, idx) => {
                const p = players.find((pl) => pl.id === item.playerId);
                const qStatus = getHostQueueStatus(item);
                const isCurrent = idx === room.currentGuessIndex;
                return (
                  <div
                    key={item.id}
                    className={`queue-chip status-${qStatus.key} ${isCurrent ? 'is-selected' : ''}`}
                  >
                    <span className="qc-num">#{idx + 1}</span>
                    <span className="qc-name">{p?.nickname || 'שחקן'}</span>
                    <span className="qc-status">{isCurrent && !item.revealed ? 'מוצג עכשיו' : qStatus.label}</span>
                  </div>
                );
              })}
            </div>

            <div className="host-guessing-grid">
              {/* Left/Top: Image Preview, "הצג מושג למנחש" Toggle & Prominent Pause/Resume Timer */}
              <div className="stage-card host-guess-preview-card">
                <div className="hgp-head">
                  <span className="counter-sticker">
                    תמונה {room.currentGuessIndex + 1} / {queue.length}
                  </span>
                  <span className="meta-sticker meta-blue mini-pill">{currentGuess.category}</span>
                </div>

                <div className="hgp-img-box">
                  <img src={currentGuess.imageData || ''} alt={currentGuess.secretWord} />
                </div>

                {/* High-Contrast "הצג מושג למנחש" Toggle */}
                <div className="host-concept-toggle-wrap">
                  <button
                    id="btn-toggle-host-concept"
                    type="button"
                    className={`btn-brutal btn-touch ${
                      revealedConcepts[currentGuess.id] ? 'btn-dark' : 'btn-yellow'
                    }`}
                    onClick={() => toggleConceptVisibility(currentGuess.id)}
                  >
                    {revealedConcepts[currentGuess.id] ? <EyeOff size={20} /> : <Eye size={20} />}
                    <span>
                      {revealedConcepts[currentGuess.id]
                        ? 'הסתר מושג סודי'
                        : 'הצג מושג למנחש'}
                    </span>
                  </button>

                  {revealedConcepts[currentGuess.id] && (
                    <div className="high-contrast-concept-card is-large pop-in">
                      <span className="hccc-label">המושג הסודי (למארח בלבד):</span>
                      <div className="hccc-word">{currentGuess.secretWord}</div>
                      <div className="hccc-meta">
                        יוצר: <strong>{currentCreator?.nickname}</strong>
                      </div>
                      {currentGuess.prompt && (
                        <div className="hccc-prompt">פרומפט: ״{currentGuess.prompt}״</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Prominent Pause/Resume Timer Control ("השהה טיימר") */}
                <div className="host-timer-panel">
                  <div className={`host-timer-big ${isUrgent ? 'urgent' : ''} ${!isRunning && remaining > 0 ? 'paused' : ''}`}>
                    <strong dir="ltr">{remaining}</strong>
                    <span>{!isRunning && remaining > 0 ? 'מושהה' : 'שניות'}</span>
                  </div>

                  <button
                    id="btn-pause-resume-timer"
                    type="button"
                    className={`btn-brutal btn-lg ${isRunning ? 'btn-yellow' : 'btn-green'}`}
                    disabled={currentGuess.revealed || busyAction === 'timer'}
                    onClick={() =>
                      runAction('timer', () =>
                        controlTimer(room.code, isRunning ? 'pause' : 'start')
                      )
                    }
                  >
                    {isRunning ? <Pause size={18} /> : <Play size={18} />}
                    <span>{isRunning ? 'השהה טיימר' : 'המשך טיימר'}</span>
                  </button>

                  <div className="timer-secondary-btns">
                    <button
                      type="button"
                      className="btn-mini-brutal"
                      disabled={currentGuess.revealed || busyAction === 'timer'}
                      onClick={() => runAction('timer', () => controlTimer(room.code, 'add15'))}
                    >
                      +15 שניות
                    </button>

                    <button
                      type="button"
                      className="btn-mini-brutal"
                      disabled={currentGuess.revealed || busyAction === 'timer'}
                      onClick={() => runAction('timer', () => controlTimer(room.code, 'reset'))}
                    >
                      <RotateCcw size={14} />
                      <span>אפס טיימר</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right/Main: Quick Verbal-Guess Scoring Buttons */}
              <div className="stage-card host-scoring-card">
                {!currentGuess.revealed ? (
                  <>
                    <div className="sticker-tag tag-yellow mini-tag">הענקת נקודות מהירה 🏆</div>
                    <h2>מי ניחש נכון בקול רם?</h2>
                    <p className="muted-text">
                      לחצו על שם המנחש/ת — המערכת תחשוף את המושג ולאחריו את הפרומפט במסך הראשי, ותעניק{' '}
                      <strong>+{room.settings.guesserPoints} נק׳</strong> למנחש/ת ו-
                      <strong>+{room.settings.creatorPoints} נק׳</strong> ליוצר/ת ({currentCreator?.nickname}).
                    </p>

                    <div className="quick-score-grid">
                      {connectedPlayers.map((p) => {
                        const isCreator = p.id === currentGuess.playerId;
                        const disabled = isCreator && connectedPlayers.length > 1;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className={`btn-score-player ${isCreator ? 'is-creator' : ''}`}
                            disabled={disabled || busyAction === 'award'}
                            onClick={() =>
                              runAction('award', () =>
                                awardPointsAndReveal(room.code, currentGuess.id, p.id)
                              )
                            }
                          >
                            <span className="bsp-avatar">{p.avatar}</span>
                            <span className="bsp-name">{p.nickname}</span>
                            <span className="bsp-tag">
                              {isCreator ? 'היוצר' : `+${room.settings.guesserPoints} נק׳`}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="scoring-divider">או אם הזמן נגמר ואף אחד לא הצליח:</div>

                    <button
                      type="button"
                      className="btn-brutal btn-dark btn-lg"
                      disabled={busyAction === 'award'}
                      onClick={() =>
                        runAction('award', () =>
                          awardPointsAndReveal(room.code, currentGuess.id, null)
                        )
                      }
                    >
                      אף אחד לא ניחש — חשוף מושג ופרומפט (0 נק׳)
                    </button>
                  </>
                ) : (
                  <div className="revealed-control-state">
                    <div
                      className={`revealed-summary-box ${
                        currentGuess.guessedCorrectly ? 'hit' : 'miss'
                      }`}
                    >
                      <h3>
                        {currentGuess.guessedCorrectly
                          ? 'הניקוד הוענק והתשובה נחשפה בשלבים!'
                          : 'המושג והפרומפט נחשפו ללא ניקוד'}
                      </h3>

                      {currentGuess.guessedCorrectly && (
                        <div className="revealed-pts-lines">
                          <div>
                            מנחש/ת: <strong>{currentGuesser?.avatar} {currentGuesser?.nickname}</strong>{' '}
                            <span className="pts-tag" dir="ltr">+{currentGuess.awardedGuesserPts}</span>
                          </div>
                          <div>
                            יוצר/ת: <strong>{currentCreator?.avatar} {currentCreator?.nickname}</strong>{' '}
                            <span className="pts-tag" dir="ltr">+{currentGuess.awardedCreatorPts}</span>
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn-mini-brutal"
                        disabled={busyAction === 'undo'}
                        onClick={() =>
                          runAction('undo', () => undoReveal(room.code, currentGuess.id))
                        }
                      >
                        <Undo2 size={14} /> טעיתי בלחיצה? בטל ניקוד
                      </button>
                    </div>

                    <button
                      id="btn-host-next-guess"
                      type="button"
                      className="btn-brutal btn-green btn-xl"
                      disabled={busyAction === 'next-guess'}
                      onClick={() =>
                        runAction('next-guess', () => nextGuessOrLeaderboard(room.code))
                      }
                    >
                      {room.currentGuessIndex + 1 < queue.length
                        ? `עבור לתמונה הבאה (${room.currentGuessIndex + 2}/${queue.length})`
                        : 'סיימנו את הסיבוב! הצג טבלת ניקוד'}
                    </button>
                  </div>
                )}

                {/* Live Mini Scoreboard */}
                <div className="host-mini-scoreboard">
                  <h4>ניקוד חי כרגע:</h4>
                  <div className="mini-sb-pills">
                    {sortPlayersByScore(players).map((p, idx) => (
                      <span key={p.id} className="mini-sb-chip">
                        #{idx + 1} {p.nickname}: <strong>{p.score}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* HOST ROUND LEADERBOARD CONTROL                                   */}
        {/* ================================================================ */}
        {room.phase === 'round_leaderboard' && (
          <div className="host-transition-wrap">
            <div className="stage-card host-transition-card">
              <div className="sticker-tag tag-yellow mini-tag">
                סיבוב {room.currentRound} מתוך {room.totalRounds} הסתיים!
              </div>
              <h2>טבלת הניקוד מוצגת כעת על המסך הראשי</h2>
              <p className="muted-text">
                תנו לכולם רגע לראות מי עלה בדירוג — וכשתהיו מוכנים לחצו למטה להמשיך!
              </p>

              <AnimatedLeaderboard players={players} compact />

              <div className="host-transition-actions">
                <button
                  id="btn-host-next-round"
                  type="button"
                  className="btn-brutal btn-coral btn-xl"
                  disabled={busyAction === 'next-round'}
                  onClick={() => runAction('next-round', () => nextRoundOrFinale(room.code))}
                >
                  {room.currentRound >= room.totalRounds
                    ? 'לגמר הגדול והכרזת המנצח!'
                    : `התחל סיבוב ${room.currentRound + 1} מתוך ${room.totalRounds}!`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* HOST GRAND FINALE CONTROL                                        */}
        {/* ================================================================ */}
        {room.phase === 'finale' && (
          <div className="host-transition-wrap">
            <div className="stage-card host-transition-card">
              <div className="sticker-tag tag-yellow mini-tag">הגמר הגדול</div>
              <h2>הכרזת המנצח ורגעי השיא מוצגים על המסך הראשי!</h2>
              <p className="muted-text">
                כל הסיבובים הושלמו בהצלחה. אפשר לפוצץ עוד קונפטי או לפתוח משחק חדש באותו החדר (השחקנים יישארו מחוברים).
              </p>

              <AnimatedLeaderboard players={players} compact />

              <div className="host-finale-buttons">
                <button
                  type="button"
                  className="btn-brutal btn-yellow btn-lg"
                  onClick={() => sendCelebration(room.code, 'finale')}
                >
                  <Sparkles size={18} /> פוצץ עוד קונפטי במסך הראשי!
                </button>

                <button
                  id="btn-host-play-again"
                  type="button"
                  className="btn-brutal btn-coral btn-lg"
                  disabled={busyAction === 'reset'}
                  onClick={() => runAction('reset', () => resetRoomForNewGame(room.code))}
                >
                  משחק חדש באותו חדר
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
