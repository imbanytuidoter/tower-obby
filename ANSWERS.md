# Submission questionnaire — prepared answers

Some fields cap at 960 characters. Every long answer below is written to fit,
with its count in the heading. Fill the ones marked YOU yourself. Everything else is written from what the
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

**8. How was the project designed and optimized for mobile?**  *(955 chars, cap 960)*

Mobile was the constraint the scene was built inside, not a final pass.

On a phone the entire HUD is removed — clock, coins, score and ranking were seven lines covering half a handset screen. The UI picks one of two virtual resolutions and type scales by device, rather than scaling a desktop layout down.

No dynamic lights anywhere: they do not exist on mobile, so every glow is emissive geometry and both platforms render the same place.

The hard limit is materials. A phone allows 400 and every distinct colour costs one. An early build sat at 462, silently over — no warning in the editor, none on deploy, and desktop rendered it perfectly. Height fading is now quantised into steps, vegetation was cut and the tower trimmed from 30 zones to 26. It measures 390 of 400 in a running client, with 28,164 triangles.

Jumps are checked against a documented ability budget, since a jump that is easy on a keyboard can be out of reach with a touch stick.

**9. How does the project encourage social interaction and repeat visits?**  *(917 chars, cap 960)*

One permanent tower that everyone in the World climbs — the same tower every visit, so times compare and the route can be learned.

Interaction: a live ranking names who is highest right now. When someone reaches the crown the whole World is told, the crown lights up, and their name goes on the arch for the next arrival. A plate near the top rises only with two DIFFERENT people on it. A lever holds a sweeping beam still for everybody else — but whoever holds it is not climbing. A favour that costs the person doing it is what makes strangers speak.

Returning: two boards, and neither ever resets. One ranks the fastest climbs, one ranks lifetime points — 100 a checkpoint, 300 a coin, 500 the crown. Points count even if you never finish, so somebody who arrived an hour ago has a ladder they can actually climb. Personal bests and collected coins are kept per wallet, so the tower remembers you between visits.

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

**12. Biggest blocker building or testing for mobile**  *(804 chars, cap 960)*

The material limit, and that nothing tells you when you cross it.

A phone allows 400 materials and every distinct colour is one. The tower had a smooth height fade and full vegetation, which put it at 462 — over budget, with no warning in the editor, none on deploy, and a desktop client that rendered it perfectly. It surfaced only by reading the content stats out of a running client. The fix was quantising the fade into steps, cutting vegetation and trimming four zones.

The second blocker was the same shape: mobile problems are invisible from a desk. A HUD covering half the screen, text too small to read, a jump a touch stick cannot make — none of that shows on a monitor. Every one of them had to be found by holding a phone, which meant the real test loop was deploy, pick up the phone, look.

**13. Do you plan to continue after the Buildathon?** — YOU

**14. Known issues, limitations or special testing instructions**  *(668 chars, cap 960)*

Two mechanics need two players. The plate near the top rises only with two different people on it, and the lever only matters to somebody in the section below. Alone, both are visible and inert — testing them needs a second person in the World.

The server sleeps when the World empties and takes about 15 seconds to cold start, so the first visitor after a quiet period sees the boards fill a moment late. The scene shows a waking-up notice while that happens.

Everything the boards record is server-side: a climb counts only if the server saw you cross the gate line, so teleporting into the middle of the tower produces no time.

No known crashes or blocking bugs.

**15. Decentraland experience before Friendzone** — YOU
**How did you hear about Friendzone?** — YOU
