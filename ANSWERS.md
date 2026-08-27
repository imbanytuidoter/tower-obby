# Submission questionnaire — prepared answers

Fill the ones marked YOU yourself. Everything else is written from what the
project actually does, with numbers taken from the harness and a running client.

---

**2. Decentraland wallet address of each contributor** — YOU
Two addresses appear in this project's history and only you know which is which:
`0x79208e620af10537b988a41dd8f5b13d89bdc2b3` signs the deploys and holds
`imbanana.dcl.eth`; `0x5dbaabf18fc80e7828b01a1bd96eca23657cdf6a` is the account
that played in the client. Solo project, so one line.

**3. Email of each contributor**
svasilevskij95@gmail.com

**3b. Designated team representative**
Serhii Vasylevskyi (solo project)

**4. Wallet to receive a potential MANA prize** — YOU
Pick the address you hold the keys to and verify it character by character.

**5. Do all team members authorize the representative?**
Yes (solo project)

**6. Public address of your Decentraland World**
imbanana.dcl.eth

**7. Public GitHub repository URL**
https://github.com/imbanytuidoter/tower-obby

---

**8. How was the project designed and optimized for mobile?**

Mobile was the constraint the whole scene was built inside, not a pass at the end.

On a phone the entire HUD is removed. The clock, coins, score and live ranking are
seven lines of chrome that covered half a handset screen, so on mobile the screen
belongs to the tower. The UI uses two virtual resolutions and two type scales
picked by device, rather than one desktop layout scaled down.

There are no dynamic lights anywhere in the scene. They do not exist on mobile, so
every glow — checkpoint beacons, the crown, the lit rim of the leaderboard — is
emissive geometry. Both platforms render the same place instead of the phone
getting the flat version.

The hard limit is materials: a phone allows 400 and every distinct colour costs
one. An early build hit 462 and was silently over budget. Height fading and
platform colour are now quantised into a few steps instead of a smooth gradient,
vegetation was cut back, and the tower was trimmed from 30 zones to 26. It now
sits at **390 of 400**, measured in a running client, with 476 entities and 28,164
triangles.

Jump distances are checked against a documented ability budget rather than tuned
by feel, because a jump that is comfortable with a keyboard can be unreachable
with a touch stick. A test harness measures 74 invariants over the generated tower
and fails the build if a single required jump goes outside that budget.

**9. How does the project encourage social interaction and repeat visits?**

It is one permanent tower that everybody in the World climbs — the same tower every
visit. That is the decision everything else rests on: a course that regenerates
cannot be learned, gives nobody a landmark to talk about, and produces times that
compare to nothing.

Interaction:
- A live ranking names who is highest in the tower right now, so you can see who
  you are racing without asking.
- When somebody reaches the crown, the whole World is told, the crown lights up
  for everyone, and their name goes on the arch up there for the next arrival.
- A plate near the top rises only with two *different* people standing on it.
- A lever holds a sweeping beam still for everybody else — but whoever holds it is
  not climbing. It is a favour that costs the person doing it, which is the part
  that makes strangers talk.

Returning:
- Two boards in the lobby and neither ever resets. One ranks the fastest climbs,
  one ranks lifetime points — 100 a checkpoint, 300 a coin, 500 the crown.
- Points accrue without ever finishing, so somebody who arrived an hour ago has a
  ladder they can actually climb, and a patient explorer can top a board without
  being fast.
- Personal bests and collected coins are kept per wallet, so the tower remembers
  you between visits.
- A ghost of the record run walks the route as a mote of light, so the best climb
  is present even when its owner is not.

**10. Mobile devices tested on** — YOU
Android phone or iPhone — pick whichever you and the second tester actually used.
Both of you have played the deployed World on a phone, and one of you climbed to
the crown on it.

**11. Main tools used**
Decentraland SDK7 (TypeScript), the Multiplayer Server (`@dcl/sdk@auth-server`),
Node, Blender-free — all geometry is SDK primitives plus a few GLB props. Claude
Code for development. A custom Node harness (`tools/verify-layout.mjs`) that
compiles the layout module standalone and measures 74 geometric invariants. The
Decentraland desktop client driven over its MCP interface, to read the running
scene's entity transforms and material counts rather than trusting the source.

**12. Biggest blocker building or testing for mobile**

The material limit, and the fact that nothing tells you when you cross it.

A phone allows 400 materials and every distinct colour is one. The tower had a
smooth height fade and full vegetation, which put it at 462 — over budget, with no
warning in the editor, no warning on deploy, and a desktop client that renders it
perfectly. It surfaced only by reading the content stats out of a running client.
The fix was to quantise the fade into steps, cut vegetation and trim four zones.

The second blocker was the same shape: mobile problems are invisible from a desk.
Half the layout issues that mattered — a HUD covering the screen, text too small,
a jump that a touch stick cannot make — could not be seen on desktop at all and
had to be found by holding a phone.

**13. Do you plan to continue after the Buildathon?** — YOU

**14. Known issues, limitations or special testing instructions**

- **Two mechanics need two players.** The plate near the top only rises with two
  different people on it, and the lever only matters to somebody else in the
  section below. Alone, both are visible and inert. Testing them needs a second
  person in the World.
- **The server sleeps when the World empties** and takes about 15 seconds to cold
  start. The first visitor after a quiet period sees the boards fill in a moment
  late; the scene shows a "waking up" notice while that happens.
- Everything the boards record is server-side, so a climb only counts if the
  server saw you cross the gate line. Teleporting into the middle of the tower
  will not produce a time.
- No known crashes or blocking bugs.

**15. Decentraland experience before Friendzone** — YOU
**How did you hear about Friendzone?** — YOU
