// Express + Socket.IO wiring. This file is transport glue only: it translates
// socket events into lib/rooms.js calls and broadcasts the redacted room state.
// All game logic lives in lib/rooms.js.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import {
  getRoom, createRoom, joinRoom, setConnected, stateFor,
  setQuestion, submitAnswer, startReveal, startVote, castVote,
  showScores, nextRound,
} from './lib/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(PUBLIC));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
// Deep links to a room (the shared invite) all serve the game shell.
app.get('/r/:code', (_req, res) => res.sendFile(path.join(PUBLIC, 'room.html')));

// Emit a freshly redacted room_state to every socket in the room.
function broadcast(code) {
  const room = getRoom(code);
  if (!room) return;
  const ids = io.sockets.adapter.rooms.get(code);
  if (!ids) return;
  for (const sid of ids) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit('room_state', stateFor(room, sock.data.clientId));
  }
}

io.on('connection', (socket) => {
  // Wrap a host/player action: look up the room, run it, broadcast. Any thrown
  // validation error becomes an `error` toast for just this socket.
  const action = (fn) => (payload = {}) => {
    try {
      const room = getRoom(socket.data.code);
      if (!room) throw new Error('You are not in a room.');
      fn(room, socket.data.clientId, payload);
      broadcast(room.code);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  };

  socket.on('create_room', ({ clientId, name } = {}) => {
    try {
      const room = createRoom({ clientId, name });
      socket.data.clientId = clientId;
      socket.data.code = room.code;
      socket.join(room.code);
      broadcast(room.code);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('join_room', ({ clientId, name, code } = {}) => {
    try {
      const room = joinRoom({ clientId, name, code });
      socket.data.clientId = clientId;
      socket.data.code = room.code;
      socket.join(room.code);
      broadcast(room.code);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('set_question', action((room, id, p) => setQuestion(room, id, p)));
  socket.on('submit_answer', action((room, id, p) => submitAnswer(room, id, p)));
  socket.on('start_reveal', action((room, id) => startReveal(room, id)));
  socket.on('start_vote', action((room, id) => startVote(room, id)));
  socket.on('cast_vote', action((room, id, p) => castVote(room, id, p)));
  socket.on('show_scores', action((room, id) => showScores(room, id)));
  socket.on('next_round', action((room, id) => nextRound(room, id)));

  socket.on('disconnect', () => {
    const { clientId, code } = socket.data;
    if (clientId && code) {
      setConnected(clientId, code, false);
      broadcast(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Pipe Up listening on http://0.0.0.0:${PORT}`);
});
