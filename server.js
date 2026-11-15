const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const localtunnel = require('localtunnel');
const { generateAIImage } = require('./imageGenerator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

let activeTunnel = null;
let publicTunnelUrl = null;
let publicTunnelPassword = null;

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory rooms store
const rooms = new Map();

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateRoomCode() {
  let code;
  let attempts = 0;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
    attempts++;
  } while (rooms.has(code) && attempts < 100);
  return code;
}

function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function assignWordsForRound(room) {
  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
  const usedThisRound = new Set();

  for (const player of connectedPlayers) {
    if (room.unusedWords.length === 0) {
      // Refill pool excluding words already assigned in this round
      const candidates = room.settings.wordPool.filter((w) => !usedThisRound.has(w));
      room.unusedWords = shuffle(candidates.length > 0 ? candidates : room.settings.wordPool);
    }

    // Pick a word not yet used in this round if possible
    let idx = room.unusedWords.findIndex((w) => !usedThisRound.has(w));
    if (idx === -1) idx = 0;
    const [word] = room.unusedWords.splice(idx, 1);

    usedThisRound.add(word);
    player.currentWord = word;
    player.prompt = '';
    player.imageUrl = null;
    player.isReady = false;
    player.isGenerating = false;
  }
}

function stopTimer(room) {
  if (room.timer.intervalId) {
    clearInterval(room.timer.intervalId);
    room.timer.intervalId = null;
  }
  room.timer.running = false;
}

function startGuessTimer(room) {
  stopTimer(room);
  room.timer.remaining = room.settings.timerSeconds;
  room.timer.running = true;

  room.timer.intervalId = setInterval(() => {
    if (!rooms.has(room.roomCode)) {
      stopTimer(room);
      return;
    }
    if (room.timer.remaining > 0) {
      room.timer.remaining -= 1;
      io.to(room.roomCode).emit('timer:tick', {
        remaining: room.timer.remaining,
        total: room.settings.timerSeconds,
      });
    }
    if (room.timer.remaining <= 0) {
      stopTimer(room);
      io.to(room.roomCode).emit('timer:tick', {
        remaining: 0,
        total: room.settings.timerSeconds,
      });
    }
  }, 1000);
}

function buildMainScreenState(room) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    guessedOthersScore: p.guessedOthersScore || 0,
    creatorGuessedScore: p.creatorGuessedScore || 0,
    isReady: p.isReady,
    isGenerating: p.isGenerating,
    connected: p.connected,
  }));

  const connectedPlayers = players.filter((p) => p.connected);
  const allPlayersReady = connectedPlayers.length > 0 && connectedPlayers.every((p) => p.isReady);

  let currentGuess = null;
  if (room.phase === 'guessing' && room.guessingQueue[room.currentGuessIndex]) {
    const item = room.guessingQueue[room.currentGuessIndex];
    currentGuess = {
      index: room.currentGuessIndex,
      total: room.guessingQueue.length,
      imageUrl: item.imageUrl,
      guessedCorrectly: item.guessedCorrectly,
      revealed: item.revealed,
      // Only reveal creator, guesser, and original word once revealed === true
      ...(item.revealed
        ? {
            word: item.word,
            nickname: item.nickname,
            guesserNickname: item.guesserNickname || null,
            prompt: item.prompt,
          }
        : {}),
    };
  }

  return {
    roomCode: room.roomCode,
    phase: room.phase,
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
    timerSeconds: room.settings.timerSeconds,
    timerRemaining: room.timer.remaining,
    timerRunning: room.timer.running,
    allPlayersReady,
    players,
    currentGuess,
    history: room.phase === 'summary' ? room.history : [],
  };
}

function buildPlayerState(room, player) {
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
    timerRemaining: room.timer.remaining,
    player: {
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      guessedOthersScore: player.guessedOthersScore || 0,
      creatorGuessedScore: player.creatorGuessedScore || 0,
      currentWord: room.phase === 'prompting' ? player.currentWord : null,
      prompt: player.prompt,
      imageUrl: player.imageUrl,
      isReady: player.isReady,
      isGenerating: player.isGenerating,
    },
    leaderboard:
      room.phase === 'summary'
        ? Array.from(room.players.values())
            .map((p) => ({
              id: p.id,
              nickname: p.nickname,
              score: p.score,
              guessedOthersScore: p.guessedOthersScore || 0,
              creatorGuessedScore: p.creatorGuessedScore || 0,
            }))
            .sort((a, b) => b.score - a.score)
        : [],
  };
}

function broadcastRoomState(room) {
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('host:state', buildMainScreenState(room));
  }
  for (const player of room.players.values()) {
    if (player.connected && player.socketId) {
      io.to(player.socketId).emit('player:state', buildPlayerState(room, player));
    }
  }
}

