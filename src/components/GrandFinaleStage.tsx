import { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Clock,
  Crown,
  Flame,
  Images,
  Palette,
  Search,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { fireGrandFinaleConfetti } from '../lib/confetti';
import { computeSuperlatives, sortPlayersByScore } from '../lib/gameLogic';
import type { AwardIconKey, Player, RoundHistoryItem } from '../lib/types';

interface GrandFinaleStageProps {
  players: Player[];
  history: RoundHistoryItem[];
  compact?: boolean;
  highlightPlayerId?: string;
}

function renderAwardIcon(icon: AwardIconKey) {
  switch (icon) {
    case 'palette':
      return <Palette size={28} strokeWidth={2.4} />;
    case 'search':
      return <Search size={28} strokeWidth={2.4} />;
    case 'sparkles':
      return <Sparkles size={28} strokeWidth={2.4} />;
  }
}

function getMonogram(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function GrandFinaleStage({
  players,
  history,
  compact = false,
  highlightPlayerId,
}: GrandFinaleStageProps) {
  const [revealStep, setRevealStep] = useState(0);
  const [showGallery, setShowGallery] = useState(false);

  const sorted = sortPlayersByScore(players);
  const topScore = sorted[0]?.score ?? 0;
  const champions = sorted.filter((p) => p.score === topScore);
  const isTie = champions.length > 1;
  const podium = sorted.slice(0, 3);
  const awards = computeSuperlatives(players);

  // Compute End-of-Game Highlights ("רגעי השיא")
  const topGuesser = [...players].sort((a, b) => b.guesserScore - a.guesserScore)[0];
  const topCreator = [...players].sort((a, b) => b.creatorScore - a.creatorScore)[0];
  const guessedCount = history.filter((h) => h.guessedCorrectly).length;
  const totalImages = history.length;
  const solveRate = totalImages > 0 ? Math.round((guessedCount / totalImages) * 100) : 0;

  useEffect(() => {
    const t1 = window.setTimeout(() => setRevealStep(1), 260);
    const t2 = window.setTimeout(() => setRevealStep(2), 820);
    const t3 = window.setTimeout(() => setRevealStep(3), 1450);
    const t4 = window.setTimeout(() => setRevealStep(4), 2100);
    const stopConfetti = !compact ? fireGrandFinaleConfetti() : () => {};

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      stopConfetti();
    };
  }, [compact]);

  const champNames = champions.map((c) => c.nickname).join(' ו-');

  return (
    <div className={`finale-stage ${compact ? 'is-compact' : ''}`}>
      {/* Winner Hero (Pure Vector & Typographic — Zero Emojis) */}
      <div className="finale-hero">
        <div className="finale-crown-badge" aria-hidden="true">
          <Crown size={44} strokeWidth={2.5} />
        </div>
        <div className="sticker-tag tag-yellow">הגמר הגדול — הכרזת הזוכים</div>
        <h1 className="finale-title">
          {isTie
            ? `תיקו אגדי בצמרת: ${champNames}`
            : `${champNames} — אלוף הערב!`}
        </h1>
        <p className="finale-roast">
          {topScore === 0
            ? 'כולם סיימו עם 0 נקודות — כנראה שהמנצח האמיתי של הערב הוא Gemini.'
            : isTie
            ? 'שני מוחות גאוניים (או תיאום מושלם) חולקים את המקום הראשון בכבוד רב.'
            : `עם ${topScore} נקודות ומוח חד יותר מפרומפט של 500 מילה — קבלו את הזוכה של הערב!`}
        </p>
      </div>

      {/* Choreographed 3-Place Podium */}
      {podium.length > 0 && (
        <div className="podium-grid">
          {podium[1] && (
            <div className={`podium-slot slot-2 ${revealStep >= 2 ? 'revealed' : ''}`}>
              <div className="podium-monogram monogram-2">{getMonogram(podium[1].nickname)}</div>
              <div className="podium-name">
                {podium[1].nickname}
                {highlightPlayerId === podium[1].id && <span className="me-pill">את/ה</span>}
              </div>
              <div className="podium-score">{podium[1].score} נק׳</div>
              <div className="podium-pillar pillar-2">
                <span className="pillar-rank">2</span>
              </div>
            </div>
          )}

          <div className={`podium-slot slot-1 ${revealStep >= 3 ? 'revealed' : ''}`}>
            <div className="podium-crown-icon" aria-hidden="true">
              <Crown size={30} strokeWidth={2.6} />
            </div>
            <div className="podium-monogram monogram-1">{getMonogram(podium[0].nickname)}</div>
            <div className="podium-name">
              {podium[0].nickname}
              {highlightPlayerId === podium[0].id && <span className="me-pill">את/ה</span>}
            </div>
            <div className="podium-score score-winner">{podium[0].score} נק׳</div>
            <div className="podium-pillar pillar-1">
              <Trophy size={26} strokeWidth={2.5} />
              <span className="pillar-rank">1</span>
            </div>
          </div>

          {podium[2] && (
            <div className={`podium-slot slot-3 ${revealStep >= 1 ? 'revealed' : ''}`}>
              <div className="podium-monogram monogram-3">{getMonogram(podium[2].nickname)}</div>
              <div className="podium-name">
                {podium[2].nickname}
                {highlightPlayerId === podium[2].id && <span className="me-pill">את/ה</span>}
              </div>
              <div className="podium-score">{podium[2].score} נק׳</div>
              <div className="podium-pillar pillar-3">
                <span className="pillar-rank">3</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* End-of-Game Highlights Summary ("רגעי השיא") */}
      <section className={`highlights-section ${revealStep >= 4 ? 'revealed' : ''}`}>
        <div className="highlights-header">
          <Flame size={22} strokeWidth={2.5} />
          <h2>רגעי השיא</h2>
        </div>

        <div className="highlights-grid">
          <div className="highlight-card hl-guesser">
            <div className="hl-icon-box">
              <Search size={24} strokeWidth={2.5} />
            </div>
            <div className="hl-label">המנחש המצטיין</div>
            <div className="hl-value">
              {topGuesser && topGuesser.guesserScore > 0 ? topGuesser.nickname : '—'}
            </div>
            <div className="hl-stat">
              {topGuesser && topGuesser.guesserScore > 0
                ? `${topGuesser.guesserScore} נק׳ מניחושים נכונים`
                : 'טרם נצברו ניחושים'}
            </div>
          </div>

          <div className="highlight-card hl-creator">
            <div className="hl-icon-box">
              <Palette size={24} strokeWidth={2.5} />
            </div>
            <div className="hl-label">יוצר הפרומפטים המצטיין</div>
            <div className="hl-value">
              {topCreator && topCreator.creatorScore > 0 ? topCreator.nickname : '—'}
            </div>
            <div className="hl-stat">
              {topCreator && topCreator.creatorScore > 0
                ? `${topCreator.creatorScore} נק׳ מתמונות שפוצחו`
                : 'טרם נצברו נקודות יוצר'}
            </div>
          </div>

          <div className="highlight-card hl-rate">
            <div className="hl-icon-box">
              <Award size={24} strokeWidth={2.5} />
            </div>
            <div className="hl-label">מדד פיצוח קבוצתי</div>
            <div className="hl-value" dir="ltr">
              {solveRate}%
            </div>
            <div className="hl-stat">
              {guessedCount} מתוך {totalImages} יצירות נוחשו בהצלחה
            </div>
          </div>
        </div>
      </section>

      {/* Humorous Superlative Titles (Vector Icons Only) */}
      {awards.length > 0 && (
        <div className="awards-grid">
          {awards.map((award) => (
            <div key={award.id} className="award-card">
              <div className="award-icon-badge" aria-hidden="true">
                {renderAwardIcon(award.icon)}
              </div>
              <div className="award-title">{award.title}</div>
              <div className="award-winners">
                {award.winnerNames.map((name, i) => (
                  <span key={i} className="award-winner-chip">
                    {name}
                  </span>
                ))}
              </div>
              <div className="award-stat">{award.statLabel}</div>
              <div className="award-sub">{award.subtitle}</div>
            </div>
          ))}
        </div>
      )}

      {/* Full Standings beyond Top 3 */}
      {sorted.length > 3 && (
        <div className="stage-card finale-rest-card">
          <h3>שאר המשתתפים המכובדים</h3>
          <div className="finale-rest-list">
            {sorted.slice(3).map((p, idx) => (
              <div key={p.id} className="finale-rest-row">
                <span>
                  #{idx + 4} <strong>{p.nickname}</strong>
                </span>
                <span className="finale-rest-pts">
                  {p.score} נק׳ (מנחש: {p.guesserScore} | יוצר: {p.creatorScore})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Masterpiece Gallery Toggle */}
      {!compact && history.length > 0 && (
        <div className="finale-gallery-section">
          <button
            type="button"
            className="btn-brutal btn-blue btn-lg"
            onClick={() => setShowGallery((v) => !v)}
          >
            <Images size={20} />
            <span>
              {showGallery
                ? 'הסתר גלריית יצירות'
                : `פתח את מוזיאון הערב (${history.length} יצירות)`}
            </span>
          </button>

          {showGallery && (
            <div className="masterpiece-gallery">
              {history.map((item) => (
                <article key={item.submissionId} className="gallery-card">
                  <div className="gallery-img-wrap">
                    <img src={item.imageData} alt={item.secretWord} loading="lazy" />
                    <span className="gallery-cat-badge">{item.category}</span>
                    <span className={`gallery-status-badge ${item.guessedCorrectly ? 'hit' : 'miss'}`}>
                      {item.guessedCorrectly ? (
                        <>
                          <CheckCircle2 size={13} /> נוחש בהצלחה
                        </>
                      ) : (
                        <>
                          <Clock size={13} /> לא נוחש
                        </>
                      )}
                    </span>
                  </div>
                  <div className="gallery-body">
                    <div className="gallery-word">{item.secretWord}</div>
                    <div className="gallery-meta">
                      <span>יוצר: {item.creatorNickname}</span>
                      {item.guesserNickname && <span>• מנחש: {item.guesserNickname}</span>}
                    </div>
                    {item.prompt && (
                      <blockquote className="gallery-prompt">״{item.prompt}״</blockquote>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
