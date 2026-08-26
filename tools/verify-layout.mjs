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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'layout-'))
execSync(
  `npx tsc src/game/layout.ts src/game/config.ts src/game/rng.ts src/game/palette.ts ` +
    `--outDir "${out}" --module commonjs --target es2022`,
  { stdio: 'inherit' }
)
// CommonJS output so Node resolves the extensionless relative imports tsc emits.
const req = createRequire(join(out, 'x.cjs'))
const { buildTower, backdropRing, BACKDROP_PANELS, treeLine, checkpointAltitudes, undergrowth, lobbyFixtures, trunkGrowth } =
  req(join(out, 'layout.js'))
const cfg = req(join(out, 'config.js'))
const palette = req(join(out, 'palette.js'))

// --- the brief's budget, not the engine's ceiling ---------------------------
// "Every required jump must need at most DIFFICULTY_BUDGET of what jumpHeight 1 /
// runJumpHeight 1.5 / doubleJumpHeight 2 allow." This harness used to check
// the full ability instead, which is why 20 hops sat between 70% and 88% for
// weeks without anything reporting it. EPS absorbs float comparison on a hop
// that lands exactly on the budget.
const EPS = 1e-6
const MAX_RISE = cfg.MAX_STEP_RISE
const MAX_REACH = cfg.REACH_BUDGET

const fail = []
let checks = 0
const note = (ok, label, detail) => {
  checks++
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
note(worstReach <= MAX_REACH + EPS, 'horizontal gap within reach', `worst ${worstReach.toFixed(2)}m / ${MAX_REACH.toFixed(2)}m budget (${Math.round(cfg.DIFFICULTY_BUDGET * 100)}% of ability)`)
note(worstRise <= MAX_RISE + EPS, 'vertical rise within jump', `worst ${worstRise.toFixed(2)}m / ${MAX_RISE.toFixed(2)}m budget (${Math.round(cfg.DIFFICULTY_BUDGET * 100)}% of ability)`)
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

// The scene.json spawn box, which is what actually places an arriving player -
// the code's movePlayerTo only runs afterwards. The box used to straddle the
// gate: a player could land on the start line and have their run begin before
// they had seen anything.
{
  const scene = JSON.parse(readFileSync('scene.json', 'utf8'))
  const box = scene.spawnPoints?.[0]?.position
  const behind = (x, z) => {
    const dx = x - cfg.GATE_X, dz = z - cfg.GATE_Z
    return dx * cfg.GATE_DIR_X + dz * cfg.GATE_DIR_Z < -1
  }
  const corners = box
    ? [[box.x[0], box.z[0]], [box.x[0], box.z[1]], [box.x[1], box.z[0]], [box.x[1], box.z[1]]]
    : []
  const bad = corners.filter(([x, z]) => !behind(x, z)).length
  note(box && bad === 0, 'nobody spawns past the start line', box ? `${bad} of 4 corners past the gate` : 'no spawnPoints')
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
  // Nothing may stand between the spawn and the board's face. The climber
  // rail did for two commits: its position had been searched for a spot that
  // OVERLAPPED nothing, which is a different question from blocking nothing,
  // and it landed three metres directly in front.
  const RAIL_ASIDE = cfg.BOARD_W_TEST !== undefined ? cfg.BOARD_W_TEST : 5.6 / 2 + 3.4
  const railX = BX - sx * RAIL_ASIDE
  const railZ = BZ - sz * RAIL_ASIDE
  const [rx, rz] = unit(railX - cfg.LOBBY_SPAWN_X, railZ - cfg.LOBBY_SPAWN_Z)
  const railAngle = (Math.acos(Math.max(-1, Math.min(1, rx * bx + rz * bz))) * 180) / Math.PI
  // Half the board's angular width from the spawn, plus a margin.
  const halfBoard = (Math.atan((5.6 / 2) / dist) * 180) / Math.PI
  note(railAngle > halfBoard + 4, 'nothing blocks the board from the spawn',
    `rail sits ${railAngle.toFixed(0)} deg off, board spans ${halfBoard.toFixed(0)} deg`)

  // Deliberately behind: the board is for browsing and wants to be square in
  // front of you, while the number that matters on arrival is on the gate at
  // eye height. An earlier rule demanded the opposite; this replaces it.
  note(angle >= 150, 'board stands behind the start', `${angle.toFixed(0)} deg from the gaze, ${dist.toFixed(1)} m back`)
  note(Math.abs(cfg.BOARD_LATERAL) < 0.01, 'board centred on the axis', `${cfg.BOARD_LATERAL} m off centre`)
  // Behind means behind: it must never end up between the spawn and the gate.
  note(cfg.BOARD_FORWARD < 0, 'board is not in the doorway', `${cfg.BOARD_FORWARD} m from the lobby centre`)
  // And it has to stay on the deck it is standing on.
  note(Math.abs(cfg.BOARD_FORWARD) < cfg.LOBBY_SIZE / 2 - 1, 'board stands on the deck',
    `${Math.abs(cfg.BOARD_FORWARD)} m back of a ${cfg.LOBBY_SIZE / 2} m half-deck`)
}

// The backdrop is a wall, not a set of spikes.
//
// This check exists because the ring shipped rotated 90 degrees for two
// commits: every panel's long axis pointed along the radius instead of along
// the tangent, so fourteen 16 m boxes per band stabbed straight out of the
// tower and filled the screen. Nothing caught it - the pads were all still
// legal, the material count was fine, and the only witness was a screenshot.
// Two numbers settle it: the long axis must be perpendicular to the radius,
// and consecutive panels must actually touch.
{
  const panels = backdropRing()

  // Every wall must be axis-aligned and must face the centre broadside: its
  // long axis perpendicular to its own outward normal. The ring this replaced
  // once shipped rotated ninety degrees and only a screenshot noticed.
  let worstDot = 0
  for (const p of panels) {
    const nx = Math.sign(Math.round(p.x - cfg.CENTER_X))
    const nz = Math.sign(Math.round(p.z - cfg.CENTER_Z))
    const phi = (p.yaw * Math.PI) / 180
    // Local +Z after a yaw of phi points at (sin phi, cos phi) in world x/z.
    worstDot = Math.max(worstDot, Math.abs(Math.sin(phi) * nx + Math.cos(phi) * nz))
  }
  note(worstDot < 0.02, 'walls face the field broadside',
    `worst |axis . normal| ${worstDot.toFixed(4)} (1.0 = a spoke)`)

  // Four walls, and each long enough to reach past both corners.
  const overhang = panels[0].length / 2 - cfg.BACKDROP_HALF
  note(overhang > 0, 'boundary closes at the corners',
    `each wall overhangs its corner by ${overhang.toFixed(2)} m`)

  // The wall is a square, so its nearest point to the tower is the middle of
  // a side, not a corner.
  note(cfg.BACKDROP_HALF > cfg.SHAFT_MAX_RADIUS + 4, 'boundary stands clear of the climb',
    `${cfg.BACKDROP_HALF} m to a wall, pads reach ${cfg.SHAFT_MAX_RADIUS} m`)

  // And it has to stay inside the 80 x 80 scene or the client clips it away.
  const outer = cfg.BACKDROP_HALF + panels[0].thickness / 2
  note(outer < cfg.GROUND_SIZE / 2, 'boundary inside the scene',
    `outer face at ${outer.toFixed(1)} m of a ${cfg.GROUND_SIZE / 2} m half-field`)
}

// Nothing may stick out of the 80 x 80 scene. Content outside the parcels is
// clipped by the client - a wall gets its end sliced off, a tree loses half a
// canopy - and the Creator Hub only reports a count, never which entity.
//
// The half-extent has to be rotated: a 0.4 x 79.2 wall is 39.6 m wide along
// ONE axis, and which one depends on its yaw.
{
  const FIELD = cfg.GROUND_SIZE
  let worst = -Infinity
  let culprit = 'nothing'

  const check = (name, x, z, hx, hz) => {
    const over = Math.max(-(x - hx), x + hx - FIELD, -(z - hz), z + hz - FIELD)
    if (over > worst) { worst = over; culprit = name }
  }

  for (const p of backdropRing()) {
    const a = (p.yaw * Math.PI) / 180
    const c = Math.abs(Math.cos(a))
    const si = Math.abs(Math.sin(a))
    const sx = p.thickness / 2
    const sz = p.length / 2
    check('wall', p.x, p.z, sx * c + sz * si, sx * si + sz * c)
  }
  for (const t of treeLine()) check('tree', t.x, t.z, cfg.TREE_CANOPY_RADIUS, cfg.TREE_CANOPY_RADIUS)
  for (const pad of buildTower().pads) check('pad', pad.x, pad.z, pad.size / 2, pad.size / 2)
  check('lobby', cfg.LOBBY_X, cfg.LOBBY_Z, cfg.LOBBY_SIZE / 2, cfg.LOBBY_SIZE / 2)

  note(worst <= 0, 'everything stays inside the field',
    'closest to the edge: ' + culprit + ', ' + (-worst).toFixed(1) + ' m of margin')
}

// The forest edge must stand outside everything it could ruin.
//
// Set to radius 27 once, which put trees through the leaderboard and the
// spawn camera inside a canopy - the lobby is a 24 m square whose corners
// reach much further out than its centre radius suggests.
{
  const trees = treeLine()
  const half = cfg.LOBBY_SIZE / 2

  let deepest = 0
  for (const t of trees) {
    const dx = Math.max(0, Math.abs(t.x - cfg.LOBBY_X) - half)
    const dz = Math.max(0, Math.abs(t.z - cfg.LOBBY_Z) - half)
    // The TRUNK must clear the deck. A canopy overhanging the edge of a
    // clearing is the point of a clearing; a trunk on the deck is an obstacle.
    deepest = Math.max(deepest, cfg.TREE_TRUNK_RADIUS - Math.hypot(dx, dz))
  }
  note(deepest <= 0, 'tree trunks stand clear of the deck',
    trees.length + ' trees, deepest intrusion ' + Math.max(0, deepest).toFixed(2) + ' m')

  let nearest = Infinity
  for (const t of trees) {
    nearest = Math.min(nearest,
      Math.hypot(t.x - cfg.CENTER_X, t.z - cfg.CENTER_Z) - cfg.TREE_CANOPY_RADIUS)
  }
  note(nearest > cfg.SHAFT_MAX_RADIUS + 2, 'canopies stand clear of the climb',
    'nearest canopy ' + nearest.toFixed(1) + ' m, pads reach ' + cfg.SHAFT_MAX_RADIUS + ' m')

  // The ring must actually surround the clearing. A third of it went missing
  // once - deleted rather than moved - leaving the board against bare wall in
  // the one direction a player faces to read it.
  const quadrants = new Set()
  for (const t of trees) {
    const a = Math.atan2(t.z - cfg.CENTER_Z, t.x - cfg.CENTER_X)
    quadrants.add(Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)))
  }
  // A canopy poking through the boundary wall reads as a tree growing out of
  // a solid surface. The wall is a square, so this is a per-axis test.
  let worstPoke = -Infinity
  for (const t of trees) {
    const px = Math.abs(t.x - cfg.CENTER_X) + cfg.TREE_CANOPY_RADIUS - cfg.BACKDROP_HALF
    const pz = Math.abs(t.z - cfg.CENTER_Z) + cfg.TREE_CANOPY_RADIUS - cfg.BACKDROP_HALF
    worstPoke = Math.max(worstPoke, px, pz)
  }
  note(worstPoke < 0, 'no canopy grows through the wall',
    'closest canopy stops ' + (-worstPoke).toFixed(1) + ' m short of it')

  note(quadrants.size === 4, 'forest surrounds the clearing',
    quadrants.size + ' of 4 quadrants have trees')
}

