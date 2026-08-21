# Tower Obby — Decentraland SDK7

**One tower. Everyone climbs it. Fastest time today wins.**

A timed parkour climb for Decentraland, live at **`imbanana.dcl.eth`**. Players arrive
in a yard beneath an 80 metre tower, walk through a gate that starts their own clock,
and climb 132 platforms through twenty zones that get harder the higher they go.

Built for the Friendzone Mobile Buildathon: mobile-first, social, deployed to a
Decentraland World.

It used to be ten rotating rounds. That was wrong, and the reasons are worth stating
because they are the whole design: a course that regenerates every few minutes cannot be
learned, gives nobody a landmark to talk about, and produces times that compare to
nothing — which quietly defeated the leaderboard, the live ranking, and every reason two
players would speak to each other.

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

The tower is a **stack of twenty zones**, in the spirit of Roblox's Tower of Hell, but
permanent. It is generated once from a fixed seed, so every client builds byte-identical
geometry — a client that built a different tower would drop its player through somebody
else's floor. Difficulty is read from **altitude**: `curve(progress)` is evaluated per
zone, so the base is wide and gentle and the crown is not. Zone kinds live in
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
curve, jump gaps, hazard sizes, crumble timings, respawn behaviour.

Two of them are the design brief made executable:

```ts
export const DIFFICULTY_BUDGET = 0.7   // no jump may need more than 70% of the ability
export const REACH_BUDGET = REACH_ABILITY * DIFFICULTY_BUDGET
export const MAX_STEP_RISE = DOUBLE_JUMP_HEIGHT * DIFFICULTY_BUDGET
```

The cap is applied inside the placement function, so no zone can opt out of it. It is
there because the game is judged on a phone and a thumb on a virtual stick is nothing
like a keyboard.

## Multiplayer

Everyone in the World is on the same tower, at the same time, all the time. The scene
runs a Decentraland Multiplayer Server (`@dcl/sdk@auth-server`), branched with
`isServer()`:

- the **server** owns both boards, the live height ranking and the co-op state;
- the **tower is never sent over the wire**. The generator is deterministic and imports
  no SDK, so the server runs the same `buildTower()` the clients do;
- there is **no round clock**. Each player's climb is their own, from their gate
  crossing to the crown, so somebody who arrives at any moment races immediately;
- a finish is a **claim**, not a score. The client says "I am on the finish pad";
  the server re-derives where that pad is, reads the player's engine-verified
  `Transform`, and only then credits anything. A client-reported time is never
  trusted;
- boards are written to `Storage` on a summit — never per tick, since storage writes are
  capped — and personal bests are kept per wallet, so they survive the server shutting
  down when the scene empties.

There are **two boards**. The all-time list holds the ten fastest climbs ever recorded.
The daily list holds today's, and empties at midnight UTC. That second one is the point:
an all-time board is unreachable for somebody who arrived an hour ago, and a target
nobody can hit is a target nobody looks at. A board that empties every night is winnable
tonight.

The server watches the gate plane itself, every frame, rather than taking a client's word
for when its climb began — a client that reported late would be handing itself a better
time.

Because the server sleeps when the World is empty and takes ~15 s to cold start,
the client shows a "waking the server up" banner driven by a heartbeat, and
tracks the time it *observed* the heartbeat change rather than the server's own
timestamp — a stale snapshot from an older server run must not read as alive.

## Budget against the scene limits

Limits are `n × 200` entities, `n × 10000` triangles, `log2(n+1) × 20` materials and the
same formula in metres for height. This scene uses **25 parcels**:

| resource | limit | tower | status |
|---|---|---|---|
| height | 94 m | **79.5 m** | measured |
| deployed payload | 100 MB quota | **1.02 MB** | measured on the content server |
| entities | 5000 | ~700 est. | **not verified** |
| triangles | 250 000 | ~25 000 est. | **not verified** |
| materials | 94 | ~46 est. | **not verified** |

The first two are measured. The last three are estimates from counting what the builder
creates per pad, and they are marked as such deliberately: a successful deploy is *not*
evidence, because the Worlds linker reports `skipValidations: true` and the content
server does not check them for us. Verifying these needs the scene running in a client
with the metrics panel open.

Measured geometry, which is what the checks in *Verifying changes* assert:

```
pads 132   height 0.4 to 79.5 m of 85 m
worst horizontal gap 3.50 m of a 3.85 m budget (70% of the ability)
worst vertical rise  1.40 m of a 1.40 m budget (70% of doubleJumpHeight)
overlapping pads 0   |   clean climb model 212 s
```

Two quantisations exist purely to bound the material count, since every distinct albedo
is a material. Height fade is stepped into 4 bands for pads and 3 for shadows — a smooth
fade once gave every pad its own albedo and reached roughly 182, well past the budget.
Zone colour is stepped into 10 bands across the 20 zones. Both are invisible in motion.

## Verifying changes

The layout is pure logic with no SDK imports, so it compiles standalone and is measured
in Node — which is how every geometry bug in this project was actually found, and none
were found by looking at it.

```bash
node tools/verify-layout.mjs
```

It exits non-zero on any break, so it can gate a commit. Current output:

```
Geometry audit - one tower, 131 hops

  PASS  horizontal gap within reach     worst 3.50m / 3.85m budget (70%)
  PASS  vertical rise within jump       worst 1.40m / 1.40m budget (70%)
  PASS  no overlapping pads             0 pairs
  PASS  inside scene height limit       79.5m / 85m
  PASS  finish slab fully responsive    worst corner 2.26m, 0 dead zones
  PASS  client within server tolerance  reach <= 3.5m
  PASS  board visible on arrival        43 deg off the gaze, 8.8 m away
  PASS  board clear of the gate opening 6 m aside of a 9 m gate
  PASS  deterministic across builds     22606 bytes
```

Each of those lines exists because it once failed. The finish check was hardcoded to
1.8 m while the server accepted 3.5 m, so standing on the corner of the finish slab did
nothing at all. The board sat 180 degrees behind the spawn. Twenty jumps sat between 70%
and 88% of the ability while the harness was checking the ability rather than the brief.

Run it after **any** change to `layout.ts` or `config.ts`, then `npx tsc --noEmit` and
`npm run build`.

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
