# PIPE UP

A no-login, real-time party game for teams. A host creates a room, shares one
link, everyone answers a silly question, answers are revealed together, people
vote on the best, and points ("Pile Points") get handed out. The whole point is
inclusion: no accounts, no seats, no licenses — anyone with the link plays.

Full game design, data model, and the Socket.IO event contract live in
@docs/GAME-SPEC.md. Read it before implementing game logic.

## Commands

- `npm install` — install deps
- `npm run dev` — local dev with auto-reload (nodemon)
- `npm start` — production start (`node server.js`); this is what Railway runs
- No test suite yet — v1 is being built; do not invent test commands

## Stack

- **Backend:** Node 20+, Express, Socket.IO. Source of truth lives server-side.
- **Frontend:** plain HTML/CSS/JS in `public/`, served statically by Express.
  NO build step, NO framework. The visual design already exists — see
  "Design" below. Do not rewrite it in React.
- **State:** in-memory only (a `Map` of rooms). NO database in v1.
- **Realtime:** Socket.IO. Server broadcasts the full room state on every
  change; clients render from it. Do not hand-roll diffing in v1.

## Project structure

```
server.js          Express + Socket.IO wiring, serves /public, binds process.env.PORT
lib/rooms.js       Room store + all game logic (phases, scoring, validation)
lib/codes.js       Room-code generation (short, unambiguous, no 0/O/1/I)
public/index.html  Landing page: create or join a room
public/room.html   The game room UI
public/styles.css  Design system (see Design)
public/app.js      Socket client + render-from-state
docs/GAME-SPEC.md  Authoritative game spec + event contract
```

## Conventions

- ES modules (`import`/`export`), not CommonJS.
- The server validates every action. Never trust the client (e.g. reject votes
  for your own answer, reject answers outside the write phase).
- Bind to `process.env.PORT` and `0.0.0.0` — Railway sets PORT for you.
- Keep game logic in `lib/rooms.js`, transport-agnostic and unit-testable.
  `server.js` should only translate socket events to/from those functions.
- Generate a `clientId` on the browser, store in `sessionStorage`, send it on
  join so refresh/reconnect re-seats the same player.

## v1 scope — do NOT build past this without being asked

- In-memory rooms only. Server restart drops sessions; that's acceptable for v1.
- Share-link only. No public lobby, no matchmaking, no auth, no profiles.
- Images are link-only (paste a URL). No file uploads.
- One host per room; the host advances the game phase.
- Abuse guards exist and are env-tunable: room/player caps, a per-IP create-room
  rate limit, oversize-field trimming, and an idle-room sweep. See @docs/OPERATIONS.md
  (covers both the in-app guards and the Railway $5 usage limit). Single replica only.

## Design

The look (warm cream, coral/sun/mint sticker cards, Shrikhand + DM Sans fonts)
is locked and loved. The reference implementation is in @docs/design-reference.html.
Port its CSS into `public/styles.css` verbatim as the design system; the user is
refining it separately in Claude Design, so treat colors/fonts/shadows as fixed
tokens unless told otherwise.
