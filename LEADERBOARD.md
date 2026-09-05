# How the leaderboard works

A complete description of the leaderboard in Tower Obby, for somebody building
the same thing in another Decentraland scene. Every file:line reference points at
this repository.

Storage is **Decentraland's own Server Side Storage**. There is no Supabase, no
Firebase, no external database, no API key and no outbound HTTP anywhere in the
scene. The project has exactly two dependencies: `@dcl/sdk` and `@dcl/js-runtime`.

---

## The shape of it

```
   ┌──────────────────────────────────────────────────────────┐
   │  MULTIPLAYER SERVER  (headless, hosted by Decentraland)  │
   │                                                          │
   │   in memory:  board[]  scorers[]  wall[]  stats{}        │
   │        │                                    │            │
   │        │ publishBoard()                     │ every 8 s  │
   │        ▼                                    ▼            │
   │   synced components                    Storage.set()     │
   └────────┬────────────────────────────────────┬────────────┘
            │ Decentraland syncs automatically   │
            ▼                                    ▼
   ┌──────────────────┐              ┌───────────────────────┐
   │ EVERY CLIENT     │              │  Server Side Storage  │
   │ PC and phone     │              │  survives restarts    │
   │                  │              │  survives redeploys   │
   │ showBoard()      │              └───────────────────────┘
   │ writes TextShape │
   │ on a 3D monument │
   └──────────────────┘
```

Four pieces. Each is small.

---

## 1. The component — what gets shared

`src/shared/schemas.ts`

A board is two parallel arrays. Nothing clever, and deliberately flat: a synced
component re-sends its **whole** value on every change, so the cheapest shape is
the one with the least in it.

```ts
export const Board = engine.defineComponent('obby::board', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float)
})

export const PointsBoard = engine.defineComponent('obby::points', {
  names: Schemas.Array(Schemas.String),
  points: Schemas.Array(Schemas.Int)
})
```

**Only the server may write them** (`src/shared/schemas.ts:142`):

```ts
export function protectServerState() {
  if (!isServer()) return          // has no meaning on a client, errors there

  const serverOnly = (value: { senderAddress: string }) =>
    value.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()

  Board.validateBeforeChange(serverOnly)
  PointsBoard.validateBeforeChange(serverOnly)
  // ...all eleven synced components
}
```

Without this a client could write itself into first place and everyone would see
it. With it, the write is rejected before it leaves the machine that tried.

## 2. The server entity — one object carries every board

`src/server/server.ts:206`

One entity holds all the shared state. It is created and synced **only on the
server** — in an authoritative scene a client that calls `syncEntity` produces
errors and entity-id conflicts.

```ts
state = engine.addEntity()

Board.create(state, { names: [], seconds: [] })
PointsBoard.create(state, { names: [], points: [] })
// ...

syncEntity(state, [
  Board.componentId,
  PointsBoard.componentId,
  // ...
])
```

Publishing is then just writing to the component (`src/server/server.ts:808`):

```ts
function publishBoard() {
  const all = Board.getMutable(state)
  all.names = board.map((entry) => entry.name)
  all.seconds = board.map((entry) => entry.seconds)

  const ranked = PointsBoard.getMutable(state)
  ranked.names = scorers.map((entry) => entry.name)
  ranked.points = scorers.map((entry) => entry.points)
}
```

Nothing is sent to anybody. Decentraland delivers the change to every client in
the World by itself.

## 3. Storage — what survives

`Storage` comes from `@dcl/sdk/server` and is **server-only**.

| key | holds |
|---|---|
| `obby.board.v2` | the 10 fastest climbs ever |
| `obby.points.v1` | the lifetime points ranking |
| `obby.wall.v1` | names carved on the arch at the summit |
| `obby.pairs.v1` | times set by two people on the tandem plate |
| `obby.haul.v1` | how many coins have ever been taken out of the tower |
| `obby.stats.v1` | **per wallet**, via `Storage.player` |
| `obby.ghost.v1` | the recorded path of the record run |

```ts
await Storage.set(STORAGE_KEY, { version: 1, board })      // world-wide
await Storage.player.set(address, PLAYER_KEY, mine)        // per wallet
```

