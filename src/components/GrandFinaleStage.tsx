import { useEffect, useState } from 'react';
import { fireGrandFinaleConfetti } from '../lib/confetti';
import { computeSuperlatives, sortPlayersByScore } from '../lib/gameLogic';
import type { Player, RoundHistoryItem } from '../lib/types';

interface GrandFinaleStageProps {
  players: Player[];
  history: RoundHistoryItem[];
  compact?: boolean;
  highlightPlayerId?: string;
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

  useEffect(() => {
    const t1 = window.setTimeout(() => setRevealStep(1), 300);
    const t2 = window.setTimeout(() => setRevealStep(2), 950);
    const t3 = window.setTimeout(() => setRevealStep(3), 1650);
    const stopConfetti = !compact ? fireGrandFinaleConfetti() : () => {};

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      stopConfetti();
    };
  }, [compact]);

  const champNames = champions.map((c) => c.nickname).join(' ו-');

  return (
    <div className={`finale-stage ${compact ? 'is-compact' : ''}`}>
      <div className="finale-hero">
        <div className="crown-bounce" aria-hidden="true">👑</div>
        <div className="sticker-tag tag-yellow">הגמר הגדול! 🏆</div>
        <h1 className="finale-title">
          {isTie
            ? `תיקו אגדי בצמרת! ${champNames}!`
            : `${champNames} — אלוף/ת הערב!`}
        </h1>
        <p className="finale-roast">
          {topScore === 0
            ? 'טוב, כולם סיימו עם 0 נקודות... אז המנצח האמיתי של הערב הוא Gemini! 🤖'
            : isTie
            ? 'שני מוחות גאוניים (או סתם המון מזל) חולקים את הכתר עם כבוד אינסופי! 🎊'
            : `עם ${topScore} נקודות ומוח חד יותר מפרומפט של 500 מילה — תנו מחיאות כפיים סוערות! 👏🔥`}
        </p>
      </div>

      {/* Dramatic Podium */}
      {podium.length > 0 && (
        <div className="podium-grid">
          {/* Second Place */}
          {podium[1] && (
            <div className={`podium-slot slot-2 ${revealStep >= 2 ? 'revealed' : ''}`}>
              <div className="podium-avatar">{podium[1].avatar}</div>
              <div className="podium-name">
                {podium[1].nickname}
                {highlightPlayerId === podium[1].id && <span className="me-pill">את/ה</span>}
              </div>
              <div className="podium-score">{podium[1].score} נק׳</div>
              <div className="podium-pillar pillar-2">🥈 2</div>
            </div>
          )}

          {/* First Place */}
          <div className={`podium-slot slot-1 ${revealStep >= 3 ? 'revealed' : ''}`}>
            <div className="podium-crown" aria-hidden="true">👑</div>
            <div className="podium-avatar avatar-winner">{podium[0].avatar}</div>
            <div className="podium-name">
              {podium[0].nickname}
              {highlightPlayerId === podium[0].id && <span className="me-pill">את/ה</span>}
            </div>
            <div className="podium-score score-winner">{podium[0].score} נק׳</div>
            <div className="podium-pillar pillar-1">🥇 1</div>
          </div>

          {/* Third Place */}
          {podium[2] && (
            <div className={`podium-slot slot-3 ${revealStep >= 1 ? 'revealed' : ''}`}>
              <div className="podium-avatar">{podium[2].avatar}</div>
              <div className="podium-name">
                {podium[2].nickname}
                {highlightPlayerId === podium[2].id && <span className="me-pill">את/ה</span>}
              </div>
              <div className="podium-score">{podium[2].score} נק׳</div>
              <div className="podium-pillar pillar-3">🥉 3</div>
            </div>
          )}
        </div>
      )}

      {/* Humorous Superlative Awards */}
      {awards.length > 0 && (
        <div className="awards-grid">
          {awards.map((award) => (
            <div key={award.id} className="award-card">
              <div className="award-emoji" aria-hidden="true">{award.emoji}</div>
              <div className="award-title">{award.title}</div>
              <div className="award-winners">
                {award.winnerAvatars.map((av, i) => (
                  <span key={i} className="award-winner-chip">
                    {av} {award.winnerNames[i]}
                  </span>
                ))}
              </div>
              <div className="award-stat">{award.statLabel}</div>
              <div className="award-sub">{award.subtitle}</div>
            </div>
          ))}
        </div>
      )}

      {/* Full Standings */}
      {sorted.length > 3 && (
        <div className="stage-card finale-rest-card">
          <h3>שאר המשתתפים המכובדים</h3>
          <div className="finale-rest-list">
            {sorted.slice(3).map((p, idx) => (
              <div key={p.id} className="finale-rest-row">
                <span>
                  #{idx + 4} {p.avatar} <strong>{p.nickname}</strong>
                </span>
                <span className="finale-rest-pts">
                  {p.score} נק׳ (🔍 {p.guesserScore} | 🎨 {p.creatorScore})
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
            {showGallery
              ? '🙈 הסתר גלריית יצירות'
              : `🖼️ פתח את מוזיאון הערב (${history.length} יצירות)`}
          </button>

          {showGallery && (
            <div className="masterpiece-gallery">
              {history.map((item) => (
                <article key={item.submissionId} className="gallery-card">
                  <div className="gallery-img-wrap">
                    <img src={item.imageData} alt={item.secretWord} loading="lazy" />
                    <span className="gallery-cat-badge">{item.category}</span>
                    <span className={`gallery-status-badge ${item.guessedCorrectly ? 'hit' : 'miss'}`}>
                      {item.guessedCorrectly ? '✅ ניחשו!' : '😅 לא נוחש'}
                    </span>
                  </div>
                  <div className="gallery-body">
                    <div className="gallery-word">{item.secretWord}</div>
                    <div className="gallery-meta">
                      <span>🎨 {item.creatorAvatar} {item.creatorNickname}</span>
                      {item.guesserNickname && (
                        <span>🔍 {item.guesserAvatar} {item.guesserNickname}</span>
                      )}
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
