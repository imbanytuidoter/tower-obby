# Tower Obby

**One tower. Everyone in the World climbs it. Your time goes on a board that never resets.**

▶ **Play:** https://play.decentraland.org/?realm=imbanana.dcl.eth
💻 **Source:** https://github.com/imbanytuidoter/tower-obby

## The problem

Most Decentraland Worlds are empty. You walk in, there is nothing to do, and you
leave in a minute. If somebody else is standing there, you have no reason to talk
to them. A World that needs a host is closed whenever the host is asleep.

## What it is

A parkour climb up a 73 metre tower. A gate line starts your own clock. 185
platforms spiral through 26 zones that get harder as you rise — wider gaps,
sweeping beams, platforms that crumble a second after you land. Nine checkpoints
save your progress. Sixteen coins hide off the route and cost you time to take.

**It is the same tower every visit.** A course that regenerates cannot be learned,
gives nobody a landmark to talk about, and produces times that compare to nothing.

## Why anyone talks to anyone

- **Two boards, neither ever resets.** One ranks the fastest climbs. One ranks
  total points — 100 a checkpoint, 300 a coin, 500 the crown. Points count even if
  you never reach the top, so a slow, careful player can lead a board too.
- **A live ranking** names who is highest in the tower right now.
- **Everyone hears a summit.** The whole World is told, the crown lights up, and
  the climber's name goes on the arch for the next person who makes it.
- **Two things one player cannot do.** A plate that rises only with two *different*
  people on it. A lever that holds a beam still for everybody else — but whoever
  holds it is not climbing. A favour that costs the person doing it.

## Built for a phone, not shrunk to fit one

On a phone the entire HUD is removed; the screen belongs to the tower. Two layouts
picked by device, not one desktop layout scaled down. No dynamic lights anywhere —
they do not exist on mobile — so every glow is emissive geometry and both platforms
look like the same place.

**390 materials of the 400 a phone allows**, held there deliberately: every distinct
colour costs a material, so height fading is quantised into steps. 476 entities,
28,164 triangles. Climbed to the crown on a phone, by a second player, on the live
World.

## Under it

SDK7 with the Multiplayer Server. The server owns every number that matters — it
watches the gate line itself each frame rather than believing a client about when a
climb began, and checks the player's verified position before crediting a finish.
Boards and per-wallet histories survive restarts. The tower is generated from a
fixed seed, so every client builds identical ground. A test harness measures 74
invariants over it and fails the build if one breaks.

Open source, MIT.