// The brief's load-bearing rule: "a pad is always lighter than what is behind
// it". It was false for the understory once - backdrop 0.846 against pads
// 0.635 - because the panels self-lit at 0.85 and overtook the climb.
//
// This check was silently deleted while the backdrop block around it was being
// rewritten for the square wall, and nothing noticed for one commit. It counts
// the slab texture now: an untextured wall delivers all of its albedo, a
// textured pad does not.
{
  const rows = palette.valueSeparation()
  const worst = rows.reduce((a, b) => (a.margin < b.margin ? a : b))
  note(worst.margin > 0.12, 'pads read lighter than the backdrop',
    'tightest ' + worst.band + ': pad ' + worst.pad.toFixed(2) +
    ' vs wall ' + worst.backdrop.toFixed(2) + ' (+' + worst.margin.toFixed(2) + ')')
}

// A collar on the trunk means "a checkpoint is at this height", so it has to
// be at that height. They were first spaced evenly up the trunk while the
// climb rises unevenly, which put every one of them off by metres.
{
  const tower = buildTower()
  const ys = checkpointAltitudes(tower)
  const marked = tower.pads.filter((pad) => pad.kind === 'checkpoint')

  note(ys.length === marked.length && ys.length > 0, 'every checkpoint gets a collar',
    ys.length + ' collars for ' + marked.length + ' checkpoints')

  let worst = 0
  for (let i = 0; i < marked.length; i++) worst = Math.max(worst, Math.abs(ys[i] - marked[i].y))
  note(worst < 0.001, 'collars sit at the checkpoint height',
    'worst drift ' + worst.toFixed(3) + ' m')

  // And they have to be spread out, or the trunk says nothing.
  const sorted = [...ys].sort((a, b) => a - b)
  let tightest = Infinity
  for (let i = 1; i < sorted.length; i++) tightest = Math.min(tightest, sorted[i] - sorted[i - 1])
  note(tightest > 2, 'collars are far enough apart to read',
    'closest pair ' + tightest.toFixed(1) + ' m')
}

