// Room store + all game logic for Pipe Up.
//
// This module is transport-agnostic and unit-testable: it knows nothing about
// sockets. server.js translates socket events into these calls and broadcasts
// the redacted state returned by stateFor(). The server is the source of truth.
//
// See docs/GAME-SPEC.md for the authoritative phase flow, data model and
// scoring rules.

import { generateCode } from './codes.js';

// v1 decision (GAME-SPEC §reveal): answers are shown anonymously through reveal
// and vote. Flip this one flag to attach author names immediately instead.
export const REVEAL_ANONYMOUS = true;

const MAX_NAME = 18;

// code -> Room. In-memory only; a restart drops every room (accepted for v1).
const rooms = new Map();

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

// ── helpers ──────────────────────────────────────────────────────────────

function fail(message) {
  throw new Error(message);
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, MAX_NAME);
  return n || 'Anon';
}

function requireHost(room, clientId) {
  if (room.hostId !== clientId) fail('Only the host can do that.');
}

function requirePhase(room, phase) {
  if (room.phase !== phase) fail(`Can't do that right now.`);
}

function nameOf(room, pid) {
  const p = room.players.find((x) => x.id === pid);
  return p ? p.name : 'Someone';
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function voteCounts(round) {
  const counts = {};
  for (const answerPid of Object.values(round.votes)) {
    counts[answerPid] = (counts[answerPid] || 0) + 1;
  }
  return counts;
}

// During reveal/vote answers are anonymised behind opaque ids ("a0","a1"…).
// The client votes with that token; the server maps it back to a real player.
function resolveAnswerId(round, value) {
  if (value == null) return null;
  const v = String(value);
  const m = /^a(\d+)$/.exec(v); // strict token: 'a' + digits only
  if (m) {
    const i = Number(m[1]);
    const order = round.order || Object.keys(round.answers);
    if (order[i] != null) return order[i];
  }
  // Fallback: a raw playerId (used when REVEAL_ANONYMOUS is false).
  if (round.answers[v]) return v;
  return null;
}

// ── room lifecycle ─────────────────────────────────────────────────────────

export function createRoom({ clientId, name }) {
  if (!clientId) fail('Missing clientId.');
  const code = generateCode((c) => rooms.has(c));
  const room = {
    code,
    hostId: clientId,
    phase: 'lobby',
    players: [
      { id: clientId, name: cleanName(name), score: 0, streak: 0, connected: true },
    ],
    round: null,
    roundNumber: 0,
    lastResults: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom({ clientId, name, code }) {
  if (!clientId) fail('Missing clientId.');
  const room = getRoom(code);
  if (!room) fail('No room with that code.');
  const existing = room.players.find((p) => p.id === clientId);
  if (existing) {
    // Reconnect: reuse the seat (and score/streak). Refresh name if provided.
    existing.connected = true;
    if (name) existing.name = cleanName(name);
  } else {
    room.players.push({
      id: clientId,
      name: cleanName(name),
      score: 0,
      streak: 0,
      connected: true,
    });
  }
  return room;
}

export function setConnected(clientId, code, connected) {
  const room = getRoom(code);
  if (!room) return null;
  const p = room.players.find((x) => x.id === clientId);
  if (p) p.connected = connected;
  return room;
}

// ── phase transitions (all host-driven except submit_answer / cast_vote) ────

// Start a round with a question. Valid from `lobby` (first round) and from
// `score` (the "new question" path on the scoreboard).
export function setQuestion(room, clientId, { text } = {}) {
  requireHost(room, clientId);
  if (room.phase !== 'lobby' && room.phase !== 'score') fail(`Can't set a question now.`);
  const question = String(text || '').trim();
  if (!question) fail('The question is empty.');
  room.roundNumber += 1;
  room.round = { question, askedBy: clientId, answers: {}, votes: {}, order: null };
  room.lastResults = null;
  room.phase = 'write';
  return room;
}

export function submitAnswer(room, clientId, { text, emoji, img } = {}) {
  requirePhase(room, 'write');
  const t = String(text || '').trim().slice(0, 180);
  const e = emoji || null;
  const im = String(img || '').trim() || null;
  if (!t && !e && !im) fail('Write something first.');
  // One answer per player; resubmit overwrites until reveal.
  room.round.answers[clientId] = { text: t, emoji: e, img: im };
  return room;
}

export function startReveal(room, clientId) {
  requireHost(room, clientId);
  requirePhase(room, 'write');
  room.round.order = shuffle(Object.keys(room.round.answers));
  room.phase = 'reveal';
  return room;
}

export function startVote(room, clientId) {
  requireHost(room, clientId);
  requirePhase(room, 'reveal');
  room.phase = 'vote';
  return room;
}

export function castVote(room, clientId, { answerPlayerId } = {}) {
  requirePhase(room, 'vote');
  const target = resolveAnswerId(room.round, answerPlayerId);
  if (!target) fail('No such answer.');
  if (target === clientId) fail("You can't vote for your own answer.");
  // Latest vote wins.
  room.round.votes[clientId] = target;
  return room;
}

export function showScores(room, clientId) {
  requireHost(room, clientId);
  requirePhase(room, 'vote');
  const results = scoreRound(room.round, room.players);
  for (const p of room.players) {
    p.score += results.points[p.id] || 0;
    if (results.streaks[p.id] != null) p.streak = results.streaks[p.id];
  }
  room.lastResults = results;
  room.phase = 'score';
  return room;
}

export function nextRound(room, clientId) {
  requireHost(room, clientId);
  requirePhase(room, 'score');
  // Back to the roster; the host picks a fresh question from there.
  room.round = null;
  room.lastResults = null;
  room.phase = 'lobby';
  return room;
}

// ── scoring — pure & testable (GAME-SPEC §scoring) ──────────────────────────

export function scoreRound(round, players) {
  const counts = voteCounts(round);
  const authors = Object.keys(round.answers);
  const points = {};
  const streaks = {};
  const events = [];

  // +1 Pile Point per vote received.
  for (const pid of authors) points[pid] = counts[pid] || 0;

  // +2 "Top of the Pile" to the most-voted answer(s). Ties all win.
  let max = 0;
  for (const pid of authors) max = Math.max(max, counts[pid] || 0);
  const winners = max > 0 ? authors.filter((pid) => (counts[pid] || 0) === max) : [];
  for (const pid of winners) {
    points[pid] += 2;
    events.push({ type: 'top', playerId: pid, value: 2 });
  }

  // Streaks: landing in the top on consecutive rounds. Bonus min(len-1, 3).
  // Anyone not in the top resets to 0.
  for (const p of players) {
    if (winners.includes(p.id)) {
      const len = (p.streak || 0) + 1;
      streaks[p.id] = len;
      const bonus = Math.min(len - 1, 3);
      if (bonus > 0) {
        points[p.id] = (points[p.id] || 0) + bonus;
        events.push({ type: 'streak', playerId: p.id, value: bonus });
      }
    } else {
      streaks[p.id] = 0;
    }
  }

  // Clean Sweep: every eligible voter (everyone but the author) picked the same
  // answer. Flat +3. Needs a real group (>= 2 eligible voters) to count.
  for (const pid of authors) {
    const eligible = players.filter((p) => p.id !== pid).map((p) => p.id);
    if (eligible.length < 2) continue;
    const forThis = eligible.filter((v) => round.votes[v] === pid).length;
    if (forThis === eligible.length) {
      points[pid] = (points[pid] || 0) + 3;
      events.push({ type: 'sweep', playerId: pid, value: 3 });
    }
  }

  // Every player gets an entry (0 if they didn't answer / got no votes).
  for (const p of players) if (points[p.id] == null) points[p.id] = 0;

  return { points, streaks, events };
}

// ── redaction — build the per-recipient view before emitting ────────────────
// Hiding happens HERE, on the server. Never ship spoilers and hide them in CSS.

export function stateFor(room, clientId) {
  const view = {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    you: clientId,
    isHost: room.hostId === clientId,
    anonymous: REVEAL_ANONYMOUS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      streak: p.streak,
      connected: p.connected,
    })),
    round: null,
    results: null,
  };

  const r = room.round;
  if (!r) return view;

  if (room.phase === 'write') {
    // Reveal only WHO has locked in (the live count), never the contents.
    view.round = {
      question: r.question,
      askedBy: r.askedBy,
      answeredIds: Object.keys(r.answers),
      answerCount: Object.keys(r.answers).length,
      youSubmitted: !!r.answers[clientId],
      yourAnswer: r.answers[clientId] || null,
    };
  } else if (room.phase === 'reveal' || room.phase === 'vote') {
    const order = r.order || Object.keys(r.answers);
    view.round = {
      question: r.question,
      askedBy: r.askedBy,
      answers: order.map((pid, i) => {
        const a = r.answers[pid];
        const item = {
          answerId: 'a' + i,
          text: a.text,
          emoji: a.emoji,
          img: a.img,
          isOwn: pid === clientId,
        };
        if (!REVEAL_ANONYMOUS) {
          item.playerId = pid;
          item.name = nameOf(room, pid);
        }
        return item;
      }),
      youVoted: !!r.votes[clientId],
      votedCount: Object.keys(r.votes).length,
      voterCount: room.players.length,
    };
  } else if (room.phase === 'score') {
    // Authors revealed, votes tallied.
    const order = r.order || Object.keys(r.answers);
    const counts = voteCounts(r);
    view.round = {
      question: r.question,
      askedBy: r.askedBy,
      answers: order.map((pid, i) => ({
        answerId: 'a' + i,
        playerId: pid,
        name: nameOf(room, pid),
        text: r.answers[pid].text,
        emoji: r.answers[pid].emoji,
        img: r.answers[pid].img,
        votes: counts[pid] || 0,
        isOwn: pid === clientId,
      })),
    };
    view.results = room.lastResults || null;
  }

  return view;
}
