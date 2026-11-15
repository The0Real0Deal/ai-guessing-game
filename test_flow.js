const { io } = require('socket.io-client');
const assert = require('assert');

const URL = 'http://localhost:3000';

function connectClient() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}

async function run() {
  const host = await connectClient();
  const p1 = await connectClient();
  const p2 = await connectClient();

  let hostState = null;
  let p1State = null;
  let p2State = null;

  host.on('host:state', (s) => (hostState = s));
  p1.on('player:state', (s) => (p1State = s));
  p2.on('player:state', (s) => (p2State = s));

  // 1. Host creates room
  const createRes = await emitAck(host, 'host:create_room', {
    wordPool: ['חתול בחלל', 'רובוט שותה קפה', 'פיצה מעופפת', 'דרקון ישן'],
    rounds: 1,
    timerSeconds: 45,
  });
  assert(createRes.ok, 'Room creation failed');
  const roomCode = createRes.roomCode;

  // 2. Players join
  const j1 = await emitAck(p1, 'player:join_room', { roomCode, nickname: 'נועה' });
  const j2 = await emitAck(p2, 'player:join_room', { roomCode, nickname: 'יוסי' });
  assert(j1.ok && j2.ok, 'Players failed to join');

  // 3. Start game
  const startRes = await emitAck(host, 'host:start_game', { roomCode });
  assert(startRes.ok, 'Start game failed');

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(hostState.phase, 'prompting');
  assert.notStrictEqual(p1State.player.currentWord, p2State.player.currentWord);

  // 4. Players generate images & mark ready
  await emitAck(p1, 'player:generate_image', {
    roomCode,
    playerId: j1.playerId,
    prompt: 'חתול עם קסדת אסטרונאוט בחלל',
  });
  await emitAck(p2, 'player:generate_image', {
    roomCode,
    playerId: j2.playerId,
    prompt: 'רובוט מחזיק ספל קפה חם',
  });

  await emitAck(p1, 'player:mark_ready', { roomCode, playerId: j1.playerId });
  await emitAck(p2, 'player:mark_ready', { roomCode, playerId: j2.playerId });

  await new Promise((r) => setTimeout(r, 100));
  // Should STAY in prompting until host decides to show images!
  assert.strictEqual(hostState.phase, 'prompting', 'Host should decide when to show images');
  assert.strictEqual(hostState.allPlayersReady, true, 'allPlayersReady should be true');

  // 5. Host starts guessing phase
  const sgRes = await emitAck(host, 'host:start_guessing', { roomCode });
  assert(sgRes.ok, 'Host start_guessing failed');

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(hostState.phase, 'guessing');
  assert.strictEqual(hostState.currentGuess.revealed, false);
  assert.strictEqual(hostState.currentGuess.word, undefined);

  // 6. Guessed correctly with guesserId
  await emitAck(host, 'host:guessed_correctly', {
    roomCode,
    guesserId: j1.playerId,
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(hostState.currentGuess.revealed, true);
  assert(hostState.currentGuess.word);
  assert(hostState.currentGuess.nickname);
  assert.strictEqual(hostState.currentGuess.guesserNickname, 'נועה');

  // 7. Next image -> then next image -> summary
  await emitAck(host, 'host:next_image', { roomCode });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(hostState.phase, 'guessing');

  await emitAck(host, 'host:next_image', { roomCode });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(hostState.phase, 'summary');

  host.close();
  p1.close();
  p2.close();
  console.log('ALL E2E GAME FLOW ASSERTIONS PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
