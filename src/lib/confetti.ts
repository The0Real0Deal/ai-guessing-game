import confetti from 'canvas-confetti';

const PARTY_COLORS = ['#FF4D2D', '#FACC15', '#22C55E', '#2563EB', '#FB7185', '#111111'];

export function fireRevealConfetti() {
  confetti({
    particleCount: 85,
    spread: 75,
    origin: { y: 0.62 },
    colors: PARTY_COLORS,
  });

  setTimeout(() => {
    confetti({
      particleCount: 45,
      angle: 60,
      spread: 55,
      origin: { x: 0.1, y: 0.65 },
      colors: PARTY_COLORS,
    });
    confetti({
      particleCount: 45,
      angle: 120,
      spread: 55,
      origin: { x: 0.9, y: 0.65 },
      colors: PARTY_COLORS,
    });
  }, 180);
}

export function fireRoundLeaderboardConfetti() {
  confetti({
    particleCount: 60,
    spread: 90,
    origin: { y: 0.35 },
    colors: PARTY_COLORS,
  });
}

export function fireGrandFinaleConfetti(): () => void {
  const duration = 5500;
  const end = Date.now() + duration;
  let cancelled = false;

  const burst = () => {
    if (cancelled) return;
    confetti({
      particleCount: 16,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.7 },
      colors: PARTY_COLORS,
    });
    confetti({
      particleCount: 16,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.7 },
      colors: PARTY_COLORS,
    });

    if (Date.now() < end) {
      requestAnimationFrame(burst);
    }
  };

  // Opening golden blast
  confetti({
    particleCount: 140,
    spread: 110,
    origin: { y: 0.5 },
    colors: ['#FACC15', '#FF4D2D', '#22C55E', '#2563EB', '#FB7185'],
    scalar: 1.15,
  });

  const frameTimer = window.setTimeout(burst, 250);

  return () => {
    cancelled = true;
    window.clearTimeout(frameTimer);
  };
}
