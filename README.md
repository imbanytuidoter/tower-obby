# Tower Obby — Decentraland SDK7

A timed parkour climb for Decentraland. Players gather in a lobby, walk through a start
gate, and race a procedurally generated tower built from stacked obstacle sections.

Built for the Friendzone / Regenesis hackathon: mobile-first, social, deployed to a
Decentraland World.

## Running it

```bash
npm install
npm run start
```

The preview opens the Decentraland desktop Explorer through the `decentraland://`
protocol handler, so that client has to be installed. Useful flags:

| flag | what it does |
|---|---|
| `--multi-instance` | allows a second Explorer window alongside one already running |
| `--mobile` | prints a QR code for previewing on a phone on the same network |
| `--explorer-alpha --hub` | what Creator Hub itself passes |

Passing `--landscape-terrain-enabled` renders the surrounding Genesis City landscape,
whose trees grow straight through the course. The scene sets `landscapeTerrain: false`,
but that is read when the client launches, not when the scene reloads — so a client
started with the flag keeps the trees until it is restarted.

## How the course is built

A round is a **stack of sections**, in the spirit of Roblox's Tower of Hell: every round
picks a fresh sequence of named sections, so no two climbs are the same. Sections live in
`src/game/layout.ts`:

| section | what it is |
|---|---|
| `gap jumps` | plain hops around the shaft |
| `ring of platforms` | a flat arc of pads with a beam sweeping the middle |
| `spinner floor` | one wide floor with several beams turning above it |
| `narrow bridge` | small planks with a bar sweeping across the end |
| `crumbling run` | pads that drop away shortly after you land |
| `piston hall` | pads with blocks punching up and down through them |
| `zigzag steps` | small pads thrown left and right of the climb line |

### Adding a section

1. Add its name to `SECTION_KINDS` in `src/game/layout.ts`.
2. Write a builder function that calls `hop()` for each pad and pushes any hazards.
3. Add a `case` for it in `buildSection()`.

`hop()` owns all the safety rules, so a new section gets them for free:

- pads are placed an exact **edge-to-edge** gap apart (`jumpGap` in the config), not
  centre to centre — measuring centres makes 3 m pads with a 4 m spacing look like they
  are touching;
- no pad may be placed under or over another within `VERTICAL_CLEARANCE`, or the climb
  can be walled off from itself;
- nothing may be built over the lobby or the start gate.

### Tuning

Every tunable number lives in `src/game/config.ts`: parcel geometry, the difficulty
curve per round, jump gaps, hazard sizes, crumble timings, respawn behaviour.

## Multiplayer

Everyone in the World climbs the same round at the same time. The scene runs a
Decentraland Multiplayer Server (`@dcl/sdk@auth-server`), branched with
`isServer()`:

- the **server** owns the round number, its clock and the shared board;
- the **tower is never sent over the wire**. The generator is deterministic and
  imports no SDK, so the server runs the same `buildLayout(round)` the clients
  do — broadcasting one integer gives everybody an identical course;
- a finish is a **claim**, not a score. The client says "I am on the finish pad";
  the server re-derives where that pad is, reads the player's engine-verified
  `Transform`, and only then credits anything. A client-reported time is never
  trusted;
- the board is written to `Storage` when a round is won — never per tick, since
  storage writes are capped — and personal bests are kept per wallet, so they
  survive the server shutting down when the scene empties.

Each player is timed from the moment **they** cross the start line, not from the round's
own start — the server watches the gate plane itself, every frame, so someone who walks
into the World halfway through a round still races their own clock and a client cannot
win time by reporting its start late.

Because the server sleeps when the World is empty and takes ~15 s to cold start,
the client shows a "waking the server up" banner driven by a heartbeat, and
tracks the time it *observed* the heartbeat change rather than the server's own
timestamp — a stale snapshot from an older server run must not read as alive.

## Budget against the scene limits

Limits are `n × 200` entities, `n × 10000` triangles, `log2(n+1) × 20` materials and the
same formula in metres for height. This scene uses **25 parcels**:

| resource | limit | worst round (10) | used |
|---|---|---|---|
| entities | 5000 | ~400 | 8 % |
| triangles | 250 000 | ~12 000 | 5 % |
| height | 94 m | 56.9 m | 61 % |
| materials | 94 | ~75 | 80 % |

Round 10 is the heaviest: 69 pads (each pad is 4 entities — slab, edge light, strut,
ground shadow), its hazards and 3 checkpoints, plus the fixed lobby, gate, leaderboard
and perimeter.

Measured geometry, which is what the checks in *Verifying changes* assert:

```
round  1 | EDGE gap 2.16-2.40m | overlapping pads 0 | top 17.1m
round  5 | EDGE gap 2.49-2.93m | overlapping pads 0 | top 27.9m
round 10 | EDGE gap 3.06-3.60m | overlapping pads 0 | top 56.9m
```

Height fade is quantised into 4 steps for pads and 3 for shadows. A smooth fade would
give every pad its own albedo, and every distinct albedo is a material — on round 10 that
came to roughly 182, well past the budget. The steps are invisible in motion.

## Verifying changes

The layout is pure logic with no SDK imports, so it can be compiled and measured on its
own — which is how every geometry bug in this project was actually found:

```bash
npx tsc src/game/layout.ts src/game/config.ts src/game/rng.ts \
  --outDir /tmp/gen --module commonjs --target es2020 --skipLibCheck
node -e "const {buildLayout}=require('/tmp/gen/layout'); /* measure here */"
```

Worth asserting after any layout change: edge gaps stay inside the jumpable range, zero
pads overlap vertically, and the same round number always generates the same tower —
otherwise leaderboard times stop being comparable.

## Deploying

The scene targets a Decentraland **World**, which is tied to a Decentraland NAME. Set it
in `scene.json`:

```json
"worldConfiguration": { "name": "yourname.dcl.eth" }
```

```bash
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

## Layout

```
src/
  index.ts          systems: hazards, run state, prompts, respawn
  ui.tsx            HUD, approach banner, round overlays
  game/
    config.ts       every tunable value
    layout.ts       section library and tower generation (pure logic)
    build.ts        turns a layout into entities
    plaza.ts        ground, lobby, start gate, leaderboard monument
    fairness.ts     locomotion pinning, no gliding, fall freeze
    sound.ts        feedback cues
    rng.ts          seeded generator, so rounds are reproducible
    state.ts        run state read by the HUD
  server/
    server.ts       round clock, finish validation, storage
  shared/
    messages.ts     registerMessages definitions
    schemas.ts      synced components and their server-only guards
assets/
  models/           lamp post from the Decentraland Sci-fi asset pack
  sounds/           cues from the Decentraland asset packs
```

## Licence

MIT.
