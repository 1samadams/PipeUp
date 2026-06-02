// Throwaway end-to-end probe over real sockets. Boots the server in-process,
// connects two clients, walks a full round, and asserts redaction + scoring.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 8137;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 900));

const URL = `http://localhost:${PORT}`;
const mk = () => io(URL, { transports: ['websocket'], forceNew: true });

// Track the latest room_state each client sees.
function client(id) {
  const s = mk();
  const c = { s, id, state: null };
  s.on('room_state', (st) => { c.state = st; });
  s.on('error', (e) => console.log(`  [${id}] error:`, e.message));
  return c;
}
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  for (let i = 0; i < 50; i++) { if (fn()) return; await wait(40); }
  throw new Error('timeout waiting for: ' + label);
}

let failures = 0;
const ok = (label, cond) => { if (cond) { console.log('  ✓', label); } else { console.log('  ✗', label); failures++; } };

try {
  const host = client('host');
  const guest = client('guest');

  host.s.emit('create_room', { clientId: 'host', name: 'Hannah' });
  await until(() => host.state, 'host gets state');
  const code = host.state.code;
  ok('room code generated (4 chars)', /^[A-Z0-9]{4}$/.test(code));
  ok('host flagged isHost', host.state.isHost === true);

  guest.s.emit('join_room', { clientId: 'guest', name: 'Gary', code });
  await until(() => guest.state && guest.state.players.length === 2, 'guest joins');
  ok('guest is not host', guest.state.isHost === false);
  ok('roster has 2 players', host.state.players.length === 2);

  // guest tries to host-act -> rejected, no phase change
  guest.s.emit('set_question', { text: 'sneaky' });
  await wait(150);
  ok('non-host cannot set question', host.state.phase === 'lobby');

  host.s.emit('set_question', { text: 'Best snack?' });
  await until(() => host.state.phase === 'write', 'write phase');

  host.s.emit('submit_answer', { text: 'Pretzels', emoji: '🥨' });
  guest.s.emit('submit_answer', { text: 'Olives', emoji: '🫒' });
  await until(() => host.state.round && host.state.round.answerCount === 2, 'both answered');

  // REDACTION: during write, no answer text reaches the browser
  const writeBlob = JSON.stringify(host.state.round);
  ok('write phase hides others’ answer text', !writeBlob.includes('Olives'));
  ok('write phase exposes my own answer back to me', host.state.round.yourAnswer && host.state.round.yourAnswer.text === 'Pretzels');

  host.s.emit('start_reveal', {});
  await until(() => host.state.phase === 'reveal', 'reveal phase');
  ok('reveal sends answers', host.state.round.answers.length === 2);
  // REDACTION: anonymous -> no author names/ids in the answers
  const revBlob = JSON.stringify(host.state.round.answers);
  ok('reveal is anonymous (no playerId)', !revBlob.includes('guest') && !revBlob.includes('host'));
  ok('reveal marks own answer', host.state.round.answers.some((a) => a.isOwn));

  host.s.emit('start_vote', {});
  await until(() => host.state.phase === 'vote', 'vote phase');

  // self-vote rejection: host votes its own answerId
  const ownId = host.state.round.answers.find((a) => a.isOwn).answerId;
  const otherId = host.state.round.answers.find((a) => !a.isOwn).answerId;
  host.s.emit('cast_vote', { answerPlayerId: ownId });
  await wait(150);
  ok('self-vote rejected (no youVoted)', host.state.round.youVoted === false);

  host.s.emit('cast_vote', { answerPlayerId: otherId });
  const guestOther = guest.state.round.answers.find((a) => !a.isOwn).answerId;
  guest.s.emit('cast_vote', { answerPlayerId: guestOther });
  await until(() => host.state.round.votedCount === 2, 'both voted');

  host.s.emit('show_scores', {});
  await until(() => host.state.phase === 'score', 'score phase');
  // authors revealed now
  const scoreBlob = JSON.stringify(host.state.round.answers);
  ok('score phase reveals authors', scoreBlob.includes('Hannah') || scoreBlob.includes('Gary'));
  const total = host.state.players.reduce((a, p) => a + p.score, 0);
  ok('points were awarded', total > 0);

  host.s.emit('next_round', {});
  await until(() => host.state.phase === 'lobby', 'back to lobby');
  ok('scores persist across rounds', host.state.players.reduce((a, p) => a + p.score, 0) === total);

  host.s.close(); guest.s.close();
} catch (e) {
  console.error('INTEGRATION ERROR:', e.message);
  failures++;
} finally {
  srv.kill('SIGTERM');
  console.log(failures ? `\n${failures} checks FAILED` : '\nAll integration checks passed.');
  process.exit(failures ? 1 : 0);
}
