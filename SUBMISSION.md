# Tower Obby — Friendzone Buildathon submission

**World:** `imbanana.dcl.eth`
**Repository:** this one, MIT licensed
**Built with:** Decentraland SDK7 + the Multiplayer Server (`@dcl/sdk@auth-server`)

The four answers below are the ones the Buildathon Terms require in the
submission itself (§6). Every number in them was measured, not estimated —
either by the geometry harness (`node tools/verify-layout.mjs`) or in a running
client through the Explorer MCP server.

---

## 1. What it is

One tower. Sixty-nine metres, a hundred and nineteen platforms, twenty zones
that get harder the higher you go. Everyone in the World climbs the same tower
at the same time, and the fastest climb of the day is on the board in the yard.

Your clock starts when you walk through the gate and stops at the crown. There
are no rounds, no lobby phase and nothing to wait for — you arrive, you climb.

Three things on the way up are decisions rather than jumps. A **fork** that
prices both arms in seconds on a sign. An **ante**: three crumbling pads out
into open air to a coin that buys you a whole section, or a fall if you miss.
A **tandem plate** that does not rise for one person.

Eight coins hang off the route, each a jump out and a jump back from the pad it
belongs to. Nothing needs them. They are kept per wallet for good rather than
per climb, so a collection you are missing pieces of is a reason to come back
for the ones you skipped while chasing a time.

---

## 2. How it was designed and optimised for mobile

It was designed for a thumb from the first commit, and the constraints are in
the code rather than in a document.

**Every jump is capped at 55% of what the ability allows.** Not by convention —
`REACH_BUDGET` and `MAX_STEP_RISE` are derived from `DIFFICULTY_BUDGET = 0.55`
in `config.ts`, the cap is applied inside the placement function so no section
can opt out of it, and the harness fails the build if a single hop exceeds it.
Worst horizontal gap: 3.02 m of a 3.03 m budget. Worst rise: 1.10 m of 1.10 m.
It started at 0.7 and came down after the first session on a real handset: a
virtual joystick is not a keyboard, and the honest way to keep a climb hard is
wider margins with tighter timing, not gaps that need keyboard precision.

**Four lines of HUD, never five, and no panels behind them.** The layout
branches on `isMobile()` for a 1600×720 canvas with larger type and thumb-sized
controls. Height is a four-segment bar rather than "SECTION 7/20", because a
bar is the feeling directly and at twenty segments each slice is two pixels on
a phone. Everything else is taught by the level: a gate that says what it does,
a collar on the trunk at every checkpoint height, and a prompt that appears only
when there is something to press.

**Sight lines are measured, not eyeballed.** A ray is walked from the climber's
eye to every next target and every other slab is tested as a box along it:
119 of 119 clear. On a six-inch screen a target you cannot see is a target you
cannot plan for.

**Built against the documented mobile gaps, not around them.** No dynamic
lights and no particles, because neither renders on mobile — the leaderboard is
lit with emissive geometry so the phone and the desktop see the same place. The
UI is rendered with `screenInset: 'interactable'` on phones only, so it sits in
the rectangle the client leaves free of its own joystick, chat and profile
column. And every surface a climber lands on uses a box collider, because
collider-shape consistency between the mobile and desktop clients is an open
item in Decentraland's own tracker and a box is the shape both agree on.

**Measured against the mobile client's own limits**, which are not the parcel
limits and are the ones that decide whether the scene loads at all:

| metric | ours | soft | hard |
|---|---|---|---|
| triangles | 28,985 | 1,000,000 | 1,200,000 |
| entities | 400 | 4,800 | 6,000 |
| meshes | 349 | 2,400 | 3,000 |
| **materials** | **349** | **400** | **500** |
| textures | 15 | 400 | 500 |
| colliders | 154 | 1,200 | 1,500 |
| content size | 4.3 MB | 120 MB | 150 MB |

Materials is the only one that ever mattered. The mobile client counts one
material per mesh, and reaching the hard limit blocks a scene from loading —
this scene was at 620 and would very likely not have opened on a phone at all.

Everything else has ten to thirty times the headroom, which is the fact that
drove the art: an empty box of twelve triangles and a detailed model of five
thousand cost exactly the same one slot, so the answer is always fewer objects
and heavier ones. The largest single saving was ninety ground shadows. Every
pad had a blob on the floor beneath it to anchor it in space, which is sound
reasoning while the floor and the pad share a screen — and the climb tops out
at sixty-nine metres, so for ninety of them the anchor anchored nothing.