function startGuessingPhase(room) {
  const readyItems = Array.from(room.players.values())
    .filter((p) => p.connected && p.imageUrl)
    .map((p) => ({
      round: room.currentRound,
      playerId: p.id,
      nickname: p.nickname,
      word: p.currentWord,
      prompt: p.prompt,
      imageUrl: p.imageUrl,
      guessedCorrectly: false,
      revealed: false,
    }));

  if (readyItems.length === 0) {
    return;
  }

  room.guessingQueue = shuffle(readyItems);
  room.currentGuessIndex = 0;
  room.phase = 'guessing';
  startGuessTimer(room);
  broadcastRoomState(room);
}

// QR Code endpoint for Lobby Screen
app.get('/api/qr', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(String(targetUrl), {
      width: 220,
      margin: 1,
      color: { dark: '#111111', light: '#FFFFFF' },
    });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// Network & Public Tunnel Info
app.get('/api/network-info', (req, res) => {
  res.json({
    localIp: getLocalIPv4(),
    port: PORT,
    publicUrl: publicTunnelUrl,
    tunnelPassword: publicTunnelPassword,
  });
});

app.post('/api/tunnel/start', async (req, res) => {
  try {
    if (publicTunnelUrl && activeTunnel) {
      return res.json({
        ok: true,
        publicUrl: publicTunnelUrl,
        tunnelPassword: publicTunnelPassword,
      });
    }

    const tunnel = await localtunnel({ port: Number(PORT) });
    activeTunnel = tunnel;
    publicTunnelUrl = tunnel.url;

    tunnel.on('close', () => {
      activeTunnel = null;
      publicTunnelUrl = null;
    });

    // Fetch public IP for localtunnel's one-time bypass password if needed
    try {
      const ipRes = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(4000),
      });
      if (ipRes.ok) {
        const ipData = await ipRes.json();
        publicTunnelPassword = ipData?.ip || null;
      }
    } catch {
      publicTunnelPassword = null;
    }

    res.json({
      ok: true,
      publicUrl: publicTunnelUrl,
      tunnelPassword: publicTunnelPassword,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'לא ניתן לפתוח קישור ציבורי כרגע. בדקו חיבור לאינטרנט או השתמשו ב-Wi-Fi המקומי.',
    });
  }
});

