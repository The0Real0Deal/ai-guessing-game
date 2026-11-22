import { useEffect, useRef, useState } from 'react';
import { getRoomSnapshot, subscribeToRoom } from '../lib/gameService';
import type { BroadcastEvent, RoomSnapshot } from '../lib/types';

export function useRoom(
  code: string | undefined,
  onEvent?: (event: BroadcastEvent) => void
) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(code));
  const [error, setError] = useState<string | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!code) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getRoomSnapshot(code)
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        if (!snap) {
          setError('החדר לא נמצא. בדקו שקוד החדר נכון או פתחו חדר חדש מלוח המארח.');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'שגיאה בטעינת החדר');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsub = subscribeToRoom(
      code,
      (fresh) => {
        if (!cancelled) {
          setSnapshot(fresh);
          setError(null);
          setLoading(false);
        }
      },
      (evt) => {
        if (!cancelled) onEventRef.current?.(evt);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [code]);

  return { snapshot, setSnapshot, loading, error };
}
