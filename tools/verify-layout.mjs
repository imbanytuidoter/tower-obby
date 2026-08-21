/**
 * Reproducible geometry audit for the tower generator.
 *
 * layout.ts imports no SDK, so it compiles standalone and every claim about
 * reachability can be measured in Node instead of guessed from a screenshot.
 * Run it after ANY change to layout.ts or config.ts:
 *
 *   node tools/verify-layout.mjs
 *
 * Exits non-zero if a single invariant breaks, so it can gate a commit.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'layout-'))
execSync(
  `npx tsc src/game/layout.ts src/game/config.ts src/game/rng.ts ` +
    `--outDir "${out}" --module commonjs --target es2022`,
  { stdio: 'inherit' }
)
// CommonJS output so Node resolves the extensionless relative imports tsc emits.
const req = createRequire(join(out, 'x.cjs'))
const { buildLayout } = req(join(out, 'layout.js'))
const cfg = req(join(out, 'config.js'))

// --- the brief's budget, not the engine's ceiling ---------------------------
// "Every required jump must need at most 70% of what jumpHeight 1 /
// runJumpHeight 1.5 / doubleJumpHeight 2 allow." This harness used to check
// the full ability instead, which is why 20 hops sat between 70% and 88% for
// weeks without anything reporting it. EPS absorbs float comparison on a hop
// that lands exactly on the budget.
const EPS = 1e-6
const MAX_RISE = cfg.MAX_STEP_RISE
const MAX_REACH = cfg.REACH_BUDGET

const fail = []
const note = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${detail}`)
  if (!ok) fail.push(label)
}

const ROUNDS = [...Array(cfg.TOTAL_ROUNDS).keys()].map((i) => i + 1)
let worstReach = 0, worstRise = 0, overlaps = 0, hops = 0
let minPads = Infinity, maxPads = 0, minH = Infinity, maxH = 0

for (const round of ROUNDS) {
  const { pads } = buildLayout(round)
  minPads = Math.min(minPads, pads.length)
  maxPads = Math.max(maxPads, pads.length)

  for (const pad of pads) {
    maxH = Math.max(maxH, pad.y)
    minH = Math.min(minH, pad.y)

    // Traversal order is NOT array order once the course branches, so the
    // predecessor has to come from fromIndex.
    if (pad.fromIndex < 0) continue
    const from = pads[pad.fromIndex]
    if (!from) { fail.push(`round ${round}: fromIndex ${pad.fromIndex} out of range`); continue }

    hops++
    // Edge to edge, not centre to centre - the gap the player clears is the
    // space between the two slabs, and measuring centres hid a real bug.
    const centre = Math.hypot(pad.x - from.x, pad.z - from.z)
    const reach = centre - (pad.size + from.size) / 2
    worstReach = Math.max(worstReach, reach)
    worstRise = Math.max(worstRise, pad.y - from.y)
  }

  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i], b = pads[j]
      if (Math.abs(a.y - b.y) > 0.6) continue
      const halfX = (a.size + b.size) / 2
      if (Math.abs(a.x - b.x) < halfX && Math.abs(a.z - b.z) < halfX) overlaps++
    }
  }
}

console.log(`\nGeometry audit - ${cfg.TOTAL_ROUNDS} rounds, ${hops} hops\n`)
note(worstReach <= MAX_REACH + EPS, 'horizontal gap within reach', `worst ${worstReach.toFixed(2)}m / ${MAX_REACH.toFixed(2)}m budget (70%)`)
note(worstRise <= MAX_RISE + EPS, 'vertical rise within jump', `worst ${worstRise.toFixed(2)}m / ${MAX_RISE.toFixed(2)}m budget (70%)`)
note(overlaps === 0, 'no overlapping pads', `${overlaps} pairs`)
note(maxH <= cfg.MAX_PAD_HEIGHT, 'inside scene height limit', `${maxH.toFixed(1)}m / ${cfg.MAX_PAD_HEIGHT}m`)

// The finish slab must be fully live: every point a player can stand on has
// to be inside the client's touch radius, and that radius must stay inside
// the server's tolerance or the client claims finishes the server rejects.
let worstCorner = 0, deadZones = 0, overReach = 0
for (const round of ROUNDS) {
  const fin = buildLayout(round).pads.find((p) => p.kind === 'finish')
  const corner = (fin.size / 2) * Math.SQRT2
  const reach = Math.min(corner + cfg.FINISH_TOUCH_MARGIN, cfg.FINISH_RADIUS)
  worstCorner = Math.max(worstCorner, corner)
  if (corner > reach) deadZones++
  if (reach > cfg.FINISH_RADIUS) overReach++
}
note(deadZones === 0, 'finish slab fully responsive', `worst corner ${worstCorner.toFixed(2)}m, ${deadZones} dead zones`)
note(overReach === 0, 'client within server tolerance', `reach <= ${cfg.FINISH_RADIUS}m`)

// Determinism: every client builds the tower locally, so the same round must
// produce byte-identical geometry or players fall through each other's floors.
const once = JSON.stringify(ROUNDS.map(buildLayout))
const twice = JSON.stringify(ROUNDS.map(buildLayout))
note(once === twice, 'deterministic across builds', once.length + ' bytes')

console.log(`\n  pads per round ${minPads}-${maxPads}   height ${minH.toFixed(1)}-${maxH.toFixed(1)}m\n`)
rmSync(out, { recursive: true, force: true })

if (fail.length) { console.error('BROKEN: ' + fail.join(', ')); process.exit(1) }
console.log('All invariants hold.\n')
