# PIPE UP — Game Spec & Realtime Contract

This is the authoritative spec for the game logic and the client/server
contract. CLAUDE.md points here. Implement game logic in `lib/rooms.js`.

## The loop (one round)

1. **lobby** — Host creates a room and gets a code + link (`/r/ABCD`). Players
   open the link, enter a display name. Anyone present can be seen in the
   roster. Host starts the round.
2. **write** — A question is shown. Every player submits exactly one answer
   (text, optional emoji, optional image URL). Host sees a live "answered N/M"
   count. Answers are hidden from everyone, including the host, in this phase.
3. **reveal** — Host clicks Reveal. All answers appear at once. **DECISION
   (v1 default): answers are shown anonymously here** — funnier, removes bias.
   *Alternative:* attach names immediately. Wire this as a single flag
   `REVEAL_ANONYMOUS = true` so it can be flipped in one line.
4. **vote** — Each player picks the best answer. **You cannot vote for your own.**
   One vote per player. Host sees "voted N/M".
5. **score** — Votes tallied. Authors revealed. Pile Points awarded (see below).
   Running leaderboard shown. Host clicks Next Round to return to **write** with
   a new question (or back to lobby).

## Scoring — "Pile Points"

Base points:

- **+1 Pile Point** for every vote your answer received.
- **+2 bonus** ("Top of the Pile") to the answer with the most votes. On a tie,
  every tied answer gets the bonus and the streak.

Silly escalation (the reason people play again). Keep to exactly these — do not
invent more bonus types in v1:

- **Streak.** Landing in the top (winning or tying for most votes) on
  consecutive rounds. Bonus = `min(streakLength - 1, 3)` extra points, so 2 in a
  row = +1, 3 = +2, 4+ = +3 (capped). Missing the top resets the streak to 0.
- **Combo: Unanimous ("Clean Sweep").** If every eligible voter (everyone except
  the author) voted for the same answer, that answer gets a flat **+3**.

Scoring stays a pure, testable function:

```
scoreRound(round, players) -> {
  points:  { [playerId]: pointsThisRound },   // base + bonuses
  streaks: { [playerId]: newStreakLength },    // 0 if they missed the top
  events:  Event[]                             // drives the frontend juice
}
// Event = { type: 'top'|'streak'|'sweep', playerId, value }
```

Leaderboard is the cumulative sum of `points` across all rounds in the room.

## Juice (frontend only — keep it muteable and lightweight)

The `events` array from `scoreRound` is what the score screen animates and sounds
off on. Constraints so this doesn't sprawl:

- A small set of short sound effects: vote-cast tick, reveal whoosh, win fanfare,
  streak escalation. Bundle them; no external CDN.
- **Browser autoplay:** sound only after a user gesture. The host pressing a
  button is the unlock — gate audio on first interaction, fail silent otherwise.
- A persistent **mute toggle** in the room UI (store in `sessionStorage`).
- Animations are CSS-only where possible. No heavy animation libraries in v1.
- This is the LAST thing to build (step 5+). It must not block a playable round.

## Data model (in memory)

```
Room {
  code: string            // e.g. "WXYZ"
  hostId: string          // clientId of the host
  phase: 'lobby'|'write'|'reveal'|'vote'|'score'
  players: Player[]
  round: Round | null     // the current round
  roundNumber: number
  createdAt: number
}

Player {
  id: string              // clientId from the browser
  name: string
  score: number           // cumulative Pile Points
  streak: number          // consecutive top finishes; 0 when broken
  connected: boolean
}

Round {
  question: string
  askedBy: string         // playerId
  answers: { [playerId]: { text, emoji, img } }
  votes:   { [voterId]: answerPlayerId }
}
```

## Socket.IO event contract

Principle: **the server is the source of truth and broadcasts the entire room
state (`room_state`) to the room on every change.** Clients are dumb renderers.
This is verbose but bug-resistant; optimize later if needed.

### Client → Server

| Event | Payload | Notes |
|---|---|---|
| `create_room` | `{ clientId, name }` | Creates room, caller becomes host. Server replies with `room_state`. |
| `join_room` | `{ clientId, name, code }` | Join existing room. Reuses seat if `clientId` already present (reconnect). Error if code unknown. |
| `set_question` | `{ text }` | Host only. Moves phase `lobby`→`write`. |
| `submit_answer` | `{ text, emoji, img }` | Write phase only. One per player; resubmit overwrites until reveal. |
| `start_reveal` | `{}` | Host only. `write`→`reveal`. |
| `start_vote` | `{}` | Host only. `reveal`→`vote`. |
| `cast_vote` | `{ answerPlayerId }` | Vote phase only. Reject self-votes and duplicates (latest wins is fine). |
| `show_scores` | `{}` | Host only. `vote`→`score`. Runs `scoreRound`, updates leaderboard. |
| `next_round` | `{}` | Host only. `score`→`write` (new round) — or `lobby`. |

### Server → Client

| Event | Payload | Notes |
|---|---|---|
| `room_state` | full `Room` (with per-recipient redaction) | Sent on every change. **Redact**: hide answer contents during `write`; hide author identities during `reveal`/`vote` if `REVEAL_ANONYMOUS`. Never send a player the data that would spoil the game. |
| `error` | `{ message }` | Bad code, wrong phase, self-vote, etc. Show as a toast. |

Redaction matters: do the hiding **on the server** before emitting. Don't send
the full answers/authors to the browser and hide them in CSS.

## Build order (suggested for Claude Code)

1. Scaffold: `package.json`, `server.js` serving `public/`, health check route.
2. `lib/codes.js` + `lib/rooms.js` with create/join + the phase state machine.
   Write a couple of plain assertions for `scoreRound` and self-vote rejection.
3. Socket wiring in `server.js`: events above, `room_state` broadcast + redaction.
4. Frontend: `index.html` (create/join) → `room.html` + `app.js` rendering each
   phase from `room_state`. Reuse the locked design tokens for everything.
5. Reconnect via `sessionStorage` clientId. Then deploy to Railway.

## Known v1 tradeoffs (accept, don't fix yet)

- In-memory state: a server restart or a second Railway instance loses/splits
  rooms. Fine for "share a link, play 20 minutes." Redis is the upgrade path.
- No rate limiting / abuse controls. It's a link you share with people you know.
- Last-write-wins on votes and answers; no locking.