// Every pickup has to be takeable, and none of them may be required.
//
// Optional does not mean unreachable: a coin nobody can get is worse than no
// coin, because the counter tells you it exists.
{
  const tower = buildTower()
  const list = tower.pickups
  let worstReach = 0
  let worstRise = 0

  for (const p of list) {
    const pad = tower.pads[p.fromPad]
    // From the EDGE of the pad you jump off, not its centre, and the pickup
    // has a radius you only have to touch.
    const gap = Math.hypot(p.x - pad.x, p.z - pad.z) - pad.size / 2 - cfg.PICKUP_RADIUS
    worstReach = Math.max(worstReach, gap)
    worstRise = Math.max(worstRise, p.y - pad.y)
  }

  note(list.length === cfg.PICKUP_COUNT, 'every pickup found a home',
    list.length + ' of ' + cfg.PICKUP_COUNT + ' placed')
  // This one measured the coin against the pad it belongs to, and now that
  // every coin sits on its OWN ledge it can only ever read 0.00 - a check
  // that cannot fail is a check that is lying about being one. What matters
  // instead is that the ledge is REACHED FROM somewhere, which is the pad
  // recorded in fromIndex, and that it exists at all.
  let worstPerch = 0
  let homeless = 0
  for (const p of list) {
    const perch = tower.pads[p.fromPad]
    if (!perch || Math.hypot(p.x - perch.x, p.z - perch.z) > 0.01) { homeless++; continue }
    const from = tower.pads[perch.fromIndex]
    if (!from) { homeless++; continue }
    worstPerch = Math.max(
      worstPerch,
      Math.hypot(perch.x - from.x, perch.z - from.z) - (perch.size + from.size) / 2
    )
  }
  note(homeless === 0, 'every coin stands on a ledge',
    homeless + ' of ' + list.length + ' hanging in open air')
  note(worstPerch <= MAX_REACH, 'coin ledges are within a jump of the route',
    'furthest ' + worstPerch.toFixed(2) + ' m of a ' + MAX_REACH.toFixed(2) + ' m budget')
  note(worstRise <= MAX_RISE + 1.0, 'pickups hang within arm of a pad',
    'highest ' + worstRise.toFixed(2) + ' m above its pad')

  // And they must be spread, or "come back for the ones you missed" is one trip.
  const ys = list.map((p) => p.y).sort((a, b) => a - b)
  const spread = ys.length > 1 ? ys[ys.length - 1] - ys[0] : 0
  note(spread > 30, 'pickups are spread up the climb',
    'from ' + ys[0].toFixed(0) + ' m to ' + ys[ys.length - 1].toFixed(0) + ' m')
}

// The widest gap has to be crossable by a documented jump, not by an estimate.
//
// REACH_ABILITY is the one number in config.ts with no source, and every claim
// about difficulty was resting on it. This check does not use it. It uses the
// documented jog speed and a deliberately harsh gravity, and asks whether the
// airtime of a double jump covers the airtime the widest gap demands.
{
  const airtimeNeeded = worstReach / cfg.JOG_SPEED
  const apex = cfg.DOUBLE_JUMP_HEIGHT
  const airtimeAvailable = 2 * Math.sqrt((2 * apex) / cfg.PESSIMISTIC_GRAVITY)
  const share = airtimeNeeded / airtimeAvailable

  // 0.82, raised from 0.72, raised from 0.60 - three times now, each on an
  // explicit request to open the gaps out further.
  //
  // This is the scene's safety margin against a thumb on a virtual stick, and
  // it is being spent knowingly: 0.60 was itself a retreat from 0.70 after a
  // phone player said the parkour was too hard. A literal 1.5x on the gaps
  // measured 0.90 of the airtime, which is not a difficulty setting - it is
  // the difference between hard and not completable - so this stops short of
  // it and the number is stated rather than buried.
  note(share <= 0.82, 'the widest gap fits inside a documented jump',
    'needs ' + airtimeNeeded.toFixed(2) + ' s of the ' + airtimeAvailable.toFixed(2) +
    ' s a double jump gives at ' + cfg.PESSIMISTIC_GRAVITY + ' m/s2 (' +
    Math.round(share * 100) + '%)')
}

// No pad may hang over another as a ceiling.
//
// VERTICAL_CLEARANCE is a RADIAL keep-out, so once two pads were 2.5 m apart
// in height they could sit anywhere - including directly on top of each other.
// Eleven pairs did, the worst overlapping 4.8 x 5.7 m with three metres of
// headroom, and from below that reads as a heap of slabs rather than a climb.
// It was reported three times by the first person to play it before anything
// in this harness had an opinion about it.
{
  const pads = buildTower().pads
  let worst = 0
  let stacked = 0

  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i]
      const b = pads[j]
      const dy = Math.abs(a.y - b.y)
      if (dy >= cfg.CEILING_CLEARANCE) continue

      // Box test, not radial: two pads may stand close beside each other at
      // different heights - that is a staircase - but neither may hang over
      // the other.
      const overX = (a.size + b.size) / 2 - Math.abs(a.x - b.x)
      const overZ = (a.size + b.size) / 2 - Math.abs(a.z - b.z)
      if (overX <= 0 || overZ <= 0) continue

      // Pads inside the radial band are already governed by VERTICAL_CLEARANCE
      // and may clip corners; the ceiling rule only owns the band above it.
      if (dy <= cfg.VERTICAL_CLEARANCE) continue

      stacked++
      worst = Math.max(worst, Math.min(overX, overZ))
    }
  }

  note(stacked === 0, 'no pad hangs over another',
    stacked + ' stacked pairs, worst overlap ' + worst.toFixed(2) + ' m')
}