---

## 3. How it encourages social interaction

The tower is shared ground, and three mechanics need somebody else.

**The tandem plate cannot be operated alone.** It rises only with two different
people standing on it, and it lifts twelve metres — past a whole checkpoint.
This is the one place in the climb where skill cannot substitute for company.

**Pair times get their own board.** The plate stamps a partnership at full
lift, and a climb finished after one lands under CLIMBED TOGETHER with both
names on it. The partner's name comes from the server's own list, never from
the claiming client, and the partnership belongs to the climb — walk back
through the gate and it is gone. This is the board the game is actually about:
a solo obby cannot record two strangers cooperating.

**The co-op bypass** needs two pressure pads held at once, nine metres apart so
one player cannot cover both. Stand on one by yourself and the world tells you
somebody is waiting on the other.

**The lever** is a favour: holding it freezes the next zone's hazards for
everyone, and whoever holds it is not climbing.

Around those: a live ranking of who is highest right now, so the people you are
racing are visible out of the window rather than in a menu. Every summit is
announced to the whole World, wherever the listener is on the tower. And the
main route stays completable alone — a judge arrives by themselves and what
they lose without company is the shortcut, not the climb.

---

## 4. Why people come back

**The daily board resets at midnight UTC.** An all-time list is unreachable for
somebody who arrived an hour ago, and a target nobody can hit is a target
nobody looks at. Tonight's board is winnable tonight.

**Today's fastest run replays in the tower as a mote of light** walking the
exact path it took. Not an avatar — an avatar reads as somebody you can talk to
and this one cannot answer. It says "somebody did this, faster than you" and
nothing else. Take the top spot and your run becomes the ghost, so leaving
still leaves something behind.

**The finish names your decisions, not just your time.** `zone 4 — played it
safe, +3.7s`. A time on its own is a number; the same time next to the choices
that produced it is an argument for climbing again with different ones.

Your personal best and lifetime summit count are stored per wallet and survive
the server sleeping when the World empties.

---

## Verifying the claims

```bash
npm install
node tools/verify-layout.mjs   # 42 invariants, exits non-zero on any break
npx tsc --noEmit
npm run build
```

The layout module imports no SDK, so it compiles standalone and every geometric
claim above is reproducible in Node.

## What has been verified, and what has not

Driven through a running client with the Explorer's MCP server — the player was
moved, the screen was read back, and every line below is something that
appeared on it.

```
gate crossing starts the clock                    0:19.85 on the HUD
all six checkpoints and the crown take weight     +0.33 m foot offset on each
falling returns you to your last checkpoint       confirmed by accident
summit claim, board and personal best             "THE CROWN 0:03.44"
lifetime summit count, per wallet                 "Summit number 9."
the burst at the crown                            fourteen shards, in frame
eight optional coins                              COINS 8/8, hidden as taken
the collection survives a restart                 still 8/8 after a reload
fork choice recorded from where the feet landed   "Zone 3 - took the bold arm -3.7s"
ante: client claims, server validates, token granted
ghost accepted by the server        [SERVER] ghost replaced by imbanytui (44.1s)
```

Still unverified, and honestly so:

- **The tandem plate and the pair board.** Both need two people standing on one
  slab and neither can be tested by one. The plate's arrival is a placement
  rather than a physics ride specifically so it does not depend on undocumented
  behaviour, and the pair entry is written by the same server code path that
  writes the solo one.
- **Spending the skip token.** The grant is verified; the button press that
  spends it cannot be sent programmatically, so the teleport it performs has
  not been exercised.
- **Jump feel.** Every gap is inside the budget by arithmetic, and the harness
  proves it, but the test harness cannot jump — so no gap in this tower has
  been crossed by a real jump rather than a teleport.
- **Anything on a physical phone.** The mobile layout branches on `isMobile()`
  and every budget is inside the mobile limits, but no handset has run this
  build.

## A note on how the numbers here are kept true

Three times during development a measurement was taken against coordinates
computed before a layout change, and three times the result looked like a bug
in the game rather than a stale target — seven checkpoints that appeared to
have no floor, eight coins that appeared uncollectable. The game was right
every time.

The tower's shape is now pinned by a fingerprint over every pad's position,
size, kind and section. It cannot move without the harness refusing the build
and asking whether the boards should be cleared, which is the question that
matters: a leaderboard is only meaningful while everybody climbed the same
tower. It has been changed once, deliberately, to widen the crown - and no pad
moved when it was.
