# Friendzone Buildathon — submission draft

Copy-paste material for the DoraHacks BUIDL form. Facts here are measured, not
estimated: pad counts and budgets come from `node tools/verify-layout.mjs`, and
the runtime figures from a client with the scene loaded.

## BUIDL name

Tower Obby

## Category

Gaming / Metaverse

## Vision — the problem this solves

Most Decentraland Worlds are empty rooms. They look finished and they give a
visitor nothing to do in the ninety seconds before they leave, and nothing at
all to do WITH the stranger standing next to them. A hangout that needs a host
is closed whenever the host is asleep.

Tower Obby is one permanent tower that everybody in the World climbs. It is the
same tower for everyone, every visit, which is the whole design: a course that
regenerates cannot be learned, gives nobody a landmark to talk about, and
produces times that compare to nothing.

That single decision is what makes the social part work:

- **A shared record.** Two boards in the lobby, neither of which ever resets -
  the fastest climbs ever, and lifetime points. Points accrue for checkpoints
  and coins without ever reaching the top, so a patient explorer can lead a
  board without being fast, and somebody who arrived an hour ago still has a
  ladder to climb.
- **Something to talk about.** A live ranking shows who is highest right now.
  A summit is announced to everyone in the World, and the crown lights up for
  all of them - somebody else's win is an event you witness, not a number you
  read later.
- **Things one player cannot do.** A plate that only rises with two different
  people standing on it, and a lever that stops a moving beam for everybody
  else while whoever holds it is not climbing. Cooperation you have to ask a
  stranger for.
- **A ghost of the record run** walks the route as a mote of light, so the
  best climb is present even when its owner is not.

It runs with nobody hosting it, at three in the morning, for one visitor or ten.

## Built for a phone, not adapted to one

- On a handset the entire HUD is removed. It is a climb; the screen belongs to
  the tower.
- Two virtual resolutions and two type scales, chosen by device, rather than one
  layout shrunk down.
- No dynamic lights anywhere: they do not exist on mobile, so the glow is
  emissive geometry that renders identically on both platforms.
- **390 materials of the 400 a phone allows**, held there deliberately - every
  distinct albedo is a material, so height fade and pad colour are quantised
  into a few steps instead of a smooth gradient.
- 476 entities, 28,164 triangles, 223 colliders, 13 textures.
- Climbed to the crown on a phone, by a second player, on the deployed World.

## Technically

Decentraland SDK7 with the Multiplayer Server. The server owns every number
that matters: it watches the gate plane itself each frame rather than trusting
a client's word for when a climb began, re-derives the finish pad and checks
the player's engine-verified position before crediting anything, and validates
all eleven synced components as server-write-only. Boards and per-wallet
histories persist in `Storage` across restarts and redeploys.

Geometry is generated once from a fixed seed, so every client builds
byte-identical ground - a client that built a different tower would drop its
player through somebody else's floor.

`tools/verify-layout.mjs` measures 74 invariants over the generated tower and
exits non-zero if one breaks: every required jump inside a documented ability
budget, no overlapping pads, no pad hanging over another, difficulty rising
with altitude, nothing pinned on the engine's height ceiling.

```
pads 185   height 0.4 to 72.9 m of 92 m
worst horizontal gap 4.60 m of a 4.79 m budget (87% of the ability)
worst vertical rise  1.74 m of a 1.74 m budget (87% of doubleJumpHeight)
overlapping pads 0   |   clean climb model 297 s
```

## Links

- World: https://play.decentraland.org/?realm=imbanana.dcl.eth
- GitHub: https://github.com/imbanytuidoter/tower-obby
- Social: TODO - at least one link required by the form
- Demo video: optional, recommended

## Still to do before submitting

- [x] Public repository: https://github.com/imbanytuidoter/tower-obby
- [ ] At least one social link for the form
- [x] 480x480 logo: `images/buidl-logo.png`, 32 KB, drawn from the scene palette
- [ ] Replace `images/scene-thumbnail.png` - it shows an older tower, with
      collar rings up the whole trunk that were removed
- [ ] Keep the World deployed and public through 11 September (judging)
