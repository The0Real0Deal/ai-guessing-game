import { useEffect, useState } from 'react';
import { sortPlayersByScore } from '../lib/gameLogic';
import type { Player } from '../lib/types';

interface AnimatedLeaderboardProps {
  players: Player[];
  commentary?: string;
  roundNumber?: number;
  totalRounds?: number;
  compact?: boolean;
  highlightPlayerId?: string;
}

export function AnimatedLeaderboard({
  players,
  commentary,
  roundNumber,
  totalRounds,
  compact = false,
  highlightPlayerId,
}: AnimatedLeaderboardProps) {
  const [animatedIn, setAnimatedIn] = useState(false);

  useEffect(() => {
    setAnimatedIn(false);
    const t = window.setTimeout(() => setAnimatedIn(true), 140);
    return () => window.clearTimeout(t);
  }, [roundNumber, players.map((p) => p.score).join(',')]);

  const sorted = sortPlayersByScore(players);
  const maxScore = Math.max(1, ...sorted.map((p) => p.score));

  const getRankBadge = (idx: number) => {
    if (idx === 0) return '🥇';
    if (idx === 1) return '🥈';
    if (idx === 2) return '🥉';
    return `#${idx + 1}`;
  };

  return (
    <div className={`leaderboard-stage ${compact ? 'is-compact' : ''}`}>
      {roundNumber !== undefined && totalRounds !== undefined && !compact && (
        <div className="leaderboard-banner">
          <div className="sticker-tag tag-yellow">סיכום סיבוב {roundNumber} מתוך {totalRounds} ⚡</div>
          <h2 className="stage-heading">טבלת הניקוד החיה</h2>
          {commentary && <p className="witty-commentary">{commentary}</p>}
        </div>
      )}

      <ol className="animated-lb-list">
        {sorted.map((player, index) => {
          const prevPct = Math.round((player.prevScore / maxScore) * 100);
          const nextPct = Math.round((player.score / maxScore) * 100);
          const barWidth = animatedIn ? Math.max(8, nextPct) : Math.max(8, prevPct);
          const isMe = highlightPlayerId && player.id === highlightPlayerId;

          return (
            <li
              key={player.id}
              className={`lb-row ${index === 0 ? 'is-leader' : ''} ${isMe ? 'is-me' : ''}`}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <div className="lb-rank">{getRankBadge(index)}</div>

              <div className="lb-avatar" aria-hidden="true">
                {player.avatar}
              </div>

              <div className="lb-body">
                <div className="lb-name-row">
                  <span className="lb-name">
                    {player.nickname}
                    {isMe && <span className="me-pill">את/ה</span>}
                  </span>

                  <div className="lb-score-group">
                    {player.roundDelta > 0 && (
                      <span className="delta-badge pop-in" dir="ltr">
                        +{player.roundDelta}
                      </span>
                    )}
                    <span className="lb-total-score">
                      <strong>{player.score}</strong> נק׳
                    </span>
                  </div>
                </div>

                <div className="lb-bar-track">
                  <div
                    className={`lb-bar-fill rank-color-${Math.min(index, 3)}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                {!compact && (
                  <div className="lb-substats">
                    <span>🔍 מנחש: {player.guesserScore}</span>
                    <span>•</span>
                    <span>🎨 יוצר: {player.creatorScore}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