// The crown must be findable by KIND, and must be the top of the climb.
//
// It used to be identifiable by index - it was simply the last pad pushed -
// and build.ts read `pads[pads.length - 1]` to place the finish celebration.
// Then coin ledges started being appended AFTER the crown was marked, and the
// last pad became a 2.6 m perch in the middle of the tower. The fireworks
// moved there. Nothing threw, nothing logged, and the only symptom was a
// summit that no longer celebrated.
{
  const pads = buildTower().pads
  const finishes = pads.filter((p) => p.kind === 'finish')
  const highest = pads.reduce((a, b) => (b.y > a.y ? b : a))

  note(finishes.length === 1, 'exactly one pad is the crown',
    finishes.length + ' pads marked finish')
  note(finishes.length === 1 && finishes[0] === highest,
    'the crown is the top of the climb',
    finishes.length === 1
      ? 'crown at ' + finishes[0].y.toFixed(1) + ' m, highest pad at ' + highest.y.toFixed(1) + ' m'
      : 'no single crown to check')
  note(finishes.length === 1 && finishes[0].size >= 9,
    'the crown is wide enough to stand and look around',
    finishes.length === 1 ? finishes[0].size.toFixed(1) + ' m across' : 'n/a')

  /**
   * The roll of names hangs on the two banners, and their width is DERIVED
   * from the crown: outer edge just inside the column shafts, inner edge
   * leaving a 2 m gap so the greeter behind them is not walled off.
   *
   * Narrow the crown and that derivation quietly collapses - the banners
   * shrink towards nothing and the names hang off cloth too small to hold
   * them, which is precisely how the tandem plate once vanished when the pads
   * were widened for mobile. Nothing renders an error for it; the wall would
   * simply stop being readable, and only on the one pad nobody tests.
   *
   * Reproduced here from build.ts rather than imported, because build.ts
   * imports the SDK and will not compile standalone. If the two ever disagree
   * this check is worthless, so it asserts the INPUT the derivation needs -
   * the width - and not the arithmetic itself.
   */
  /**
   * The grove's daily target has to be reachable by ONE person.
   *
   * A coin is remembered against the player who found it and can never be
   * found again, so a single climber can contribute at most PICKUP_COUNT no
   * matter how long they stay. Raise the target above that - or cut the number
   * of coins in the tower without looking here - and a player alone in the
   * world can never light the crown, which makes the one visible payoff of a
   * shared feature invisible to the only person this scene is guaranteed to
   * get: somebody arriving by themselves.
   *
   * Nothing would report that as an error. The counter would simply stop
   * short, every day, forever.
   */
  note(cfg.HAUL_TARGET <= cfg.PICKUP_COUNT,
    "the grove's daily target is reachable alone",
    'target ' + cfg.HAUL_TARGET + ', one climber can carry ' + cfg.PICKUP_COUNT)

  const ROLL_GAP = 1.0
  const PLINTH_HALF = 0.75
  const half = finishes.length === 1
    ? Math.max(1.6, finishes[0].size / 2 - PLINTH_HALF - 0.3)
    : 0
  const rollWidth = half - 0.55 - ROLL_GAP
  // Ten characters and a time at fontSize 1.5 measure about 1.4 m of text.
  /**
   * The co-op discs, checked at the size the RENDERER draws them.
   *
   * This is the check that was missing for the whole life of the scene, and
   * its absence is not an oversight about one object - it is the shape of the
   * whole harness. Everything here compiles layout.ts, where a lever is a
   * position and a number; the 4.4 m gold disc that appears in the world is
   * created in build.ts, which imports the SDK and cannot be compiled here.
   * So the model said 2.4 m and fitted, the world drew 4.4 m and did not, and
   * seventy-three passing invariants had nothing to say about it.
   *
   * COOP_PAD_SIZE is now one constant read by the search, by createPressurePad
   * and by this check, so the three cannot drift apart again without this
   * failing. Circle against box, because that is what these two things are.
   */
  {
    const t = buildTower()
    const discs = [
      ...t.levers.map((l) => ({ what: 'lever', ...l })),
      ...(t.shortcut
        ? [
            { what: 'shortcut A', ...t.shortcut.padA },
            { what: 'shortcut B', ...t.shortcut.padB }
          ]
        : [])
    ]
    const radius = cfg.COOP_PAD_SIZE / 2
    let worstBite = 0
    let where = 'nothing within reach of a pad'

    for (const disc of discs) {
      for (const pad of t.pads) {
        if (Math.abs(pad.y - disc.y) > 1.0) continue
        const half = pad.size / 2
        // Nearest point on the square pad to the centre of the round disc.
        const nx = Math.max(pad.x - half, Math.min(disc.x, pad.x + half))
        const nz = Math.max(pad.z - half, Math.min(disc.z, pad.z + half))
        const bite = radius - Math.hypot(disc.x - nx, disc.z - nz)
        // A disc sitting ON its own pad is the point; it is the same size, so
        // its centre is inside and the bite is the full radius. Anything that
        // reaches into a pad it is NOT standing on is the defect.
        const ownPad = Math.abs(pad.size - cfg.COOP_PAD_SIZE) < 0.01 &&
          Math.hypot(pad.x - disc.x, pad.z - disc.z) < 0.01
        if (ownPad || bite <= 0) continue
        if (bite > worstBite) {
          worstBite = bite
          where = disc.what + ' cuts ' + bite.toFixed(2) + ' m into a ' +
            pad.size.toFixed(1) + ' m ' + pad.kind
        }
      }
    }

    note(worstBite === 0, 'no co-op pad cuts into a pad it is not standing on', where)
  }

  /**
   * No sweeping bar may slice a pad.
   *
   * Every bar hangs HAZARD_CLEARANCE above the pad it guards, which clears
   * THAT pad and says nothing about the neighbours - and its length came from
   * its own pad's size. A twelve-metre arm turning at one height meets
   * whatever else stands at that height: measured, one cut 6 cm into a 2.45 m
   * slab six metres away.
   *
   * Six centimetres is nothing to walk into and everything to look at. At that
   * separation the depth buffer cannot choose between the two surfaces, so the
   * overlap tears into a fan of flickering shards - photographed twice and
   * reported as a texture bug, and invisible to every check here because a
   * bar is not a pad and nothing compared the two.
   */
  {
    const t = buildTower()
    const half = 0.5 + cfg.HAZARD_THICKNESS / 2
    let worst = 0
    let where = 'no bar reaches a pad at its own height'

    /**
     * Movers are not bars.
     *
     * They were folded into this check with `bar.length ?? 6`, which invents a
     * six-metre rotating stick for an object that is a box sliding along one
     * axis. So the check reported a mover "cutting" the crown when nothing of
     * the sort was happening, and no clamp could ever have satisfied it - the
     * shape it was measuring did not exist.
     *
     * A rule applied to the wrong model is worse than no rule: it fails
     * honestly-looking failures that cannot be fixed, which is how an hour
     * gets spent shortening something that was never too long.
     */
    for (const bar of t.spinners) {
      const reach = (bar.length ?? 6) / 2
      const lo = bar.y - cfg.HAZARD_THICKNESS / 2
      const hi = bar.y + cfg.HAZARD_THICKNESS / 2
      for (const pad of t.pads) {
        if (Math.abs(pad.y - bar.y) >= half) continue
        // Corner distance: a square's corner is what a turning bar meets first.
        if (Math.hypot(pad.x - bar.x, pad.z - bar.z) - pad.size * 0.7072 > reach) continue
        const cut = Math.min(hi, pad.y + 0.5) - Math.max(lo, pad.y - 0.5)
        if (cut > worst) {
          worst = cut
          where = 'a bar cuts ' + cut.toFixed(2) + ' m of a ' + pad.size.toFixed(1) +
            ' m pad at ' + pad.y.toFixed(1) + ' m'
        }
      }
    }

    note(worst === 0, 'no sweeping bar slices a pad', where)
  }

  /**
   * Nothing solid may overlap anything else, pad or not.
   *
   * This replaces the narrower co-op check above with the rule it should have
   * been. The tower has eight solids that are not pads - the tandem plate, the
   * ante's three slabs, two shortcut pressure pads and two lever discs - and
   * each is placed by a search that tests itself against out.pads, a list none
   * of them are in. So each was clear when it was placed, every one of them
   * was correct on its own, and the plate and an ante slab still came to rest
   * at the same height 0.58 m apart with the slab's corners standing through
   * the plate. Four screenshots, three wrong diagnoses.
   *
   * A disc sitting on its OWN pad is the point and is excused; anything else
   * sharing space is the defect.
   */
  {
    const t = buildTower()
    const solids = []
    if (t.plate) solids.push({ what: 'the tandem plate', x: t.plate.x, y: t.plate.y, z: t.plate.z, size: 3.6 })
    if (t.coin) t.coin.route.forEach((r, i) =>
      solids.push({ what: 'ante slab ' + (i + 1), x: r.x, y: r.y, z: r.z, size: 2.1 }))
    if (t.shortcut) {
      solids.push({ what: 'shortcut pad A', ...t.shortcut.padA, size: cfg.COOP_PAD_SIZE })
      solids.push({ what: 'shortcut pad B', ...t.shortcut.padB, size: cfg.COOP_PAD_SIZE })
    }
    t.levers.forEach((l, i) =>
      solids.push({ what: 'lever ' + (i + 1), x: l.x, y: l.y, z: l.z, size: cfg.COOP_PAD_SIZE }))

    const hit = (a, b, sa, sb) => {
      if (Math.abs(a.y - b.y) > 0.8) return 0
      const ox = (sa + sb) / 2 - Math.abs(a.x - b.x)
      const oz = (sa + sb) / 2 - Math.abs(a.z - b.z)
      return ox > 0 && oz > 0 ? Math.min(ox, oz) : 0
    }

    let worst = 0
    let where = solids.length + ' non-pad solids, none of them touching anything'
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const bite = hit(solids[i], solids[j], solids[i].size, solids[j].size)
        if (bite > worst) { worst = bite; where = solids[i].what + ' overlaps ' + solids[j].what + ' by ' + bite.toFixed(2) + ' m' }
      }
      for (const pad of t.pads) {
        const own = Math.abs(pad.size - solids[i].size) < 0.01 &&
          Math.hypot(pad.x - solids[i].x, pad.z - solids[i].z) < 0.01
        if (own) continue
        const bite = hit(solids[i], pad, solids[i].size, pad.size)
        if (bite > worst) { worst = bite; where = solids[i].what + ' overlaps a ' + pad.size.toFixed(1) + ' m ' + pad.kind + ' by ' + bite.toFixed(2) + ' m' }
      }
    }

    note(worst === 0, 'nothing solid overlaps anything else', where)
  }

  note(rollWidth >= 1.4,
    'the crown banners are wide enough to carry a name',
    rollWidth.toFixed(2) + ' m of cloth per banner, 1.40 m of text')
}

