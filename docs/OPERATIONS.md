# Operations — keeping Pipe Up cheap and abuse-resistant

Pipe Up keeps all state in memory on a single instance. That's perfect for "share
a link, play 20 minutes," but it means a flood of rooms is a RAM problem. We defend
in two layers: **in-app guards** (the primary defense — they keep cost near zero and
the game online) and a **Railway usage limit** (a last-resort wallet backstop).

## Layer 1 — in-app guards (already in the code)

All of these are tunable via environment variables, so you can adjust them in the
Railway dashboard (Variables tab) without a code change. Defaults are sane for a
small instance.

| Env var | Default | What it does |
|---|---|---|
| `MAX_ROOMS` | `200` | Hard cap on concurrent rooms. Creating past this is rejected. |
| `MAX_PLAYERS_PER_ROOM` | `40` | Hard cap on players in one room. |
| `MAX_IMG_LEN` | `500` | Trims pasted image-URL length (the only large free-text field). |
| `EMPTY_ROOM_GRACE_MS` | `1800000` (30 min) | A room with no connected players this long is deleted. |
| `ROOM_MAX_AGE_MS` | `3600000` (1 h) | Hard max age — any room older than this is deleted regardless. |
| `SWEEP_INTERVAL_MS` | `60000` (1 min) | How often the idle-room sweep runs. |
| `CREATE_LIMIT` | `10` | Rooms one IP may create per window. |
| `CREATE_WINDOW_MS` | `300000` (5 min) | The create-rate window. |

Notes:

- Room creation is a Socket.IO event, so the rate limit is enforced in `server.js`
  keyed on the client IP (we set `trust proxy` so Railway's `X-Forwarded-For` is read
  correctly).
- The idle sweep and the rate-limiter pruning run on the same timer; both maps are
  bounded so they can't themselves leak memory.
- `GET /healthz` returns `{ ok: true, rooms: <count> }` — handy for spotting an
  unexpected room pile-up.

## Layer 2 — Railway $5 wallet backstop

This can't be set in `railway.json` (it's a workspace setting, not a service one):

1. Railway dashboard → **Workspace Settings → Usage** → **Usage Limits**.
2. Set a **soft limit** (e.g. `$4`) — you get an email warning, nothing stops.
3. Set a **hard limit** (`$5`) — when reached, Railway **stops your services**.

The hard cap trades availability for cost: if it trips, the game goes offline until the
next cycle or until you raise it. That's why the in-app guards above are the real
defense — the $5 cap is just there so a worst case can never become an expensive case.

## Keep it to one replica

The room `Map` and the rate limiter live in process memory, so they're per-instance.
**Do not scale horizontally** — a second replica would split rooms and weaken the
limits. Multi-instance support means moving state to Redis (the spec's documented
upgrade path), which is out of v1 scope.
