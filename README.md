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

## Budget against the scene limits

Limits are `n × 200` entities, `n × 10000` triangles, `log2(n+1) × 20` materials and the
same formula in metres for height. This scene uses **25 parcels**:

| resource | limit | worst round (10) | used |
|---|---|---|---|
| entities | 5000 | 414 | 8 % |
| triangles | 250 000 | ~12 400 | 5 % |
| height | 94 m | 72.3 m | 77 % |
| materials | 94 | ~75 | 80 % |

Round 10 is the heaviest: 71 pads (each pad is 4 entities — slab, edge light, strut,
ground shadow), 9 hazards, 3 checkpoints, plus 87 fixed entities for the lobby, gate,
leaderboard and perimeter.

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
    leaderboard.ts  per-round best times, shared over the message bus
    sound.ts        feedback cues
    rng.ts          seeded generator, so rounds are reproducible
    state.ts        run state read by the HUD
assets/
  models/           props from the Decentraland Sci-fi asset pack
  sounds/           cues from the Decentraland asset packs
```

## Licence

MIT.