// The jungle floor exists, stays out of the way, and stays affordable.
//
// Undergrowth is the cheapest thing in the scene to add and the easiest to
// let sprawl: every instance is a material on a budget that is already at
// 96%, and a plant that wanders into the shaft ends up embedded in a pad.
{
  const plants = undergrowth()
  let inShaftCount = 0
  let onDeck = 0
  const halfLobby = cfg.LOBBY_SIZE / 2

  for (const p of plants) {
    if (Math.hypot(p.x - cfg.CENTER_X, p.z - cfg.CENTER_Z) < cfg.SHAFT_MAX_RADIUS) inShaftCount++
    if (Math.abs(p.x - cfg.LOBBY_X) < halfLobby && Math.abs(p.z - cfg.LOBBY_Z) < halfLobby) onDeck++
  }

  // fern and junglePlant are 1 primitive each - measured out of the GLBs,
  // because the catalog does not publish primitive counts.
  const cost = plants.length

  /**
   * Twelve, not twenty-one.
   *
   * Planting and pads compete for the same budget, and the mobile client bills
   * one material per mesh with a soft cap at 400. The tower grew from 137 pads
   * to 189 and the scene measured 462 materials - over the cap, which on a
   * handset is a scene that struggles to load at all. Something had to go, and
   * between a climb with more of it and a floor with more on it, the climb is
   * the game.
   *
   * The floor still has to read as a jungle floor rather than a lawn with
   * three ferns, so the number is lowered deliberately rather than removed.
   */
  note(plants.length >= 12, 'the jungle floor is actually planted',
    plants.length + ' plants on the floor')
  note(inShaftCount === 0, 'no plant grows inside the climb',
    inShaftCount + ' inside the ' + cfg.SHAFT_MAX_RADIUS + ' m shaft')
  note(onDeck === 0, 'no plant grows through the lobby deck', onDeck + ' on the deck')

  // Plants and firs share the same radii, so this is not hypothetical: one
  // plant landed 0.68 m from a trunk that needs 1.96, i.e. inside the tree.
  let worstTrunk = 99
  for (const plant of plants) {
    for (const tree of treeLine()) {
      const need = cfg.TREE_TRUNK_RADIUS * (tree.scale / cfg.TREE_SCALE) + 0.9
      worstTrunk = Math.min(worstTrunk, Math.hypot(plant.x - tree.x, plant.z - tree.z) - need)
    }
  }
  note(worstTrunk >= 0, 'no plant grows inside a tree',
    'closest clearance ' + worstTrunk.toFixed(2) + ' m')

  // The two noticeboards and the torches beside them. layout.ts could not see
  // any of it until their coordinates moved into config.ts, and in the
  // meantime a fern grew 0.64 m into the legend board and another clipped the
  // leaderboard - on a board whose entire job is to be read.
  let worstFixture = 99
  for (const plant of plants) {
    for (const f of lobbyFixtures()) {
      worstFixture = Math.min(
        worstFixture,
        Math.hypot(plant.x - f.x, plant.z - f.z) - f.radius - plant.scale * 0.35
      )
    }
  }
  note(worstFixture >= 0, 'no plant grows through a noticeboard or a torch',
    'closest clearance ' + worstFixture.toFixed(2) + ' m')
  // 55, raised from 40 when the deck fringe went in. The allowance exists to
  // stop the cheapest thing in the scene from sprawling unnoticed, not to
  // block a deliberate increase - so it moves only alongside a matching cut
  // somewhere else. This one was paid for by dropping ground shadows from
  // 12 m to 9 m, which returned twelve slots nobody can see.
  // Everything green, together, against one allowance.
  //
  // Checking the floor alone was not enough: adding trunk growth pushed the
  // LIVE scene to 403 and then 404 of a 400 material soft limit twice in one
  // sitting, and the harness said nothing both times because it was only
  // watching one of the three places plants grow.
  //
  // Primitive counts are measured out of the GLBs - fern 1, junglePlant 1,
  // bush 2, fir 2 - because the catalog does not publish them and they are
  // what the mobile client actually bills.
  const trunk = trunkGrowth(buildTower().pads)
  const firs = treeLine().length
  const green = cost + trunk.length + firs * 2

  note(cost <= 55, 'the undergrowth stays inside its material allowance',
    cost + ' materials of a 55 allowance')
  note(green <= 78, 'all the vegetation together stays inside its allowance',
    green + ' materials of a 78 allowance - floor ' + cost +
    ', trunk ' + trunk.length + ', firs ' + firs)
}

