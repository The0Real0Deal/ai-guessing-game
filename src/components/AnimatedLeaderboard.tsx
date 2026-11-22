import { useEffect, useState } from 'react';
import { Flame, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { computeRankTrends } from '../lib/gameLogic';
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

  const trends = computeRankTrends(players);
  const maxScore = Math.max(1, ...trends.map((t) => t.player.score));
  const hasPrevRound = players.some((p) => p.prevScore > 0 || p.roundDelta > 0);

  return (
    <div className={`leaderboard-stage ${compact ? 'is-compact' : ''}`}>
      {roundNumber !== undefined && totalRounds !== undefined && !compact && (
        <div className="leaderboard-banner">
          <div className="sticker-tag tag-yellow">
            סיכום סיבוב {roundNumber} מתוך {totalRounds}
          </div>
          <h2 className="stage-heading">טבלת הניקוד החיה</h2>
          {commentary && <p className="witty-commentary">{commentary}</p>}
        </div>
      )}

      <ol className="animated-lb-list">
        {trends.map(({ player, currentRank, rankChange }, index) => {
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
              <div className="lb-rank">#{currentRank}</div>

              <div className="lb-avatar" aria-hidden="true">
                {player.avatar}
              </div>

              <div className="lb-body">
                <div className="lb-name-row">
                  <div className="lb-name-cluster">
                    <span className="lb-name">
                      {player.nickname}
                      {isMe && <span className="me-pill">את/ה</span>}
                    </span>

                    {/* Visual Rank Trend / Momentum Indicator */}
                    {hasPrevRound && (
                      <span
                        className={`trend-badge ${
                          rankChange > 0
                            ? 'trend-up'
                            : rankChange < 0
                            ? 'trend-down'
                            : player.roundDelta > 0
                            ? 'trend-momentum'
                            : 'trend-flat'
                        }`}
                        title={
                          rankChange > 0
                            ? `עלייה של ${rankChange} מקומות`
                            : rankChange < 0
                            ? `ירידה של ${Math.abs(rankChange)} מקומות`
                            : 'שומר על המיקום'
                        }
                      >
                        {rankChange > 0 ? (
                          <>
                            <TrendingUp size={13} strokeWidth={2.8} />
                            <span dir="ltr">+{rankChange}</span>
                          </>
                        ) : rankChange < 0 ? (
                          <>
                            <TrendingDown size={13} strokeWidth={2.8} />
                            <span dir="ltr">{rankChange}</span>
                          </>
                        ) : player.roundDelta > 0 ? (
                          <>
                            <Flame size={13} strokeWidth={2.6} />
                            <span>במומנטום</span>
                          </>
                        ) : (
                          <>
                            <Minus size={13} strokeWidth={2.8} />
                            <span>יציב</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="lb-score-group">
                    {player.roundDelta > 0 && (
                      <span className="delta-badge pop-in" dir="ltr">
                        +{player.roundDelta} בסיבוב
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
                    <span>מנחש: {player.guesserScore}</span>
                    <span>•</span>
                    <span>יוצר: {player.creatorScore}</span>
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