Per-player storage is keyed by the wallet the player logged in with, so there is
no sign-up, no password and no identity code to write. The server reads the
address from `context.from`, which it verified itself.

**Storage is scoped to the WORLD, not to the scene version.** A redeploy does not
clear it. That is why the boards survive every deploy, and why clearing one
player's history had to be done deliberately from the CLI.

### When it writes — and why not more often

Storage caps concurrent writes and **the excess resolves to `false` rather than
throwing**. A scene that writes on every change loses data silently.

So live state lives in memory and reaches the disk on a schedule:

- a dirty flag is set when something changes (`src/server/server.ts:918`)
- a debounced flush writes every 8 seconds (`flushStats`, `server.ts:929`)
- a finish writes immediately as well (`persistBoard`, `server.ts:1044`)
- **a failed write re-marks itself dirty and is retried on the next flush**

That last line matters more than it looks. A win is the busiest instant the
server has — three board writes, the finisher's stats, and any pending coin flush
— which is exactly when a capped write fails. Before the retry existed, the run
that earned a record was the run most likely to lose it.

### Reading it back

```ts
const stored = decoded<Stored>(await Storage.get<unknown>(STORAGE_KEY))
if (!stored || stored.version !== 1 || !Array.isArray(stored.board)) return
board = stored.board.filter(/* shape check every entry */).slice(0, BOARD_SIZE)
```

Versioned and defensively parsed from day one: storage outlives the code that
wrote it, so a future shape change will meet data written by an older build.

`decoded()` (`src/server/server.ts:970`) accepts both an object and a JSON string
— see the gotchas below for why that is not paranoia.

## 4. The client — a monument, not a HUD

`src/game/plaza.ts`

**The board is 3D geometry standing in the lobby.** Boxes for the frame and the
row stripes, `TextShape` for the text. There is not one UI element in the file.

This is the whole reason it behaves identically on a phone and a PC. A phone
renders the world; the board is part of the world. No layout to adapt, no font
scaling, no screen space to compete for. The HUD, which *was* real UI, is the
thing that had to be removed on mobile — the monument needed no such treatment.

Two further consequences worth knowing:

- **Text costs no material.** 57 text entities in this scene consume none of the
  400-material mobile budget. A leaderboard drawn as a texture would cost one
  material per state and would not fit at all.
- Rows are built **once** at scene load — ten empty label/value pairs. Updating
  the board rewrites `TextShape.text` on entities that already exist; nothing is
  created or destroyed at runtime.

The client side is four lines (`src/index.ts:336`):

```ts
const shown = Board.getOrNull(entity)
if (shown) {
  const ranked = PointsBoard.getOrNull(entity)
  showBoard(
    shown.names.map((name, i) => ({ name, seconds: shown.seconds[i] ?? 0 })),
    (ranked?.names ?? []).map((name, i) => ({ name, points: ranked?.points[i] ?? 0 }))
  )
}
```

**Stored vs displayed:** the server keeps 10 entries per board
(`src/game/config.ts:452`); the physical monument shows 5 time rows and 4 point
rows (`src/game/plaza.ts:858`). Places 6-10 exist and persist — they simply do not
fit on the board.

---

## The life of a record

1. **Start.** The server watches the gate plane itself, every frame, and stamps
   the time when a player crosses (`noteGateCrossing`, `server.ts:708`). The
   client is never asked. A client that reported its start late would be handing
   itself a better time.
2. **Walking back through the gate abandons the climb**, so a retry is timed from
   the second crossing rather than the first.
3. **During the climb** the ranking sweep runs once a second and records the
   highest point the player has ever stood at (`publishRanking`, `server.ts:536`).
4. **A coin** is a request, not a report. The server checks the player's own
   verified position and whether they already own that coin (`handlePickup`,
   `server.ts:459`).
5. **A finish** is also a request. The server re-derives the finish pad, checks
   the position, checks it ever saw the start, and computes the time from its own
   clock (`handleClaim`, `server.ts:388`).
6. **Points** are recomputed only when a checkpoint altitude is newly crossed or a
   coin is taken (`scoreOf`, `server.ts:907`):

   ```
   coins × 300  +  summits × 500  +  checkpoint altitudes ever reached × 100
   ```

   Reached-altitudes, not completed runs, is what makes points accrue for a climb
   that ended in a fall two thirds of the way up.