// Growth on the trunk must never reach a surface a player lands on.
//
// The whole justification for putting the jungle up the tower rather than on
// the pads is that the trunk tops out at radius 2.5 and the nearest pad sits
// at 6. If that stops being true the plants stop being scenery and start
// being obstacles, so it is checked rather than assumed.
{
  const tower = buildTower()
  const growth = trunkGrowth(tower.pads)
  let worst = 99
  let tallest = 0

  for (const plant of growth) {
    tallest = Math.max(tallest, plant.y ?? 0)
    for (const pad of tower.pads) {
      // Vertical bands only: a plant 10 m below a pad cannot touch it.
      if (Math.abs((plant.y ?? 0) - pad.y) > 3) continue
      const gap =
        Math.hypot(plant.x - pad.x, plant.z - pad.z) - pad.size / 2 - plant.scale * 0.7
      worst = Math.min(worst, gap)
    }
  }

  // Five, for the same reason the floor is twelve: pads took the budget.
  note(growth.length >= 5, 'the tower itself is planted', growth.length + ' plants on the trunk')
  note(worst > 0, 'trunk growth never reaches a pad',
    'closest approach ' + worst.toFixed(2) + ' m')
  note(tallest > 40, 'the growth climbs with the player',
    'highest plant at ' + tallest.toFixed(0) + ' m')
}

// The NARROWEST gap, not the widest.
//
// Every difficulty claim in this project was made about the widest jump, and
// the widest jump is not the one you can see. Measured when somebody finally
// looked at a screenshot instead of a number: shortest hop 1.63 m between
// pads up to 3.9 m wide, 29 of 120 hops under 2.5 m, and a tower that reads
// as a heap of slabs however good the maximum is.
//
// The cause was a one-sided clamp. hop() had capped the gap at REACH_BUDGET
// since the beginning and never had a floor, so any section could multiply
// its way down - the narrow bridge asks for 0.85, the piston hall 0.8.
{
  const tower = buildTower()
  const gaps = []
  for (const pad of tower.pads) {
    // The crown is 9 m across and is meant to be easy to arrive on; detour
    // ledges hang off the route by design.
    if (pad.detour || pad.kind === 'finish') continue
    const from = tower.pads[pad.fromIndex]
    if (!from) continue
    gaps.push(Math.hypot(pad.x - from.x, pad.z - from.z) - pad.size / 2 - from.size / 2)
  }
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]

  /**
   * The RAMP, not a flat floor.
   *
   * These three used to assert one number for the whole tower, because the
   * gap floor was one number. It fixed pads sitting on top of each other and
   * cost the difficulty curve: floor 4.0 against a 4.79 ceiling put the
   * median at exactly 4.00 and made the first zone as hard as the last. On a
   * buildathon judged on phones, where a player arrives alone and unpractised,
   * a tower that opens at its own maximum is the wrong tower.
   *
   * So the floor climbs with the curve and these checks follow it: the bottom
   * has to be gentler than the top, and both ends have to stay inside the
   * physical ceiling.
   */
  const low = []
  const high = []
  for (const pad of tower.pads) {
    if (pad.detour || pad.kind === 'finish') continue
    const from = tower.pads[pad.fromIndex]
    if (!from) continue
    /**
     * Difficulty is BOTH axes, not the gap alone.
     *
     * This used to compare horizontal gaps, which was a fair proxy while the
     * two budgets were independent. They are not any more: a hop's rise now
     * buys down its reach, because a jump that is long and high at once was
     * reported as impossible on a phone. Under the old measure the tower now
     * looks like it flattens towards the top, when what actually happens is
     * that the top trades distance for height.
     *
     * Load is what a player feels: the share of the horizontal budget plus the
     * share of the vertical one.
     */
    const gap = Math.hypot(pad.x - from.x, pad.z - from.z) - pad.size / 2 - from.size / 2
    const load = gap / cfg.REACH_BUDGET + Math.max(0, pad.y - from.y) / cfg.MAX_STEP_RISE
    if (pad.y < 20) low.push(load)
    else if (pad.y > 55) high.push(load)
  }
  low.sort((a, b) => a - b)
  high.sort((a, b) => a - b)
  const lowMedian = low[Math.floor(low.length / 2)]
  const highMedian = high[Math.floor(high.length / 2)]

  note(gaps[0] >= cfg.MIN_GAP_LOW - 0.6, 'no hop is absurdly short',
    'narrowest ' + gaps[0].toFixed(2) + ' m')
  note(gaps[0] >= 2.0, 'the tower is not a pile of slabs',
    'narrowest ' + gaps[0].toFixed(2) + ' m, ' +
    gaps.filter((g) => g < 2.5).length + ' hops under 2.5 m')
  note(highMedian > lowMedian + 0.2, 'the climb gets harder as it goes up',
    'bottom median ' + lowMedian.toFixed(2) + ' m, top median ' + highMedian.toFixed(2) + ' m')
  note(median >= cfg.MIN_GAP_LOW, 'the typical hop is still a jump',
    'median ' + median.toFixed(2) + ' m against a ' + cfg.MIN_GAP_LOW + ' m opening floor')
}

// Coins may not bunch.
{
  const list = buildTower().pickups
  let closest = Infinity
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      closest = Math.min(
        closest,
        Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y, list[i].z - list[j].z)
      )
    }
  }
  note(closest >= cfg.COIN_SPACING, 'coins are spread out',
    'closest pair ' + closest.toFixed(2) + ' m of a ' + cfg.COIN_SPACING + ' m minimum')
}

// The shortcut has to exist.
//
// It did not. `shortcut` came back NULL and nothing asked - the identical
// failure the lever had, months apart, for the identical reason: a mechanic
// built by a search, with no check that the search succeeded.
//
// What killed it was two of this session's own changes, neither of which
// mentioned the shortcut. Opening the jumps out raised `jumpGap`, and the
// chord's spacing test was written as a fraction of jumpGap + padSize, so the
// bar it set rose with the tower until 91 of 95 candidates failed it. Then
// the ceiling rule - no pad may hang over another - made isClear strict
// enough that the remaining chords could not find a clear straight line.
//
// Both are the same shape of mistake: a rule expressed in terms of something
// else that later moved.
{
  const tower = buildTower()
  const cut = tower.shortcut
  note(cut !== null && cut !== undefined, 'the shortcut exists',
    cut ? cut.route.length + ' pads across the chord' : 'NOT BUILT - the labels promise it anyway')

  if (cut) {
    let worst = 0
    const chain = [tower.pads[cut.fromIndex], ...cut.route, tower.pads[cut.toIndex]]
    for (let i = 1; i < chain.length; i++) {
      const gap =
        Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z) -
        chain[i].size / 2 - chain[i - 1].size / 2
      worst = Math.max(worst, gap)
    }
    note(worst <= MAX_REACH, 'every step of the shortcut is jumpable',
      'longest ' + worst.toFixed(2) + ' m of a ' + MAX_REACH.toFixed(2) + ' m budget')
  }
}