// Test Gemini API key for image generation
app.post('/api/test-gemini', async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'אנא הזינו מפתח Gemini API.' });
  }
  try {
    const result = await generateAIImage('cute orange cat wearing sunglasses', {
      geminiApiKey: apiKey,
    });
    if (result.provider.startsWith('Gemini') || result.provider.startsWith('Google')) {
      return res.json({ ok: true, provider: result.provider });
    }
    return res.json({
      ok: false,
      error: result.geminiError || 'המפתח לא הצליח לייצר תמונה ב-Gemini (המשחק ישתמש במנוע החינמי).',
      fallbackProvider: result.provider,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Socket.IO Real-time handlers
io.on('connection', (socket) => {
  // Host creates a room
  socket.on('host:create_room', (payload, cb) => {
    try {
      const rawWords = Array.isArray(payload?.wordPool) ? payload.wordPool : [];
      const wordPool = rawWords
        .map((w) => String(w).trim())
        .filter(Boolean);

      if (wordPool.length === 0) {
        return cb?.({ ok: false, error: 'יש להזין לפחות מילה או ביטוי אחד.' });
      }

      const rounds = Math.max(1, Math.min(20, Number(payload?.rounds) || 3));
      const timerSeconds = Math.max(10, Math.min(300, Number(payload?.timerSeconds) || 60));
      const geminiApiKey = String(payload?.geminiApiKey || '').trim();

      const roomCode = generateRoomCode();
      const room = {
        roomCode,
        hostSocketId: socket.id,
        settings: {
          wordPool,
          rounds,
          timerSeconds,
          geminiApiKey,
        },
        unusedWords: shuffle(wordPool),
        phase: 'lobby',
        currentRound: 1,
        players: new Map(),
        guessingQueue: [],
        currentGuessIndex: 0,
        timer: {
          remaining: timerSeconds,
          running: false,
          intervalId: null,
        },
        history: [],
      };

      rooms.set(roomCode, room);
      socket.join(roomCode);
      socket.data.role = 'host';
      socket.data.roomCode = roomCode;

      cb?.({ ok: true, roomCode, state: buildMainScreenState(room) });
    } catch (err) {
      cb?.({ ok: false, error: 'שגיאה ביצירת החדר.' });
    }
  });

  // Host reconnects
  socket.on('host:reconnect', ({ roomCode }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room) {
      return cb?.({ ok: false, error: 'החדר לא נמצא.' });
    }
    room.hostSocketId = socket.id;
    socket.join(room.roomCode);
    socket.data.role = 'host';
    socket.data.roomCode = room.roomCode;
    cb?.({ ok: true, state: buildMainScreenState(room) });
  });

  // Host starts the game
  socket.on('host:start_game', ({ roomCode }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room) return cb?.({ ok: false, error: 'החדר לא נמצא.' });
    if (room.hostSocketId !== socket.id) return cb?.({ ok: false, error: 'אין הרשאה.' });

    const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
    if (connectedPlayers.length < 1) {
      return cb?.({ ok: false, error: 'יש להמתין שלפחות שחקן אחד יצטרף לחדר.' });
    }

    room.currentRound = 1;
    room.history = [];
    for (const p of room.players.values()) {
      p.score = 0;
      p.guessedOthersScore = 0;
      p.creatorGuessedScore = 0;
    }
    assignWordsForRound(room);
    room.phase = 'prompting';
    broadcastRoomState(room);
    cb?.({ ok: true });
  });

  // Host decides when to reveal/show the generated images (Phase 1 -> Phase 2)
  socket.on('host:start_guessing', ({ roomCode }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.phase !== 'prompting') {
      return cb?.({ ok: false, error: 'לא ניתן לעבור לשלב הניחוש כעת.' });
    }
    if (room.hostSocketId !== socket.id) {
      return cb?.({ ok: false, error: 'אין הרשאה.' });
    }

    const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
    const allReady = connectedPlayers.length > 0 && connectedPlayers.every((p) => p.isReady);
    if (!allReady) {
      return cb?.({ ok: false, error: 'יש להמתין שכל השחקנים יסיימו ליצור תמונה וילחצו "מוכן".' });
    }

    startGuessingPhase(room);
    cb?.({ ok: true });
  });

  // Host clicks "Guessed Correctly!" (ניחשו נכון!) and picks who guessed it
  socket.on('host:guessed_correctly', ({ roomCode, guesserId }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.phase !== 'guessing') return cb?.({ ok: false });
    if (room.hostSocketId !== socket.id) return cb?.({ ok: false });

    const item = room.guessingQueue[room.currentGuessIndex];
    if (!item || item.revealed) return cb?.({ ok: false });

    const creator = room.players.get(item.playerId);
    const guesser = guesserId ? room.players.get(guesserId) : null;

    item.guessedCorrectly = true;
    item.revealed = true;
    item.guesserId = guesser ? guesser.id : null;
    item.guesserNickname = guesser ? guesser.nickname : null;
    stopTimer(room);

    // Creator gets +1 for their image being guessed
    if (creator) {
      creator.creatorGuessedScore = (creator.creatorGuessedScore || 0) + 1;
      creator.score = (creator.score || 0) + 1;
    }

    // Guesser gets +1 for guessing another player's image
    if (guesser && (!creator || guesser.id !== creator.id)) {
      guesser.guessedOthersScore = (guesser.guessedOthersScore || 0) + 1;
      guesser.score = (guesser.score || 0) + 1;
    }

    broadcastRoomState(room);
    cb?.({ ok: true });
  });

  // Host clicks "Next Image" (עבור לתמונה הבאה)
  socket.on('host:next_image', ({ roomCode }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.phase !== 'guessing') return cb?.({ ok: false });
    if (room.hostSocketId !== socket.id) return cb?.({ ok: false });

    const currentItem = room.guessingQueue[room.currentGuessIndex];
    if (currentItem) {
      room.history.push({ ...currentItem });
    }

    stopTimer(room);

    if (room.currentGuessIndex + 1 < room.guessingQueue.length) {
      room.currentGuessIndex += 1;
      startGuessTimer(room);
      broadcastRoomState(room);
      return cb?.({ ok: true });
    }

    // Round finished
    if (room.currentRound < room.settings.rounds) {
      room.currentRound += 1;
      assignWordsForRound(room);
      room.phase = 'prompting';
      broadcastRoomState(room);
    } else {
      room.phase = 'summary';
      broadcastRoomState(room);
    }
    cb?.({ ok: true });
  });

  // Host clicks Play Again
  socket.on('host:play_again', ({ roomCode }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room) return cb?.({ ok: false });
    if (room.hostSocketId !== socket.id) return cb?.({ ok: false });

    stopTimer(room);
    room.phase = 'lobby';
    room.currentRound = 1;
    room.guessingQueue = [];
    room.currentGuessIndex = 0;
    room.history = [];
    room.unusedWords = shuffle(room.settings.wordPool);
    for (const p of room.players.values()) {
      p.score = 0;
      p.guessedOthersScore = 0;
      p.creatorGuessedScore = 0;
      p.currentWord = null;
      p.prompt = '';
      p.imageUrl = null;
      p.isReady = false;
      p.isGenerating = false;
    }
    broadcastRoomState(room);
    cb?.({ ok: true });
  });

  // Player joins a room
  socket.on('player:join_room', ({ roomCode, nickname, playerId }, cb) => {
    const code = String(roomCode || '').trim();
    const cleanName = String(nickname || '').trim().slice(0, 24);
    const room = rooms.get(code);

    if (!room) {
      return cb?.({ ok: false, error: 'קוד חדר לא נמצא. בדקו את 4 הספרות ונסו שוב.' });
    }

    // Reconnection check
    if (playerId && room.players.has(playerId)) {
      const existing = room.players.get(playerId);
      existing.socketId = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.data.role = 'player';
      socket.data.roomCode = code;
      socket.data.playerId = playerId;
      broadcastRoomState(room);
      return cb?.({ ok: true, playerId, state: buildPlayerState(room, existing) });
    }

    if (!cleanName) {
      return cb?.({ ok: false, error: 'יש להזין כינוי כדי להצטרף.' });
    }

    if (room.phase !== 'lobby') {
      return cb?.({ ok: false, error: 'המשחק בחדר זה כבר התחיל.' });
    }

    const duplicateName = Array.from(room.players.values()).some(
      (p) => p.connected && p.nickname.toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicateName) {
      return cb?.({ ok: false, error: 'הכינוי הזה כבר תפוס בחדר. בחרו כינוי אחר.' });
    }

    const newPlayerId = generateId('plr');
    const player = {
      id: newPlayerId,
      socketId: socket.id,
      nickname: cleanName,
      score: 0,
      guessedOthersScore: 0,
      creatorGuessedScore: 0,
      currentWord: null,
      prompt: '',
      imageUrl: null,
      isReady: false,
      isGenerating: false,
      connected: true,
    };

    room.players.set(newPlayerId, player);
    socket.join(code);
    socket.data.role = 'player';
    socket.data.roomCode = code;
    socket.data.playerId = newPlayerId;

    broadcastRoomState(room);
    cb?.({ ok: true, playerId: newPlayerId, state: buildPlayerState(room, player) });
  });

  // Player generates an AI image
  socket.on('player:generate_image', async ({ roomCode, playerId, prompt }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.phase !== 'prompting') {
      return cb?.({ ok: false, error: 'לא ניתן ליצור תמונה בשלב זה.' });
    }
    const player = room.players.get(playerId);
    if (!player || player.socketId !== socket.id) {
      return cb?.({ ok: false, error: 'שחקן לא מזוהה.' });
    }

    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) {
      return cb?.({ ok: false, error: 'כתבו תיאור (Prompt) ליצירת התמונה.' });
    }

    player.isGenerating = true;
    player.isReady = false;
    player.prompt = cleanPrompt;
    broadcastRoomState(room);

    try {
      const result = await generateAIImage(cleanPrompt, {
        geminiApiKey: room.settings.geminiApiKey,
      });
      player.imageUrl = result.imageUrl;
      player.isGenerating = false;
      broadcastRoomState(room);
      cb?.({
        ok: true,
        imageUrl: result.imageUrl,
        provider: result.provider,
        geminiError: result.geminiError || null,
      });
    } catch (err) {
      player.isGenerating = false;
      broadcastRoomState(room);
      cb?.({ ok: false, error: 'אירעה שגיאה ביצירת התמונה. נסו שוב.' });
    }
  });

  // Player taps Ready (מוכן) — Host decides when to reveal images!
  socket.on('player:mark_ready', ({ roomCode, playerId }, cb) => {
    const room = rooms.get(String(roomCode || '').trim());
    if (!room || room.phase !== 'prompting') {
      return cb?.({ ok: false, error: 'לא ניתן לסמן מוכן בשלב זה.' });
    }
    const player = room.players.get(playerId);
    if (!player || player.socketId !== socket.id) {
      return cb?.({ ok: false, error: 'שחקן לא מזוהה.' });
    }
    if (!player.imageUrl) {
      return cb?.({ ok: false, error: 'יש ליצור תמונה לפני שמסמנים מוכן.' });
    }

    player.isReady = true;
    cb?.({ ok: true });
    broadcastRoomState(room);
  });

  // Handle disconnects gracefully
  socket.on('disconnect', () => {
    const { role, roomCode, playerId } = socket.data || {};
    if (!roomCode || !rooms.has(roomCode)) return;
    const room = rooms.get(roomCode);

    if (role === 'player' && playerId && room.players.has(playerId)) {
      const player = room.players.get(playerId);
      player.connected = false;
      broadcastRoomState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`AI Guessing Game server running on http://localhost:${PORT}`);
});
