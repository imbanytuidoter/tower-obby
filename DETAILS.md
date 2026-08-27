# Tower Obby

**One tower. Everyone in the World climbs it. Your time goes on a board that never resets.**

▶ **Play it:** https://play.decentraland.org/?realm=imbanana.dcl.eth
💻 **Source:** https://github.com/imbanytuidoter/tower-obby

---

## The problem

Most Decentraland Worlds are empty. You walk in, there is nothing to do, and you
leave in a minute. If somebody else is standing there, you have no reason to talk
to them. And a World that needs a host is closed whenever the host is asleep.

## What this is

A parkour climb up a 73 metre tower, in a forest clearing, for anybody who shows up.

You arrive in a yard. A gate line starts *your* clock — everyone runs their own.
185 platforms spiral up through 26 zones that get harder the higher you go: the
gaps widen, the drops grow, beams sweep across the route, and some platforms
crumble a second after you land. Nine checkpoints save your progress. Sixteen
coins hide off the route, and they cost you time to collect.

**It is the same tower every visit.** That one decision is the whole design. A
course that regenerates cannot be learned, gives nobody a landmark to talk about,
and produces times that compare to nothing.

## Why anyone would talk to anyone

- **Two boards in the lobby, and neither ever resets.** One ranks the fastest
  climbs. The other ranks total points — 100 a checkpoint, 300 a coin, 500 the
  crown. Points count even if you never reach the top, so a slow, careful player
  can lead a board without ever being fast.
- **A live ranking** shows who is highest in the tower right now, by name. You can
  see who you are racing without asking.
- **Everyone hears a summit.** When somebody reaches the crown, the whole World is
  told and the crown lights up for all of them. Their name goes on the arch up
  there, for the next person who makes it.
- **Two things one player cannot do.** A plate that only rises with two *different*
  people standing on it. A lever that holds a sweeping beam still for everybody
  else — but whoever holds it is not climbing. Cooperation you have to ask a
  stranger for, and a favour that costs the person doing it.
- **A ghost of the record run** walks the route as a mote of light, so the best
  climb is present even when the person who set it is not.

## Built for a phone, not shrunk to fit one

- On a phone the whole HUD is removed. It is a climb; the screen belongs to the
  tower.
- Two layouts and two type scales, picked by device, instead of one desktop
  layout scaled down.
- No dynamic lights anywhere — they do not exist on mobile. Every glow is emissive
  geometry, so both platforms look like the same place.
- **390 materials of the 400 a phone allows.** Held there deliberately: every
  distinct colour is a material, so height fading and platform colour are
  quantised into a few steps rather than a smooth gradient.
- 476 entities, 28,164 triangles, 223 colliders, 13 textures.
- Climbed to the crown on a phone, by a second player, on the live World.

## Under it

Decentraland SDK7 with the Multiplayer Server. The server owns every number that
matters. It watches the gate line itself, every frame, rather than believing a
client about when a climb began. It re-derives the finish platform and checks the
player's engine-verified position before crediting anything. All eleven synced
components reject writes from anyone but the server. Boards and per-wallet
histories survive restarts and redeploys.

The tower is generated once from a fixed seed, so every client builds
byte-identical ground — a client that built a different tower would drop its
player through somebody else's floor.

`tools/verify-layout.mjs` measures **74 invariants** over the generated tower and
fails the build if one breaks: every required jump inside a documented ability
budget, no overlapping platforms, none hanging over another, difficulty rising
with height, nothing pinned against the engine's ceiling.

```
platforms 185   height 0.4 to 72.9 m of a 92 m ceiling
worst horizontal gap 4.60 m of a 4.79 m budget (87% of the ability)
worst vertical rise  1.74 m of a 1.74 m budget (87% of double jump)
overlapping platforms 0   |   modelled clean climb 297 s
```

## Reasons to come back

Your personal best and your coins are kept per wallet, so the tower remembers you.
The boards never wipe, so a time you set is still standing next week. The points
board gives somebody who arrived an hour ago a ladder they can actually climb —
and the fastest board gives everyone one target that never moves.

Open source, MIT.
