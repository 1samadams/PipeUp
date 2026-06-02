# Pipe Up

A no-login, real-time party game for teams. The host creates a room, shares one
link, everyone answers a silly question, answers are revealed together, people
vote on the best, and Pile Points get handed out. No accounts, no licenses —
anyone with the link plays.

## Run locally

```bash
npm install
npm run dev      # nodemon auto-reload on http://localhost:3000
# or
npm start        # production start (node server.js)
npm test         # scoring + validation assertions
```

Open `http://localhost:3000`, create a room, then open the room link in a second
browser (or incognito window) to play as another person.

## Stack

- **Backend:** Node 20+, Express, Socket.IO. The server is the source of truth;
  it broadcasts the full (redacted) room state on every change.
- **Frontend:** plain HTML/CSS/JS in `public/` — no build step, no framework.
- **State:** in-memory `Map` of rooms. No database in v1; a restart drops rooms.

```
server.js          Express + Socket.IO wiring, serves /public, binds process.env.PORT
lib/rooms.js       Room store + all game logic (phases, scoring, redaction)
lib/codes.js       Room-code generation (no 0/O/1/I)
lib/rooms.test.js  Plain-assertion scoring/validation tests
public/            Static client (index.html, room.html, app.js, styles.css)
docs/GAME-SPEC.md  Authoritative game spec + Socket.IO event contract
scripts/integration.mjs  Optional end-to-end socket probe (needs socket.io-client)
```

## Deploying to Railway

The app is Railway-ready out of the box — Nixpacks auto-detects Node from
`package.json`; there is no Dockerfile to maintain.

1. **Create a service** in a Railway project and connect this GitHub repo.
   Enable auto-deploy on your branch.
2. **Build & start** are automatic: Railway runs `npm install` then `npm start`
   (`node server.js`). Node 20+ is pinned via `engines` / `.nvmrc`.
3. **Port:** the server binds `process.env.PORT` and `0.0.0.0` — Railway injects
   `PORT`; do not hard-code one.
4. **Domain:** click **Generate Domain** to get a `*.up.railway.app` URL (or
   attach a custom domain). That URL is the share link players join.
5. **WebSockets** work out of the box. Keep this to **one instance** for v1:
   rooms live in memory, so a second instance would split state.
6. **Env vars:** none required for v1 (no database, no auth). `PORT` is provided
   automatically.

To verify a deploy: hit `/healthz` (returns `{"ok":true}`) and load the domain.
