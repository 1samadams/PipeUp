// Plain-assertion smoke tests — no framework. Run with `npm test`.
import assert from 'node:assert/strict';
import {
  createRoom, joinRoom, setQuestion, submitAnswer, startReveal,
  startVote, castVote, showScores, scoreRound, stateFor,
} from './rooms.js';

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log('  ✓', label);
}

// — scoreRound: base points + Top of the Pile —
check('vote gives +1 each, top answer gets +2 bonus', () => {
  // 4 players, D abstains -> A leads but it isn't unanimous (no sweep).
  const players = [{ id: 'A', streak: 0 }, { id: 'B', streak: 0 }, { id: 'C', streak: 0 }, { id: 'D', streak: 0 }];
  const round = {
    answers: { A: { text: 'a' }, B: { text: 'b' } },
    votes: { B: 'A', C: 'A' }, // A gets 2 votes; D didn't vote
  };
  const { points, events } = scoreRound(round, players);
  assert.equal(points.A, 2 + 2); // 2 votes + top bonus, no sweep
  assert.equal(points.B, 0);
  assert.ok(!events.some((e) => e.type === 'sweep'));
});

// — scoreRound: ties both get the top bonus —
check('a tie for most votes gives every tied answer the +2', () => {
  const players = [{ id: 'A', streak: 0 }, { id: 'B', streak: 0 }, { id: 'C', streak: 0 }, { id: 'D', streak: 0 }];
  const round = {
    answers: { A: { text: 'a' }, B: { text: 'b' } },
    votes: { C: 'A', D: 'B' }, // 1 each
  };
  const { points, streaks } = scoreRound(round, players);
  assert.equal(points.A, 1 + 2);
  assert.equal(points.B, 1 + 2);
  assert.equal(streaks.A, 1);
  assert.equal(streaks.B, 1);
});

// — scoreRound: streak escalation, capped at +3 —
check('streak bonus is min(len-1, 3)', () => {
  const players = [{ id: 'A', streak: 3 }, { id: 'B', streak: 0 }];
  const round = { answers: { A: { text: 'a' }, B: { text: 'b' } }, votes: { B: 'A' } };
  const { points, streaks } = scoreRound(round, players);
  // 1 vote + 2 top + streak(4 -> min(3,3)=3)
  assert.equal(streaks.A, 4);
  assert.equal(points.A, 1 + 2 + 3);
  assert.equal(streaks.B, 0); // missed the top -> reset
});

// — scoreRound: Clean Sweep needs >= 3 eligible voters (4+ player room) —
check('unanimous vote of 3+ earns a +3 clean sweep', () => {
  const players = [{ id: 'A', streak: 0 }, { id: 'B', streak: 0 }, { id: 'C', streak: 0 }, { id: 'D', streak: 0 }];
  const round = { answers: { A: { text: 'a' }, B: { text: 'b' } }, votes: { B: 'A', C: 'A', D: 'A' } };
  const { points, events } = scoreRound(round, players);
  // A: 3 votes + 2 top + 3 sweep
  assert.equal(points.A, 3 + 2 + 3);
  assert.ok(events.some((e) => e.type === 'sweep' && e.playerId === 'A'));
});

// — scoreRound: a unanimous small group (only 2 voters) no longer sweeps —
check('two agreeing voters no longer trigger a clean sweep', () => {
  const players = [{ id: 'A', streak: 0 }, { id: 'B', streak: 0 }, { id: 'C', streak: 0 }];
  const round = { answers: { A: { text: 'a' }, B: { text: 'b' } }, votes: { B: 'A', C: 'A' } };
  const { points, events } = scoreRound(round, players);
  // A: 2 votes + 2 top, NO sweep
  assert.equal(points.A, 2 + 2);
  assert.ok(!events.some((e) => e.type === 'sweep'));
});

// — full flow + self-vote rejection —
check('self-vote is rejected by the server', () => {
  const room = createRoom({ clientId: 'A', name: 'Ann' });
  joinRoom({ clientId: 'B', name: 'Ben', code: room.code });
  setQuestion(room, 'A', { text: 'why?' });
  submitAnswer(room, 'A', { text: 'mine' });
  submitAnswer(room, 'B', { text: 'yours' });
  startReveal(room, 'A');
  startVote(room, 'A');
  // A's own answer is the first in shuffled order for A's own view... resolve
  // by raw playerId to force the self-vote path:
  assert.throws(() => castVote(room, 'A', { answerPlayerId: 'A' }), /your own/);
});

// — host-only guard —
check('non-host cannot advance the phase', () => {
  const room = createRoom({ clientId: 'A', name: 'Ann' });
  joinRoom({ clientId: 'B', name: 'Ben', code: room.code });
  assert.throws(() => setQuestion(room, 'B', { text: 'nope' }), /host/);
});

// — input hardening: bounded lengths + https-only images —
check('question text is capped at 200 chars', () => {
  const room = createRoom({ clientId: 'A', name: 'Ann' });
  setQuestion(room, 'A', { text: 'x'.repeat(5000) });
  assert.equal(room.round.question.length, 200);
});

check('answer text is capped and image must be https', () => {
  const room = createRoom({ clientId: 'A', name: 'Ann' });
  setQuestion(room, 'A', { text: 'q?' });
  // oversized text is truncated to 180
  submitAnswer(room, 'A', { text: 'y'.repeat(9999) });
  assert.equal(room.round.answers.A.text.length, 180);
  // a non-https (here, javascript:) image URL is dropped, not stored
  submitAnswer(room, 'A', { text: 'hi', img: 'javascript:alert(1)' });
  assert.equal(room.round.answers.A.img, null);
  // a well-formed https URL is kept
  submitAnswer(room, 'A', { text: 'hi', img: 'https://example.com/a.png' });
  assert.equal(room.round.answers.A.img, 'https://example.com/a.png');
});

// — identity: broadcast state exposes public pids, never the secret clientId —
check('stateFor never leaks a clientId (host-takeover guard)', () => {
  const room = createRoom({ clientId: 'secret-host', name: 'Host' });
  joinRoom({ clientId: 'secret-guest', name: 'Guest', code: room.code });
  const blob = JSON.stringify(stateFor(room, 'secret-guest'));
  assert.ok(!blob.includes('secret-host'), 'host clientId must not be broadcast');
  assert.ok(!blob.includes('secret-guest'), 'own clientId must not be broadcast');
  const view = stateFor(room, 'secret-guest');
  assert.ok(view.hostId && view.hostId.startsWith('p'), 'hostId is a public pid');
  assert.ok(view.you && view.you.startsWith('p'), 'you is a public pid');
  const ids = view.players.map((p) => p.id);
  assert.equal(new Set(ids).size, 2, 'players have distinct pids');
  assert.ok(ids.every((id) => id.startsWith('p')), 'player ids are public pids');
});

check('reconnect keeps the same public pid', () => {
  const room = createRoom({ clientId: 'h', name: 'H' });
  const before = stateFor(room, 'h').you;
  joinRoom({ clientId: 'h', name: 'H', code: room.code }); // reconnect, same clientId
  assert.equal(stateFor(room, 'h').you, before);
});

console.log(`\n${passed} checks passed.`);
