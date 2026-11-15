(() => {
  const socket = io();

  const SAMPLE_WORDS = [
    'חתול מרכיב משקפי שמש',
    'רובוט שותה קפה בבוקר',
    'פיצה מרחפת בחלל',
    'דרקון ישן על ספה',
    'אסטרונאוט גולש על גלים',
    'פיל מנגן בפסנתר',
    'מגדל אייפל משוקולד',
    'כלב נוהג במכונית ספורט',
    'דג זהב בתוך נורה',
    'טירה מרחפת בעננים',
    'ינשוף קורא עיתון',
    'קקטוס לובש כובע קאובוי',
  ];

  // Local client state
  let role = null; // 'host' | 'player'
  let roomCode = null;
  let playerId = null;
  let lastRevealedState = false;

  // DOM helpers
  const $ = (id) => document.getElementById(id);
  const views = document.querySelectorAll('.view');

  function showView(viewId) {
    views.forEach((v) => v.classList.remove('active'));
    const target = $(viewId);
    if (target) target.classList.add('active');
  }

  function showError(elId, msg) {
    const el = $(elId);
    if (!el) return;
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }

  function updateTopBar(code, roundText) {
    const bar = $('top-bar');
    if (!code) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    $('top-room-badge').classList.remove('hidden');
    $('top-room-code').textContent = code;
    if (roundText) {
      $('top-round-badge').classList.remove('hidden');
      $('top-round-text').textContent = roundText;
    } else {
      $('top-round-badge').classList.add('hidden');
    }
  }

  function triggerConfetti() {
    const layer = $('confetti-layer');
    const colors = ['#E85D3F', '#0D9488', '#D97706', '#3B82F6', '#F43F5E', '#10B981'];
    for (let i = 0; i < 55; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.45}s`;
      piece.style.width = `${8 + Math.random() * 8}px`;
      piece.style.height = `${8 + Math.random() * 8}px`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 3000);
    }
  }

  function updateWordCountHint() {
    const lines = $('input-word-pool')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    $('word-count-hint').textContent = `${lines.length} ביטויים ברשימה`;
  }

  // Initialize default sample words
  $('input-word-pool').value = SAMPLE_WORDS.join('\n');
  updateWordCountHint();
  $('input-word-pool').addEventListener('input', updateWordCountHint);

  $('btn-load-sample-words').addEventListener('click', () => {
    $('input-word-pool').value = SAMPLE_WORDS.join('\n');
    updateWordCountHint();
  });

  // Landing Navigation
  $('btn-choose-host').addEventListener('click', () => {
    role = 'host';
    showView('view-host-setup');
  });

  $('btn-choose-player').addEventListener('click', () => {
    role = 'player';
    showView('view-player-join');
  });

  $('btn-back-from-setup').addEventListener('click', () => {
    role = null;
    showView('view-landing');
  });

  $('btn-back-from-join').addEventListener('click', () => {
    role = null;
    showView('view-landing');
  });

  // Host: Create Room
  $('form-create-room').addEventListener('submit', (e) => {
    e.preventDefault();
    showError('setup-error', '');
    const wordPool = $('input-word-pool')
      .value.split('\n')
      .map((w) => w.trim())
      .filter(Boolean);
    const rounds = Number($('input-rounds').value) || 3;
    const timerSeconds = Number($('input-timer').value) || 60;

    if (wordPool.length === 0) {
      showError('setup-error', 'אנא הזינו לפחות מילה או ביטוי אחד.');
      return;
    }

    $('btn-create-room').disabled = true;
    socket.emit('host:create_room', { wordPool, rounds, timerSeconds }, (res) => {
      $('btn-create-room').disabled = false;
      if (!res?.ok) {
        showError('setup-error', res?.error || 'שגיאה ביצירת החדר');
        return;
      }
      roomCode = res.roomCode;
      sessionStorage.setItem('game_role', 'host');
      sessionStorage.setItem('game_room', roomCode);
      renderHostState(res.state);
      fetchQRCode(roomCode);
    });
  });

  async function fetchQRCode(code) {
    try {
      const joinUrl = `${window.location.origin}/?room=${code}`;
      const resp = await fetch(`/api/qr?url=${encodeURIComponent(joinUrl)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.dataUrl) {
        $('lobby-qr-img').src = data.dataUrl;
        $('lobby-qr-wrap').classList.remove('hidden');
      }
    } catch {
      // Optional enhancement; ignore if fails
    }
  }

  // Host: Start Game
  $('btn-start-game').addEventListener('click', () => {
    showError('lobby-error', '');
    socket.emit('host:start_game', { roomCode }, (res) => {
      if (!res?.ok) {
        showError('lobby-error', res?.error || 'לא ניתן להתחיל את המשחק');
      }
    });
  });

  // Host: Guessed Correctly! (ניחשו נכון!)
  $('btn-guessed-correctly').addEventListener('click', () => {
    socket.emit('host:guessed_correctly', { roomCode });
  });

  // Host: Next Image (עבור לתמונה הבאה)
  $('btn-next-image').addEventListener('click', () => {
    socket.emit('host:next_image', { roomCode });
  });

  // Host: Play Again
  $('btn-play-again').addEventListener('click', () => {
    socket.emit('host:play_again', { roomCode });
  });

  // Player: Join Room
  $('form-join-room').addEventListener('submit', (e) => {
    e.preventDefault();
    showError('join-error', '');
    const code = $('input-join-code').value.trim();
    const nickname = $('input-join-nickname').value.trim();

    if (!/^\d{4}$/.test(code)) {
      showError('join-error', 'קוד החדר חייב להיות בן 4 ספרות.');
      return;
    }
    if (!nickname) {
      showError('join-error', 'יש להזין כינוי.');
      return;
    }

    $('btn-join-room').disabled = true;
    socket.emit('player:join_room', { roomCode: code, nickname }, (res) => {
      $('btn-join-room').disabled = false;
      if (!res?.ok) {
        showError('join-error', res?.error || 'לא ניתן להצטרף לחדר');
        return;
      }
      roomCode = code;
      playerId = res.playerId;
      sessionStorage.setItem('game_role', 'player');
      sessionStorage.setItem('game_room', roomCode);
      sessionStorage.setItem('game_player_id', playerId);
      renderPlayerState(res.state);
    });
  });

  // Player: Generate Image (צור תמונה)
  $('btn-generate-image').addEventListener('click', () => {
    showError('player-prompt-error', '');
    const prompt = $('input-ai-prompt').value.trim();
    if (!prompt) {
      showError('player-prompt-error', 'כתבו תיאור (Prompt) ליצירת התמונה.');
      return;
    }

    $('btn-generate-image').disabled = true;
    $('player-image-preview-wrap').classList.remove('hidden');
    $('player-generating-overlay').classList.remove('hidden');

    socket.emit('player:generate_image', { roomCode, playerId, prompt }, (res) => {
      $('btn-generate-image').disabled = false;
      $('player-generating-overlay').classList.add('hidden');
      if (!res?.ok) {
        showError('player-prompt-error', res?.error || 'שגיאה ביצירת התמונה');
        return;
      }
      $('player-generated-image').src = res.imageUrl;
      $('btn-player-ready').classList.remove('hidden');
      $('player-ready-confirmed').classList.add('hidden');
    });
  });

  // Player: Ready (מוכן)
  $('btn-player-ready').addEventListener('click', () => {
    showError('player-prompt-error', '');
    $('btn-player-ready').disabled = true;
    socket.emit('player:mark_ready', { roomCode, playerId }, (res) => {
      $('btn-player-ready').disabled = false;
      if (!res?.ok) {
        showError('player-prompt-error', res?.error || 'שגיאה בסימון מוכן');
        return;
      }
      $('btn-player-ready').classList.add('hidden');
      $('player-ready-confirmed').classList.remove('hidden');
    });
  });

  // Render Host Main Screen State
  function renderHostState(state) {
    if (!state) return;
    const roundText =
      state.phase === 'lobby'
        ? null
        : `${state.currentRound}/${state.totalRounds}`;
    updateTopBar(state.roomCode, roundText);

    if (state.phase === 'lobby') {
      lastRevealedState = false;
      showView('view-host-lobby');
      $('lobby-room-code').textContent = state.roomCode;
      const connectedPlayers = state.players.filter((p) => p.connected);
      $('lobby-player-count').textContent = connectedPlayers.length;
      $('btn-start-game').disabled = connectedPlayers.length < 1;

      const listEl = $('lobby-players-list');
      if (connectedPlayers.length === 0) {
        listEl.innerHTML = '<div class="empty-state">ממתינים לשחקנים שיצטרפו מהטלפונים...</div>';
      } else {
        listEl.innerHTML = connectedPlayers
          .map(
            (p) => `
            <div class="player-chip">
              <span class="player-avatar">${escapeHtml(p.nickname.charAt(0).toUpperCase())}</span>
              <span>${escapeHtml(p.nickname)}</span>
            </div>`
          )
          .join('');
      }
      return;
    }

    if (state.phase === 'prompting') {
      lastRevealedState = false;
      showView('view-host-prompting');
      const connectedPlayers = state.players.filter((p) => p.connected);
      $('host-prompting-players').innerHTML = connectedPlayers
        .map((p) => {
          let badgeClass = 'writing';
          let badgeText = 'כותב תיאור...';
          if (p.isReady) {
            badgeClass = 'ready';
            badgeText = 'מוכן ✓';
          } else if (p.isGenerating) {
            badgeClass = 'generating';
            badgeText = 'יוצר תמונה...';
          }
          return `
            <div class="status-card ${p.isReady ? 'is-ready' : ''}">
              <span class="status-card-name">${escapeHtml(p.nickname)}</span>
              <span class="status-badge ${badgeClass}">${badgeText}</span>
            </div>`;
        })
        .join('');
      return;
    }

    if (state.phase === 'guessing') {
      showView('view-host-guessing');
      const g = state.currentGuess;
      if (!g) return;

      $('guess-index').textContent = g.index + 1;
      $('guess-total').textContent = g.total;
      $('guess-image').src = g.imageUrl;
      updateTimerUI(state.timerRemaining);

      if (g.revealed) {
        $('guess-reveal-banner').classList.remove('hidden');
        $('reveal-word-text').textContent = g.word || '';
        $('reveal-creator-name').textContent = g.nickname || '';
        $('reveal-prompt-text').textContent = g.prompt ? `התיאור: "${g.prompt}"` : '';
        $('btn-guessed-correctly').disabled = true;

        if (!lastRevealedState) {
          lastRevealedState = true;
          triggerConfetti();
        }
      } else {
        lastRevealedState = false;
        $('guess-reveal-banner').classList.add('hidden');
        $('btn-guessed-correctly').disabled = false;
      }
      return;
    }

    if (state.phase === 'summary') {
      lastRevealedState = false;
      showView('view-host-summary');
      triggerConfetti();

      const sorted = [...state.players].sort((a, b) => b.score - a.score);
      $('summary-leaderboard').innerHTML = sorted
        .map(
          (p, i) => `
          <li class="leaderboard-item">
            <span>${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${escapeHtml(p.nickname)}</span>
            <span>${p.score} נק׳</span>
          </li>`
        )
        .join('');

      $('summary-gallery').innerHTML = (state.history || [])
        .map(
          (item) => `
          <div class="gallery-item">
            <img src="${item.imageUrl}" alt="${escapeHtml(item.word)}" />
            <div class="gallery-caption">
              <strong>${escapeHtml(item.word)}</strong>
              <span>${escapeHtml(item.nickname)} ${item.guessedCorrectly ? '✅' : '⏱️'}</span>
            </div>
          </div>`
        )
        .join('');
    }
  }

  // Render Player Phone State
  function renderPlayerState(state) {
    if (!state) return;
    const roundText =
      state.phase === 'lobby'
        ? null
        : `${state.currentRound}/${state.totalRounds}`;
    updateTopBar(state.roomCode, roundText);

    const p = state.player;
    if (!p) return;

    if (state.phase === 'lobby') {
      showView('view-player-lobby');
      $('player-lobby-name').textContent = p.nickname;
      return;
    }

    if (state.phase === 'prompting') {
      showView('view-player-prompting');
      $('player-secret-word').textContent = p.currentWord || '---';

      // Sync prompt box only if empty or new round
      if (!p.prompt && $('input-ai-prompt').value && !p.imageUrl && !p.isGenerating) {
        $('input-ai-prompt').value = '';
      } else if (p.prompt && !$('input-ai-prompt').value) {
        $('input-ai-prompt').value = p.prompt;
      }

      if (p.isGenerating) {
        $('player-image-preview-wrap').classList.remove('hidden');
        $('player-generating-overlay').classList.remove('hidden');
        $('btn-generate-image').disabled = true;
      } else {
        $('player-generating-overlay').classList.add('hidden');
        $('btn-generate-image').disabled = p.isReady;
      }

      if (p.imageUrl) {
        $('player-image-preview-wrap').classList.remove('hidden');
        $('player-generated-image').src = p.imageUrl;
      } else {
        $('player-image-preview-wrap').classList.add('hidden');
      }

      if (p.isReady) {
        $('btn-player-ready').classList.add('hidden');
        $('player-ready-confirmed').classList.remove('hidden');
        $('input-ai-prompt').disabled = true;
      } else {
        $('player-ready-confirmed').classList.add('hidden');
        $('input-ai-prompt').disabled = false;
        if (p.imageUrl) {
          $('btn-player-ready').classList.remove('hidden');
        } else {
          $('btn-player-ready').classList.add('hidden');
        }
      }
      return;
    }

    if (state.phase === 'guessing') {
      showView('view-player-guessing');
      $('player-current-score').textContent = p.score;
      return;
    }

    if (state.phase === 'summary') {
      showView('view-player-summary');
      $('player-final-score').textContent = p.score;
      $('player-summary-leaderboard').innerHTML = (state.leaderboard || [])
        .map(
          (item, i) => `
          <li class="leaderboard-item">
            <span>${i === 0 ? '🥇 ' : ''}${escapeHtml(item.nickname)}</span>
            <span>${item.score} נק׳</span>
          </li>`
        )
        .join('');
    }
  }

  function updateTimerUI(remaining) {
    const valEl = $('guess-timer-value');
    const pillEl = $('guess-timer-box');
    if (!valEl || !pillEl) return;
    valEl.textContent = remaining;
    if (remaining <= 10) {
      pillEl.classList.add('urgent');
    } else {
      pillEl.classList.remove('urgent');
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Socket listeners
  socket.on('host:state', (state) => {
    if (role === 'host') renderHostState(state);
  });

  socket.on('player:state', (state) => {
    if (role === 'player') renderPlayerState(state);
  });

  socket.on('timer:tick', ({ remaining }) => {
    if (role === 'host') updateTimerUI(remaining);
  });

  // Check URL query param (?room=1234) or sessionStorage reconnect
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room');
  if (urlRoom && /^\d{4}$/.test(urlRoom)) {
    role = 'player';
    $('input-join-code').value = urlRoom;
    showView('view-player-join');
  } else {
    const savedRole = sessionStorage.getItem('game_role');
    const savedRoom = sessionStorage.getItem('game_room');
    const savedPlayerId = sessionStorage.getItem('game_player_id');

    if (savedRole === 'host' && savedRoom) {
      socket.emit('host:reconnect', { roomCode: savedRoom }, (res) => {
        if (res?.ok) {
          role = 'host';
          roomCode = savedRoom;
          renderHostState(res.state);
          fetchQRCode(savedRoom);
        }
      });
    } else if (savedRole === 'player' && savedRoom && savedPlayerId) {
      socket.emit('player:join_room', { roomCode: savedRoom, playerId: savedPlayerId }, (res) => {
        if (res?.ok) {
          role = 'player';
          roomCode = savedRoom;
          playerId = res.playerId;
          renderPlayerState(res.state);
        }
      });
    }
  }
})();
