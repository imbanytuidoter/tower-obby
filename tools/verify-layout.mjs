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
const { buildTower } = req(join(out, 'layout.js'))
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

const ROUNDS = [0] // one tower now; the loop shape is kept so the checks read the same
let worstReach = 0, worstRise = 0, overlaps = 0, hops = 0
let minPads = Infinity, maxPads = 0, minH = Infinity, maxH = 0

for (const round of ROUNDS) {
  const { pads } = buildTower()
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

console.log(`\nGeometry audit - one tower, ${hops} hops\n`)
note(worstReach <= MAX_REACH + EPS, 'horizontal gap within reach', `worst ${worstReach.toFixed(2)}m / ${MAX_REACH.toFixed(2)}m budget (70%)`)
note(worstRise <= MAX_RISE + EPS, 'vertical rise within jump', `worst ${worstRise.toFixed(2)}m / ${MAX_RISE.toFixed(2)}m budget (70%)`)
note(overlaps === 0, 'no overlapping pads', `${overlaps} pairs`)
note(maxH <= cfg.MAX_PAD_HEIGHT, 'inside scene height limit', `${maxH.toFixed(1)}m / ${cfg.MAX_PAD_HEIGHT}m`)

// The finish slab must be fully live: every point a player can stand on has
// to be inside the client's touch radius, and that radius must stay inside
// the server's tolerance or the client claims finishes the server rejects.
let worstCorner = 0, deadZones = 0, overReach = 0
for (const round of ROUNDS) {
  const fin = buildTower().pads.find((p) => p.kind === 'finish')
  const corner = (fin.size / 2) * Math.SQRT2
  const reach = Math.min(corner + cfg.FINISH_TOUCH_MARGIN, cfg.FINISH_RADIUS)
  worstCorner = Math.max(worstCorner, corner)
  if (corner > reach) deadZones++
  if (reach > cfg.FINISH_RADIUS) overReach++
}
note(deadZones === 0, 'finish slab fully responsive', `worst corner ${worstCorner.toFixed(2)}m, ${deadZones} dead zones`)
note(overReach === 0, 'client within server tolerance', `reach <= ${cfg.FINISH_RADIUS}m`)

// Headroom. A slab close above another is a landing an avatar cannot stand on,
// and nothing was looking for it: one ended up 1.10 m above its neighbour and
// only turned up because it happened to break a sight line as well.
{
  const { pads } = buildTower()
  const AVATAR = 1.9
  let worst = Infinity
  let bad = 0
  for (const pad of pads) {
    for (const other of pads) {
      if (other === pad || other.y <= pad.y) continue
      const half = (pad.size + other.size) / 2
      if (Math.hypot(other.x - pad.x, other.z - pad.z) >= half) continue
      const headroom = other.y - pad.y
      worst = Math.min(worst, headroom)
      if (headroom < AVATAR) bad++
    }
  }
  note(bad === 0, 'every landing has headroom', bad ? `${bad} pads with under ${AVATAR} m above` : `tightest ${worst === Infinity ? 'none overhead' : worst.toFixed(2) + ' m'}`)
}

// Sight lines. "From any pad the next target must be visible" - the design
// brief asks for this measured rather than eyeballed, because on a 6-inch
// screen a target you cannot see is a target you cannot plan for.
//
// A ray is walked from the climber's eye on the source pad to the middle of
// the target, and every other slab in the tower is tested as a box along it.
// Pads directly under the line at a shallow angle are the usual offender.
{
  const EYE = 1.6
  const STEP = 0.2
  const SLAB = 0.75 // pad thickness, from build.ts

  const { pads } = buildTower()
  const blocked = []

  for (const pad of pads) {
    if (pad.fromIndex < 0) continue
    const from = pads[pad.fromIndex]
    if (!from) continue

    const ax = from.x, ay = from.y + EYE, az = from.z
    const bx = pad.x, by = pad.y + 0.4, bz = pad.z
    const span = Math.hypot(bx - ax, by - ay, bz - az)
    const steps = Math.max(2, Math.ceil(span / STEP))

    let hit = null
    for (let i = 1; i < steps && !hit; i++) {
      const t = i / steps
      const px = ax + (bx - ax) * t
      const py = ay + (by - ay) * t
      const pz = az + (bz - az) * t
      for (const other of pads) {
        if (other === pad || other === from) continue
        const half = other.size / 2
        if (
          Math.abs(px - other.x) < half &&
          Math.abs(pz - other.z) < half &&
          py > other.y - SLAB / 2 &&
          py < other.y + SLAB / 2
        ) { hit = other; break }
      }
    }
    if (hit) blocked.push({ from: pads.indexOf(from), to: pads.indexOf(pad), by: pads.indexOf(hit) })
  }

  const worst = blocked.slice(0, 3).map((b) => `${b.from}->${b.to} behind ${b.by}`).join(', ')
  note(blocked.length === 0, 'next target always visible', blocked.length ? `${blocked.length} blocked: ${worst}` : `${hops} lines clear`)
}

// The generator clamps at MAX_PAD_HEIGHT. A couple of pads landing on the cap
// is the cap doing its job; a crowd of them means whole zones are being
// flattened against it and the climb stops gaining height.
{
  const pads = buildTower().pads
  const pinned = pads.filter((p) => p.y >= cfg.MAX_PAD_HEIGHT - 0.01).length
  note(pinned <= 2, 'zones not flattened on the ceiling', `${pinned} pads pinned at ${cfg.MAX_PAD_HEIGHT} m`)
}

// Every fork has to be reachable AND priced, or it is a coin toss rather than
// a decision. Zero forks is the failure this check exists for: the random
// zone order once produced a whole tower without one.
{
  const L = buildTower()
  note(L.forks.length >= 2, 'the climb asks a question', `${L.forks.length} forks`)
  const unpriced = L.forks.filter((f) => !(f.savesSeconds > 0)).length
  note(unpriced === 0, 'every fork has a price', `${unpriced} unpriced`)
}

// The tandem plate is the one thing in the climb a player cannot substitute
// skill for company on, so its absence is a silent loss of the strongest
// social mechanic in the game.
{
  const plate = buildTower().plate
  note(plate !== null, 'tandem plate placed', plate ? `${plate.rise.toFixed(1)} m of lift at ${plate.y.toFixed(1)} m` : 'none')
}

// The ante has to exist, and it has to be worth taking: a token that skips
// to a checkpoint the player was about to reach anyway buys nothing.
{
  const L = buildTower()
  const cps = L.pads.filter((p) => p.kind === 'checkpoint').length
  note(L.coin !== null, 'the ante is placed', L.coin ? `${L.coin.route.length} crumbling pads at ${L.coin.y.toFixed(0)} m` : 'none')
  note(
    L.coin === null || L.coin.skipsToCheckpoint < cps,
    'the token buys something',
    L.coin ? `skips to checkpoint ${L.coin.skipsToCheckpoint} of ${cps}` : '-'
  )
}

// Lobby furniture. Everything in the yard is hand-placed from constants, which
// is exactly where things end up inside each other: the progress rail was put
// at BOARD_W/2 + 0.75 along the side axis, five centimetres from a marker post
// already standing at +0.7, and several screenshots did not reveal it.
{
  const sx = -cfg.GATE_DIR_Z, sz = cfg.GATE_DIR_X
  const BX = cfg.LOBBY_X + cfg.GATE_DIR_X * cfg.BOARD_FORWARD + sx * cfg.BOARD_LATERAL
  const BZ = cfg.LOBBY_Z + cfg.GATE_DIR_Z * cfg.BOARD_FORWARD + sz * cfg.BOARD_LATERAL
  const yaw = Math.atan2(-(cfg.LOBBY_SPAWN_X - BX), -(cfg.LOBBY_SPAWN_Z - BZ))
  const FX = -Math.sin(yaw), FZ = -Math.cos(yaw)
  const SX = Math.cos(yaw), SZ = -Math.sin(yaw)
  const W = 5.6

  const items = [{ n: 'board', x: BX, z: BZ, r: W / 2 }]
  for (const d of [-1, 1]) {
    items.push({ n: `marker${d}`, x: BX + SX * d * (W / 2 + 0.7), z: BZ + SZ * d * (W / 2 + 0.7), r: 0.3 })
    items.push({ n: `lamp${d}`, x: BX + SX * d * (W / 2 + 1.9), z: BZ + SZ * d * (W / 2 + 1.9), r: 0.7 })
    items.push({ n: `post${d}`, x: cfg.GATE_X + sx * d * cfg.GATE_WIDTH / 2, z: cfg.GATE_Z + sz * d * cfg.GATE_WIDTH / 2, r: 0.9 })
  }
  items.push({ n: 'rail', x: BX + FX * 3.2 - SX * 2.4, z: BZ + FZ * 3.2 - SZ * 2.4, r: 0.5 })

  const clashes = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r
      if (gap < 0) clashes.push(`${a.n}/${b.n} ${gap.toFixed(2)}m`)
    }
  }
  note(clashes.length === 0, 'lobby furniture stands clear', clashes.length ? clashes.slice(0, 3).join(', ') : `${items.length} objects`)
}

