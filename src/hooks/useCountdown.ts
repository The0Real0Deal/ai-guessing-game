import { useEffect, useState } from 'react';

export function useCountdown(
  timerEndsAt: string | null,
  timerPausedRemaining: number | null,
  totalSeconds: number
) {
  const computeRemaining = () => {
    if (timerEndsAt) {
      const diffMs = new Date(timerEndsAt).getTime() - Date.now();
      return Math.max(0, Math.ceil(diffMs / 1000));
    }
    if (timerPausedRemaining !== null && timerPausedRemaining !== undefined) {
      return Math.max(0, timerPausedRemaining);
    }
    return totalSeconds;
  };

  const [remaining, setRemaining] = useState<number>(computeRemaining);

  useEffect(() => {
    setRemaining(computeRemaining());
    if (!timerEndsAt) return;

    const id = window.setInterval(() => {
      const next = computeRemaining();
      setRemaining(next);
      if (next <= 0) {
        window.clearInterval(id);
      }
    }, 200);

    return () => window.clearInterval(id);
  }, [timerEndsAt, timerPausedRemaining, totalSeconds]);

  const isRunning = Boolean(timerEndsAt) && remaining > 0;
  const isUrgent = isRunning && remaining <= 10;
  const progressPct = totalSeconds > 0 ? Math.min(100, Math.max(0, (remaining / totalSeconds) * 100)) : 0;

  return { remaining, isRunning, isUrgent, progressPct };
}
