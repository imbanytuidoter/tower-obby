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

One tower. Eighty-five metres, a hundred and twenty platforms, twenty zones
that get harder the higher you go. Everyone in the World climbs the same tower
at the same time, and the fastest climb of the day is on the board in the yard.

Your clock starts when you walk through the gate and stops at the crown. There
are no rounds, no lobby phase and nothing to wait for — you arrive, you climb.

Three things on the way up are decisions rather than jumps. A **fork** that
prices both arms in seconds on a sign. An **ante**: three crumbling pads out
into open air to a coin that buys you a whole section, or a fall if you miss.
A **tandem plate** that does not rise for one person.

---

## 2. How it was designed and optimised for mobile

It was designed for a thumb from the first commit, and the constraints are in
the code rather than in a document.

**Every jump is capped at 70% of what the ability allows.** Not by convention —
`REACH_BUDGET` and `MAX_STEP_RISE` are derived from `DIFFICULTY_BUDGET = 0.7`
in `config.ts`, the cap is applied inside the placement function so no section
can opt out of it, and the harness fails the build if a single hop exceeds it.
Worst horizontal gap: 3.50 m of a 3.85 m budget. Worst rise: 1.40 m of 1.40 m.
A virtual joystick is not a keyboard, and the honest way to keep a climb hard
is wider margins with tighter timing, not gaps that need keyboard precision.

**Four lines of HUD, never five.** The layout branches on `isMobile()` for a
1600×720 canvas with larger type and thumb-sized controls. Everything else is
taught by the level: the warm-up pad in the yard is the tower's own opening
jump at ground level, labelled `1.9 m — 35% OF YOUR JUMP`, where failing costs
nothing. Button 1 has no legend — it does nothing until you hold a skip token,
and the prompt appears the moment you do.

**Sight lines are measured, not eyeballed.** A ray is walked from the climber's
eye to every next target and every other slab is tested as a box along it:
119 of 119 clear. On a six-inch screen a target you cannot see is a target you
cannot plan for.

**No dynamic lights and no particles**, because neither renders on mobile — the
leaderboard is lit with emissive geometry so the phone and the desktop see the
same place.

Measured in a running client: **689 entities of 5,000. 44,468 triangles of
250,000. One texture of 47. 30 fps with zero hiccup frames.**

---

## 3. How it encourages social interaction

The tower is shared ground, and three mechanics need somebody else.

**The tandem plate cannot be operated alone.** It rises only with two different
people standing on it, and it lifts twelve metres — past a whole checkpoint.
This is the one place in the climb where skill cannot substitute for company.

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
node tools/verify-layout.mjs   # 15 invariants, exits non-zero on any break
npx tsc --noEmit
npm run build
```

The layout module imports no SDK, so it compiles standalone and every geometric
claim above is reproducible in Node.

## What has not been verified

Stated plainly, because the rest of this document is measured. The five
mechanics — coin, token, tandem plate, finish deltas, ghost — compile, build,
pass the harness and produce no client errors, but have not been played
end to end. The tandem plate cannot be verified by one person at all.