// EVERY zone delivers its mechanic - checked as a table, not one at a time.
//
// Two mechanics have now vanished silently in this project. The lever was
// placed at one fixed offset and skipped in silence when anything was there;
// the shortcut was a search with no check that the search succeeded, and it
// died to two unrelated changes that never mentioned it. Both times the fix
// was to add a check for THAT mechanic, which is how the second one was free
// to break: nobody was watching the others.
//
// So this walks the zone order and asks, for every kind of zone in it,
// whether the thing that zone is FOR came out the other end.
{
  const tower = buildTower()
  const asked = {}
  for (const name of tower.sectionNames) asked[name] = (asked[name] || 0) + 1

  const centres = new Map()
  for (const spin of tower.spinners) {
    const key = spin.x.toFixed(2) + ',' + spin.y.toFixed(2) + ',' + spin.z.toFixed(2)
    centres.set(key, (centres.get(key) || 0) + 1)
  }
  const crosses = [...centres.values()].filter((n) => n === 2).length

  const delivered = {
    'the lever': tower.levers.length,
    'the fork': tower.forks.length,
    'spinner floor': crosses,
    'piston hall': tower.movers.length > 0 ? asked['piston hall'] || 0 : 0,
    'crumbling run': tower.pads.filter((p) => p.crumble).length > 0 ? asked['crumbling run'] || 0 : 0
  }

  const missing = []
  for (const [zone, count] of Object.entries(asked)) {
    if (!(zone in delivered)) continue
    if (delivered[zone] < count) missing.push(zone + ' ' + delivered[zone] + '/' + count)
  }

  note(missing.length === 0, 'every zone delivered its mechanic',
    missing.length ? missing.join(', ') : Object.keys(delivered).length + ' zone kinds checked')
}

// Every mechanic the zone order asks for has to actually be in the tower.
//
// It asks for two lever zones. The tower shipped with ZERO levers: the pad was
// placed at one fixed offset and skipped in silence whenever anything was
// already there, which was both times. Nothing noticed, because nothing asked
// - and the submission described the lever as one of three social mechanics.
{
  const tower = buildTower()
  const asked = tower.sectionNames.filter((name) => name === 'the lever').length
  note(tower.levers.length === asked, 'the tower has the levers it asks for',
    tower.levers.length + ' built for ' + asked + ' lever zones')

  // And each one has to be reachable from the pad it guards.
  let worstGap = 0
  for (const lever of tower.levers) {
    const near = tower.pads
      .map((pad) => ({ pad, d: Math.hypot(pad.x - lever.x, pad.z - lever.z) }))
      .filter((entry) => Math.abs(entry.pad.y - lever.y) < 1.5)
      .sort((a, b) => a.d - b.d)[1]
    if (near) worstGap = Math.max(worstGap, near.d - near.pad.size / 2 - 1.5)
  }
  note(worstGap <= MAX_REACH, 'levers are within a jump of the climb',
    'furthest ' + worstGap.toFixed(2) + ' m of a ' + MAX_REACH.toFixed(2) + ' m budget')
}

// Every landing must bank its checkpoint from anywhere you can stand on it.
//
// The radius was a flat 2.2 while landings were 3.2 m wide, and stayed 2.2
// after they were grown to 4.6 - so the corner of all six was dead: stand
// there, bank nothing, fall, lose everything back to the previous checkpoint
// with no way to know why. Exactly the finish slab's dead zone, repeated,
// because the pads were widened without asking what measured them.
{
  const tower = buildTower()
  const landings = tower.pads.filter((pad) => pad.kind === 'checkpoint')
  let worstCorner = 0
  let dead = 0

  for (const pad of landings) {
    const corner = (pad.size / 2) * Math.SQRT2
    worstCorner = Math.max(worstCorner, corner)
    if (corner > cfg.CHECKPOINT_RADIUS) dead++
  }

  note(dead === 0 && landings.length > 0, 'every landing banks from its corners',
    landings.length + ' landings, furthest corner ' + worstCorner.toFixed(2) +
    ' m of a ' + cfg.CHECKPOINT_RADIUS.toFixed(2) + ' m radius, ' + dead + ' dead')

  // And the box the client actually tests must not reach the pad next door.
  // A circle wide enough for a 4.6 m landing's corner is 3.45 m, while pads
  // are only separated by 3.4 - which would hand a checkpoint to somebody
  // standing on the neighbour. The box is the shape of the pad, so it cannot.
  // Measured to the neighbour's CENTRE, not its edge. Pads can sit edge to
  // edge, and somebody whose feet are on the shared lip is standing half on
  // each - banking there is fair. What must not happen is banking while
  // standing comfortably on the pad next door.
  let nearest = Infinity
  for (const landing of landings) {
    const half = landing.size / 2 + cfg.CHECKPOINT_TOUCH_MARGIN
    for (const other of tower.pads) {
      if (other === landing) continue
      if (Math.abs(other.y - landing.y) > 2) continue
      const reach = Math.max(
        Math.abs(other.x - landing.x),
        Math.abs(other.z - landing.z)
      )
      nearest = Math.min(nearest, reach - half)
    }
  }
  note(nearest > 0, 'banking cannot reach the pad next door',
    'nearest neighbour centre is ' + nearest.toFixed(2) + ' m outside the box')
}

// A crumbling pad has to give you as long to think as it takes to cross.
//
// It gave 0.7 s while the widest hop needs 0.38 s of airtime at the documented
// jog speed - 0.32 s to see it go, decide and aim, on a virtual stick, with
// five of them in a row at the worst point in the tower.
{
  const tower = buildTower()
  let longest = 0
  let run = 0
  for (const pad of tower.pads) {
    run = pad.crumble ? run + 1 : 0
    longest = Math.max(longest, run)
  }

  const crossing = worstReach / cfg.JOG_SPEED
  const thinking = cfg.CRUMBLE_DELAY - crossing

  note(thinking >= crossing, 'crumbling pads leave time to think',
    'holds ' + cfg.CRUMBLE_DELAY.toFixed(2) + ' s, crossing takes ' +
    crossing.toFixed(2) + ' s, leaving ' + thinking.toFixed(2) +
    ' s - longest run is ' + longest + ' pads')
}

// A colour may not mean two things.
//
// Unstable ground and a checkpoint were fourteen degrees of hue and 0.15 of
// luminance apart - one colour on a phone at twenty metres, and the whole
// readability of the tower rests on being able to tell them apart at exactly
// that distance. Two ways to be distinguishable and either will do: a
// different hue or a different brightness.
{
  const gaps = palette.colourGaps()
  const HUE = 20
  const LUM = 0.25
  // Five meanings now: safe, hurts, unstable, goal, and a checkpoint already
  // banked. Ten pairs, and every one of them has to be separable.
  const bad = gaps.filter((g) => g.hue < HUE && g.luminance < LUM)
  const worst = gaps.reduce((a, b) =>
    Math.max(a.hue / HUE, a.luminance / LUM) < Math.max(b.hue / HUE, b.luminance / LUM) ? a : b)

  note(bad.length === 0, 'no colour means two things',
    'closest pair ' + worst.a + '/' + worst.b + ': ' + worst.hue.toFixed(0) +
    ' deg of hue, ' + worst.luminance.toFixed(2) + ' of luminance')
}

// A hazard may not hit you before it touches you.
//
// The hit box was a free 0.85 against a beam whose visible half-thickness was
// 0.35: it killed half a metre off the bar, and nothing on screen explained
// the death. Fair means the hit distance is the visible half plus the width
// of the avatar, and no more.
{
  const visibleHalf = cfg.HAZARD_THICKNESS / 2
  const slack = cfg.HAZARD_HALF_WIDTH - visibleHalf
  note(slack > 0 && slack <= 0.35, 'hazards hit where they look',
    'hit box reaches ' + slack.toFixed(2) + ' m past the bar, avatar is about 0.30 m wide')
}