7. **Publish, then persist.** `publishBoard()` for the screens, the dirty flag for
   the disk.

## What survives what

| event | effect on the data |
|---|---|
| server sleeps (World empties) | none — it restores from storage on wake |
| player leaves | none — their history is keyed to their wallet |
| **new deploy** | none — storage is scoped to the World, not the scene hash |
| midnight | none. Nothing resets, ever |

An earlier version emptied a second board at midnight UTC to give newcomers a
winnable target. It was removed: a player set a time in the evening, showed a
friend, and by the time the friend looked the table was blank for everybody.

---

## Gotchas that cost us real time

**Storage writes are capped and fail silently.** Covered above. The first version
wrote a coin pickup per find; collecting eight in a row fired eight writes, the
excess resolved to `false`, and nothing on the server or the client noticed — the
counter was served from memory, so it kept saying 8/8. The loss only appeared
after a restart.

**The `sdk-commands storage` CLI can only write STRINGS.** `--value` is a command
line argument placed in the request body verbatim, while the server writes real
objects, and storage returns what was written, unparsed. So a key repaired by
hand from a terminal comes back as JSON *text*, fails a `stored.version !== 1`
guard, and the board restores **empty with no error anywhere**. Accepting both
shapes (`decoded`, `server.ts:970`) turns an out-of-band write back into a repair
instead of a way to erase a board.

**`isStateSyncronized()` is not a readiness check.** It says the transport is
connected, not that the server is awake. The server sleeps when the World empties
and takes ~15 s to cold start; anything sent into that window is dropped without a
trace. Gate client-to-server messages on a heartbeat instead: the server writes
`Date.now()` to a synced field every 2 s, and the client treats it as alive only
if it *observed a change* recently — tracking the observation time, not the
timestamp, so a stale snapshot from a dead server does not read as live.

**Client and server are paired by deployment hash.** Two players on different
scene versions talk to two different server instances with separate live state.
Storage is shared, so each sees "whatever was on disk at boot, plus their own
actions" — which looks exactly like *everyone sees only themselves*. If that
symptom appears, have both players fully quit and rejoin before debugging
anything else.

**Prune caches by who is present, and do not optimise the prune.** A long-running
server accumulates one entry per visitor forever. The prune here originally began
with `if (cache.size <= present.size) return`, which treats an equal count as
equal membership — three cached entries with three people present can be two who
are here and one who left. A stale start-stamp is the one that bites: the owner
returns, the gate watcher sees a climb already running and never re-stamps, and
their next finish is timed from a visit that ended hours ago.

---

## The smallest version that works

If you want just a leaderboard, this is the whole shape:

```ts
// shared/schemas.ts
export const Board = engine.defineComponent('mygame::board', {
  names: Schemas.Array(Schemas.String),
  scores: Schemas.Array(Schemas.Int)
})
if (isServer()) {
  Board.validateBeforeChange((v) =>
    v.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase())
}

// server.ts
const state = engine.addEntity()
Board.create(state, { names: [], scores: [] })
syncEntity(state, [Board.componentId])           // server only

let board: { name: string; score: number }[] = []

const stored = await Storage.get<any>('mygame.board.v1')
const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored
if (parsed?.version === 1 && Array.isArray(parsed.board)) board = parsed.board

function publish() {
  const b = Board.getMutable(state)
  b.names = board.map((e) => e.name)
  b.scores = board.map((e) => e.score)
}

// on a verified score, from a position the server read itself:
board = [...board, entry].sort((a, b) => b.score - a.score).slice(0, 10)
publish()
dirty = true                                     // written by a debounced flush

// client
for (const [entity] of engine.getEntitiesWith(Board)) {
  const b = Board.getOrNull(entity)
  if (b) draw(b.names, b.scores)                 // into TextShape, not UI
}
```

Requirements: `npm install @dcl/sdk@auth-server @dcl/js-runtime@auth-server`, and
`"authoritativeMultiplayer": true` at the root of `scene.json` (the auth-server
build adds it automatically on every build — just do not remove it).