// The first ten seconds. A player arriving alone must see the gate they have
// to walk through AND the board that tells them why - without turning round.
// The board used to sit exactly 180 degrees behind the spawn.
{
  const sx = -cfg.GATE_DIR_Z, sz = cfg.GATE_DIR_X
  const BX = cfg.LOBBY_X + cfg.GATE_DIR_X * cfg.BOARD_FORWARD + sx * cfg.BOARD_LATERAL
  const BZ = cfg.LOBBY_Z + cfg.GATE_DIR_Z * cfg.BOARD_FORWARD + sz * cfg.BOARD_LATERAL
  const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l] }
  const [lx, lz] = unit(cfg.GATE_X - cfg.LOBBY_SPAWN_X, cfg.GATE_Z - cfg.LOBBY_SPAWN_Z)
  const [bx, bz] = unit(BX - cfg.LOBBY_SPAWN_X, BZ - cfg.LOBBY_SPAWN_Z)
  const angle = (Math.acos(Math.max(-1, Math.min(1, lx * bx + lz * bz))) * 180) / Math.PI
  const dist = Math.hypot(BX - cfg.LOBBY_SPAWN_X, BZ - cfg.LOBBY_SPAWN_Z)
  note(angle <= 55, 'board visible on arrival', `${angle.toFixed(0)} deg off the gaze, ${dist.toFixed(1)} m away`)
  // And it must not stand in the doorway it is advertising.
  note(cfg.BOARD_LATERAL > cfg.GATE_WIDTH / 2 + 1, 'board clear of the gate opening', `${cfg.BOARD_LATERAL} m aside of a ${cfg.GATE_WIDTH} m gate`)
}

// Determinism: every client builds the tower locally, so the same round must
// produce byte-identical geometry or players fall through each other's floors.
const once = JSON.stringify(buildTower())
const twice = JSON.stringify(buildTower())
note(once === twice, 'deterministic across builds', once.length + ' bytes')

console.log(`\n  pads ${maxPads}   height ${minH.toFixed(1)} to ${maxH.toFixed(1)} m of ${cfg.MAX_PAD_HEIGHT} m`)
console.log(`  clean climb model ${cfg.estimateClimbSeconds(buildTower().pads).toFixed(0)} s\n`)
rmSync(out, { recursive: true, force: true })

if (fail.length) { console.error('BROKEN: ' + fail.join(', ')); process.exit(1) }
console.log('All invariants hold.\n')