// The shape of the climb is pinned, and changing it has to be deliberate.
//
// It changed by accident once: the pad generator rejected candidates within
// LOBBY_SIZE/2 + 2 of the lobby, so shrinking the deck from 24 m to 20 m to
// make room for trees moved the finish from (27.6, 69.5, 50.0) to
// (38.1, 70.1, 56.1) and reshuffled every pad behind it. Every time on the
// leaderboard had been set on a tower that no longer existed, and the only
// reason anyone noticed was a drop test aimed at coordinates that had gone
// stale in the meantime.
//
// If this fails, decide on purpose: either put back whatever moved the tower,
// or accept the new one, update the hash here, and clear the boards - because
// the old times were set somewhere else.
{
  const shape = buildTower().pads
    .map((p) => [p.x, p.y, p.z, p.size, p.kind, p.section].join(':'))
    .join('|')
  let hash = 0
  for (let i = 0; i < shape.length; i++) hash = (Math.imul(31, hash) + shape.charCodeAt(i)) | 0
  const fingerprint = (hash >>> 0).toString(16)

  // Changed twice, both deliberate and both AFTER placement, so no pad has
  // ever moved and every time on the boards is still a time up this climb:
  //   1. the crown widened 3.2 -> 5.2 m, for room to stand on
  //   2. checkpoints grown into landings, by search, 3.2 -> 3.8..4.6 m
  //   3. the two lever pads, which had never been built at all - this one DID
  //      add pads, so the boards were cleared with it
  //   4. the stacking pass: a ceiling rule so no pad hangs over another, the
  //      crown widened again 5.2 -> 7.0, the spinner floor cut from a scatter
  //      of up to four beams to one crossed pair, and the first lever zone
  //      moved 6 -> 7 because zone 6 has no room for it. This MOVED pads, so
  //      the boards have to be cleared with it - old times are times up a
  //      different climb.
  //   5. the difficulty pass: jumpGap steepened 1.6-2.7 to 1.5-3.1 so the
  //      ground floor is EASIER and the summit asks for twice its gap, pads
  //      shrinking 3.9 -> 2.4, and twelve coins each on their own 2.6 m ledge
  //      instead of eight hanging in open air. Pads moved and pads were added.
  //   6. the crown widened again 7.0 -> 9.0. At 7 the arch's plinths were
  //      centred on the disc's rim, so 0.75 m of each footing hung over
  //      nothing and the gateway read as floating. Only the crown resized;
  //      no other pad moved, so times still describe the same climb.
  //   7. the gaps opened out on request: jumpGap 1.5-3.1 -> 1.9-4.05, which
  //      is 1.31x on the widest gap. A literal 1.5x was measured first and
  //      rejected - see the note on the airtime check.
  //   8. the jungle pass: gaps 1.9-4.05 -> 2.2-4.6 (82% of the airtime),
  //      coins 12 -> 16, and the fir ring cut 24 -> 10 to pay for 31 pieces
  //      of single-primitive undergrowth.
  //   9. the gap FLOOR. hop() had a ceiling and no floor, so the narrowest
  //      hop was 1.63 m between 3.9 m pads and 29 of 120 were under 2.5 -
  //      which is what a player sees, and what every number reported here
  //      had been quietly ignoring. MIN_GAP 4.0, pads narrowed to 3.3-2.3,
  //      lever pads routed through the same floor, coins spaced 11 m apart.
  //  10. the gap floor became a RAMP. A flat 4.0 against a 4.79 ceiling made
  //      the first zone as hard as the last; it is 2.9 at the foot now and
  //      4.0 at the crown, so the tower teaches before it tests.
  //  11. the CLEARANCE test stopped being radial. In the same-height band it
  //      compared centre distance against half-and-half plus a margin, which
  //      is right for two discs and wrong for two squares: a square's corner
  //      stands at 0.707 of its width from the centre, not 0.5, so objects
  //      could satisfy it and still overlap along the diagonal. The error
  //      scales with size, so it bit hardest on the widest things in the
  //      tower - the 4.4 m co-op discs - and a player photographed four of
  //      them cutting through pads. Separating axis now. Side effects, all
  //      measured: the climb stands 82.0 m instead of 74.6 m of an 85 m
  //      ceiling, because pads that used to clip corners are now genuinely
  //      apart, and the lever's own pad is COOP_PAD_SIZE so the disc drawn on
  //      it covers it exactly. Same 137 pads.
  //  12. an occupied-volume REGISTER. Eight solids in this tower are not pads
  //      - the tandem plate, the ante's three slabs, two shortcut pressure
  //      pads, two lever discs - and every clearance search tested itself
  //      against out.pads, a list none of them are in. Each was clear when it
  //      was placed and two of them still came to rest at the same height
  //      0.58 m apart, corners standing through a disc. out.extras is that
  //      list; isClear reads it. Coin perches now avoid the ante's slabs,
  //      which is what moved the fingerprint.
  //  13. a WIDER tower, and then a smaller one again. The first try doubled
  //      the zones alone and packed 221 pads into a ring 17 m across, which
  //      read as noise. The room was sideways: the scene is 80 m wide with
  //      walls at 38, and the engine caps height at log2(26)*20 = 94.
  //      Ring 6-21, zones 20 -> 26, rise 0.42-0.66 so the sections spread.
  //      Then the SCENE was measured rather than the layout: 462 materials
  //      against a mobile cap of 400, because the client bills one material
  //      per mesh and every pad is a mesh. Vegetation cut hard - undergrowth
  //      32 -> 12, fringe 18 -> 6, trunk growth 14 -> 5, palms 5 -> 2 - and
  //      the zone count trimmed until it fit. 137 -> 189 pads, 76.3 -> 82 m.
  const PINNED = 'e234b50a'
  note(fingerprint === PINNED, 'the tower is the tower the records were set on',
    'fingerprint ' + fingerprint)
}

// Determinism: every client builds the tower locally, so the same round must
// produce byte-identical geometry or players fall through each other's floors.
const once = JSON.stringify(buildTower())
const twice = JSON.stringify(buildTower())
note(once === twice, 'deterministic across builds', once.length + ' bytes')

// A count guard, because this file has twice lost checks to a careless
// region-replace edit: the value-separation rule and then the whole tree
// block, both cut out along with the code they happened to sit between, both
// unnoticed until a screenshot showed the damage. Raise this when you add one.
const MIN_CHECKS = 76
note(checks >= MIN_CHECKS, 'no invariant has gone missing',
  checks + ' checks ran, floor is ' + MIN_CHECKS)

console.log(`\n  pads ${maxPads}   height ${minH.toFixed(1)} to ${maxH.toFixed(1)} m of ${cfg.MAX_PAD_HEIGHT} m`)
console.log(`  clean climb model ${cfg.estimateClimbSeconds(buildTower().pads).toFixed(0)} s\n`)
rmSync(out, { recursive: true, force: true })

if (fail.length) { console.error('BROKEN: ' + fail.join(', ')); process.exit(1) }
console.log('All invariants hold.\n')
