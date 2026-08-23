import {
  BACKDROP_HALF,
  BANDS,
  CENTER_X,
  CENTER_Z,
  CHECKPOINT_EVERY_SECTIONS,
  curve,
  HORIZONTAL_CLEARANCE,
  VERTICAL_CLEARANCE,
  GATE_X,
  GATE_Z,
  HAZARD_CLEARANCE,
  HAZARD_THICKNESS,
  LOBBY_KEEPOUT_RADIUS,
  LOBBY_SIZE,
  LOBBY_X,
  LOBBY_Z,
  MAX_PAD_HEIGHT,
  MAX_SHORTCUT_RISE,
  estimateClimbSeconds,
  MAX_STEP_RISE,
  REACH_BUDGET,
  TOWER_SEED,
  TOWER_ZONES,
  TREE_TRUNK_RADIUS,
  TREE_COUNT,
  TREE_RING_OUTER,
  TREE_RING_RADIUS,
  TREE_SCALE,
  PAD_SEPARATION,
  PICKUP_COUNT,
  PICKUP_RADIUS,
  PICKUP_RISE,
  SHAFT_MAX_RADIUS,
  SHAFT_MIN_RADIUS,
  START_PAD_X,
  START_PAD_Z,
  SHORTCUT_FROM_SECTION,
  SHORTCUT_HOPS,
  START_X,
  START_Z
} from './config'
import { makeRng, Rng } from './rng'

export type PadKind = 'start' | 'normal' | 'checkpoint' | 'finish'

export type Pad = {
  kind: PadKind
  x: number
  y: number
  z: number
  size: number
  crumble: boolean
  /** Which section this pad belongs to. Drives its colour. */
  section: number
  /**
   * Index of the pad this one is reached from, or -1 for the start.
   *
   * Once sections branch, array order stops being traversal order, and a check
   * that walks the array measures gaps between pads on different arms - which
   * reported a 24m jump that nobody could actually be asked to make. Recording
   * the real predecessor keeps the jumpability invariant meaningful.
   */
  fromIndex: number
}

export type SpinnerDef = {
  x: number
  y: number
  z: number
  length: number
  speed: number
  phase: number
  /** Set when a lever pad can stop this beam. Matches LeverDef.section. */
  leverSection?: number
}

/** A pad that halts its section's beam while anyone stands on it. */
export type LeverDef = {
  x: number
  y: number
  z: number
  section: number
}

export type MoverDef = {
  x: number
  y: number
  z: number
  sizeX: number
  sizeY: number
  sizeZ: number
  axis: 'x' | 'y' | 'z'
  range: number
  speed: number
  phase: number
}

export type Layout = {
  pads: Pad[]
  spinners: SpinnerDef[]
  movers: MoverDef[]
  levers: LeverDef[]
  /** Names of the sections stacked this round, bottom to top. */
  sectionNames: string[]
  /** The co-op bypass, or null when this round had no room for one. */
  shortcut: Shortcut | null
  /** Every place the climb asks the player a question. */
  forks: ForkDef[]
  /** The tandem plate, or null if the tower had no room for one. */
  plate: PlateDef | null
  /** The ante: a wager the climb offers, or null if it did not fit. */
  coin: CoinDef | null
  /** Optional pickups. Nobody has to take one; the climb ignores them. */
  pickups: Pickup[]
}

/**
 * THE ANTE - a coin that buys a section, and a fall if you miss.
 *
 * Three crumbling pads lead off the fast line to a gold coin. Taking it grants
 * one skip token. Missing drops you to the last checkpoint, which is the price.
 * The wager has to be legible before it is taken, so both halves are drawn:
 * the decay is visible on the pads, the reward is lit gold at the end of them.
 */
/**
 * A collectible hanging off the route.
 *
 * Deliberately not on the way to anything. A pickup that happens to be on the
 * fast line is not a decision, it is scenery you walk through; this one costs
 * you a jump out and a jump back, and the clock keeps running while you do it.
 * Nothing in the climb requires one.
 */
export type Pickup = {
  x: number
  y: number
  z: number
  /** Index of the pad you can reach it from, for the reach invariant. */
  fromPad: number
}

export type CoinDef = {
  /** The detour, in order. Every one of these crumbles. */
  route: Pad[]
  /** Where the coin hangs. */
  x: number
  y: number
  z: number
  /** Checkpoint index the token skips the player to. */
  skipsToCheckpoint: number
}

/**
 * A platform that only rises under two people.
 *
 * The lever is a favour one player can do for strangers; the bypass needs two
 * pads held at once. This is the third and bluntest: the plate simply does not
 * move for one person. It is the only place in the climb where a player cannot
 * substitute skill for company, which is why it sits where a solo climber is
 * starting to tire rather than at the bottom where they are still fresh.
 */
export type PlateDef = {
  x: number
  y: number
  z: number
  size: number
  /** How far it lifts when two people are aboard. */
  rise: number
  /** The landing it reaches, which skips what would otherwise be climbed. */
  toX: number
  toY: number
  toZ: number
}

/**
 * A fork: two ways up from one pad, rejoining at one landing.
 *
 * The generator records it so the builder can price it. A fork the player
 * cannot read the cost of is not a decision, it is a coin toss - which is the
 * whole difference the design pass draws between a choice and a jump.
 */
export type ForkDef = {
  /** Pad the choice is made on. */
  junction: number
  /** First pad of each arm, where its sign stands. */
  boldFirst: number
  safeFirst: number
  boldPads: number
  safePads: number
  /** Seconds the bold arm saves against the safe one, from the climb model. */
  savesSeconds: number
}

/**
 * Two pressure pads and the route they open. Both pads must be stood on at the
 * same time by two different people, so one player cannot hold both - they are
 * placed PAD_SEPARATION apart for exactly that reason.
 */
export type Shortcut = {
  padA: { x: number; y: number; z: number }
  padB: { x: number; y: number; z: number }
  /** Pads that only exist while the shortcut is open. */
  route: Pad[]
  /** Index into pads of the landing it starts from and the one it reaches. */
  fromIndex: number
  toIndex: number
}

/**
 * The kinds of section the tower can be built from. Tower of Hell stacks a
 * fresh pick of named sections every round; this is the same idea at a much
 * smaller scale, so no two rounds are the same climb.
 */
const SECTION_KINDS = [
  'gap jumps',
  'ring of platforms',
  'spinner floor',
  'narrow bridge',
  'crumbling run',
  'piston hall',
  'zigzag steps',
  // These three ask a question instead of setting a jump.
  'the fork',
  'the plunge',
  'the lever'
] as const

type SectionKind = (typeof SECTION_KINDS)[number]

type Cursor = { x: number; y: number; z: number; angle: number }

type Build = {
  forks: ForkDef[]
  pads: Pad[]
  spinners: SpinnerDef[]
  movers: MoverDef[]
  levers: LeverDef[]
}

/**
 * The tower. One of them, permanent, identical for everybody.
 *
 * Every zone is generated at its own point on the difficulty curve, so the
 * climb opens wide and gentle at the gate and narrows toward the crown. The
 * seed never changes: a client that built a different tower would drop its
 * player through somebody else's floor.
 */
export function buildTower(): Layout {
  const rng = makeRng(TOWER_SEED)
  // Zone one's shape, used for anything that needs the course's opening feel
  // (the practice hops in the yard) before the loop begins.
  const c = curve(0)

  const out: Build = { pads: [], spinners: [], movers: [], levers: [], forks: [] }
  const sectionNames: string[] = []

  // Pad zero never moves: the lobby, the gate and the spawn are built around it.
  out.pads.push({
    kind: 'start',
    x: START_PAD_X,
    y: 0.4,
    z: START_PAD_Z,
    size: Math.max(c.padSize, 3.4),
    crumble: false,
    section: 0,
    fromIndex: -1
  })

  const cursor: Cursor = {
    x: START_PAD_X,
    y: 0.4,
    z: START_PAD_Z,
    angle: Math.atan2(START_Z - CENTER_Z, START_X - CENTER_X)
  }

  for (let index = 1; index <= TOWER_ZONES; index++) {
    // Progress up the tower, not through a round. This is the whole point of
    // the change: altitude decides how hard a zone is.
    const zone = curve((index - 1) / (TOWER_ZONES - 1))
    const kind = pickKind(index)
    sectionNames.push(kind)
    buildSection(kind, index, cursor, zone, rng, out)
  }

  // The last pad of the last section is the goal.
  const last = out.pads[out.pads.length - 1]
  last.kind = 'finish'
  last.crumble = false
  last.size = Math.max(last.size, 3.2)

  relaxSightLines(out)

  const shortcut = buildShortcut(out, curve(0.35))

  return {
    pads: out.pads,
    spinners: out.spinners,
    movers: out.movers,
    levers: out.levers,
    sectionNames,
    shortcut,
    forks: out.forks,
    plate: buildPlate(out),
    coin: buildCoin(out),
    pickups: buildPickups(out)
  }
}

/**
 * Hangs the ante off an early-middle landing.
 *
 * Early enough that the token is worth something - a skip near the crown buys
 * almost nothing - and late enough that a player has learned to jump before
 * they are offered a bet on it.
 */
/**
 * Hangs a pickup off to the side of pads spread up the whole climb.
 *
 * Searched, not assumed. Fixing an offset and an angle put pickups inside
 * other pads: the 6-17 m band already holds 119 of them, and "outward from
 * this pad" points straight at a neighbour more often than not.
 */
function buildPickups(out: Build): Pickup[] {
  const pickups: Pickup[] = []
  if (out.pads.length < 10) return pickups

  const wanted = PICKUP_COUNT
  const stride = Math.floor(out.pads.length / (wanted + 1))

  for (let n = 1; n <= wanted; n++) {
    const index = Math.min(out.pads.length - 1, n * stride)
    const anchor = out.pads[index]
    if (!anchor || anchor.kind === 'finish' || anchor.kind === 'start') continue

    const outward = Math.atan2(anchor.z - CENTER_Z, anchor.x - CENTER_X)
    let placed = false

    for (let turn = 0; turn <= 6 && !placed; turn++) {
      for (const sign of [1, -1]) {
        const away = outward + sign * turn * 0.5
        // Far enough that taking one is a jump out and a jump back. At 3.4 m
        // from the pad centre the gap from its edge was 1.2 m of a 3.03 m
        // budget - close enough to collect without leaving the route, which
        // makes it scenery rather than a choice.
        for (const distance of [5.6, 6.4, 4.9]) {
          const x = anchor.x + Math.cos(away) * distance
          const z = anchor.z + Math.sin(away) * distance
          const y = anchor.y + PICKUP_RISE

          if (!inDetourAir(x, z)) continue
          // A pickup is a trigger, not a floor, but it must not hang inside a
          // pad or it cannot be seen or reached.
          if (!isClear(out, x, y, z, PICKUP_RADIUS * 2, anchor)) continue

          pickups.push({ x, y, z, fromPad: index })
          placed = true
          break
        }
        if (placed || turn === 0) break
      }
    }
  }

  return pickups
}

function buildCoin(out: Build): CoinDef | null {
  const landings = out.pads
    .map((pad, index) => ({ pad, index }))
    .filter((entry) => entry.pad.kind === 'checkpoint')
  if (landings.length < 3) return null

  // Search, do not assume. Fixing the detour to one angle off one landing
  // produced no coin at all - the same mistake the shortcut made before it,
  // where a single hard-coded target could not satisfy the clearances.
  for (let choice = 0; choice < landings.length - 1; choice++) {
    const at = landings[Math.min(landings.length - 2, Math.floor(landings.length * 0.3) + choice)]
    const base = at.pad
    const outward = Math.atan2(base.z - CENTER_Z, base.x - CENTER_X)

    for (let turn = -3; turn <= 3; turn++) {
      const away = outward + turn * 0.42
      const route: Pad[] = []
      let x = base.x
      let z = base.z
      let y = base.y
      let ok = true

      for (let i = 0; i < 3 && ok; i++) {
        const step = 2.2 + base.size * 0.5
        x += Math.cos(away) * step
        z += Math.sin(away) * step
        y += 0.45
        // The ante is explicitly off the fast line, so it is allowed OUT of
        // the climbing shaft rather than squeezed into it. Measured: 28 of 35
        // candidate detours failed on clearance because the 6-17 m band
        // already holds 120 pads. Out here there is room, and being visibly
        // away from the route is what makes it read as a detour.
        const near = i === 0 ? base : route[i - 1]
        if (!inDetourAir(x, z) || !isClear(out, x, y, z, 2.1, near)) { ok = false; break }
        route.push({
          kind: 'normal',
          x,
          y,
          z,
          size: 2.1,
          crumble: true,
          section: base.section,
          fromIndex: -1
        })
      }
      if (!ok || route.length < 3) continue

      const last = route[route.length - 1]
      return {
        route,
        x: last.x,
        y: last.y + 1.6,
        z: last.z,
        skipsToCheckpoint: Math.min(landings.length - 1, landings.indexOf(at) + 2)
      }
    }
  }

  return null
}

/**
 * Nudges any pad that stands in the line between a jump and its target.
 *
 * "From any pad the next target must be visible" is a design-brief rule, and
 * widening the slabs for mobile broke it in one place: a pad grew into the
 * sightline of a jump two hops away. Rather than accept it or narrow the pads
 * again, the offender steps sideways until the ray is clear.
 *
 * Every candidate position is re-checked against clearance and the shaft, so
 * a nudge can never trade a blocked view for an overlap. If nothing works the
 * pad stays where it is and the harness reports it - a silent failure here
 * would be a jump the player cannot plan, which is worse than a loud one.
 */
function relaxSightLines(out: Build) {
  const EYE = 1.6
  const STEP = 0.25
  const SLAB = 1

  const blocks = (from: Pad, to: Pad, other: Pad): boolean => {
    const ax = from.x, ay = from.y + EYE, az = from.z
    const span = Math.hypot(to.x - ax, to.y + 0.4 - ay, to.z - az)
    const steps = Math.max(2, Math.ceil(span / STEP))
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      const px = ax + (to.x - ax) * t
      const py = ay + (to.y + 0.4 - ay) * t
      const pz = az + (to.z - az) * t
      const half = other.size / 2
      if (
        Math.abs(px - other.x) < half &&
        Math.abs(pz - other.z) < half &&
        py > other.y - SLAB / 2 &&
        py < other.y + SLAB / 2
      ) return true
    }
    return false
  }

  for (let pass = 0; pass < 8; pass++) {
    let moved = false

    for (const pad of out.pads) {
      if (pad.fromIndex < 0) continue
      const from = out.pads[pad.fromIndex]
      if (!from) continue

      for (const other of out.pads) {
        if (other === pad || other === from) continue
        if (other.kind !== 'normal') continue
        if (!blocks(from, pad, other)) continue

        // Step it away from the shaft's centre, which is the direction with
        // the most free air.
        const away = Math.atan2(other.z - CENTER_Z, other.x - CENTER_X)
        for (const distance of [0.6, 1.2, 1.8, 2.4]) {
          const nx = other.x + Math.cos(away) * distance
          const nz = other.z + Math.sin(away) * distance
          if (!inShaft(nx, nz, other.y)) continue
          if (!isClear(out, nx, other.y, nz, other.size, other)) continue

          const previous = out.pads[other.fromIndex]
          if (previous) {
            const gap =
              Math.hypot(nx - previous.x, nz - previous.z) - (other.size + previous.size) / 2
            if (gap > REACH_BUDGET) continue
          }

          other.x = nx
          other.z = nz
          moved = true
          break
        }
        break
      }
    }

    if (!moved) return
  }
}

/**
 * Places the tandem plate beside a landing about two thirds up.
 *
 * It sits off the main route, so a solo climber is never blocked by it - the
 * tower stays completable alone, which the brief requires because a judge
 * arrives by themselves. What they lose is the shortcut, not the climb.
 */
function buildPlate(out: Build): PlateDef | null {
  const landings = out.pads
    .map((pad, index) => ({ pad, index }))
    .filter((entry) => entry.pad.kind === 'checkpoint')
  if (landings.length < 2) return null

  // Search, like the ante does. Fixing this to one landing and one angle meant
  // that widening the pads for mobile - which the climb needed - silently
  // deleted the plate: no clearance at the one spot it was allowed to try.
  // The harness caught it, which is the only reason it is not gone now.
  const size = 3.6
  for (let offset = 0; offset < landings.length - 1; offset++) {
    const startIndex = Math.min(
      landings.length - 2,
      Math.max(0, Math.floor(landings.length * 0.6) + offset - 1)
    )
    const start = landings[startIndex]
    const target = landings[startIndex + 1]
    if (!start || !target || target.pad.y <= start.pad.y) continue

    const outward = Math.atan2(start.pad.z - CENTER_Z, start.pad.x - CENTER_X)
    for (let turn = -3; turn <= 3; turn++) {
      for (const reach of [size + 1.4, size + 2.8, size + 4.2]) {
        const away = outward + turn * 0.4
        const x = start.pad.x + Math.cos(away) * reach
        const z = start.pad.z + Math.sin(away) * reach
        if (!inDetourAir(x, z)) continue
        if (!isClear(out, x, start.pad.y, z, size, start.pad)) continue

        return {
          x,
          y: start.pad.y + 0.4,
          z,
          size,
          rise: Math.max(2.5, target.pad.y - start.pad.y),
          toX: target.pad.x,
          toY: target.pad.y,
          toZ: target.pad.z
        }
      }
    }
  }

  return null
}

/**
 * Builds the co-op bypass: a short chain of pads from one landing straight to
 * a later one, skipping what is between them.
 *
 * Returns null rather than forcing it if the route would sit on top of the
 * climb it is meant to bypass - a shortcut that overlaps the main path is
 * worse than no shortcut.
 */
function buildShortcut(out: Build, c: ReturnType<typeof curve>): Shortcut | null {
  const landings: number[] = []
  for (let i = 0; i < out.pads.length; i++) {
    if (out.pads[i].kind === 'checkpoint' || out.pads[i].kind === 'start') landings.push(i)
  }
  if (landings.length < 2) return null

  const fromIndex = landings[Math.min(SHORTCUT_FROM_SECTION - 1, landings.length - 2)]
  const from = out.pads[fromIndex]
  const step = c.jumpGap + c.padSize

  /**
   * Search for a target rather than assuming one.
   *
   * Two constraints pull against each other: the bypass has to climb whatever
   * height it skips, at no more than MAX_SHORTCUT_RISE per hop, and its pads
   * have to sit at least a jump apart or they overlap. Fixing the target to the
   * next landing made both unsatisfiable at once - the climb needed ten hops
   * and the chord only had room for four. So walk the candidates and take the
   * first pair where the geometry actually works.
   */
  for (let toIndex = fromIndex + SHORTCUT_HOPS + 2; toIndex < out.pads.length - 1; toIndex++) {
    const to = out.pads[toIndex]
    const span = Math.hypot(to.x - from.x, to.z - from.z)
    const climb = to.y - from.y
    if (climb <= 0) continue

    // Enough hops to keep every rise jumpable...
    const hops = Math.max(SHORTCUT_HOPS, Math.ceil(climb / MAX_SHORTCUT_RISE))
    // ...but only if that many still fit along the chord without overlapping.
    if (span / (hops + 1) < step * 0.8) continue

    const route = chordRoute(out, from, to, hops, c.padSize)
    if (!route) continue

    const across = Math.atan2(from.z - CENTER_Z, from.x - CENTER_X) + Math.PI / 2
    const half = PAD_SEPARATION / 2

    return {
      padA: { x: from.x + Math.cos(across) * half, y: from.y + 0.3, z: from.z + Math.sin(across) * half },
      padB: { x: from.x - Math.cos(across) * half, y: from.y + 0.3, z: from.z - Math.sin(across) * half },
      route,
      fromIndex,
      toIndex
    }
  }

  return null
}

/** Evenly spaced pads from one landing to another, or null if any is blocked. */
function chordRoute(out: Build, from: Pad, to: Pad, hops: number, size: number): Pad[] | null {
  const route: Pad[] = []

  for (let i = 1; i <= hops; i++) {
    const t = i / (hops + 1)
    const x = from.x + (to.x - from.x) * t
    const z = from.z + (to.z - from.z) * t
    const y = from.y + (to.y - from.y) * t

    if (!isClear(out, x, y, z, size)) return null
    route.push({
      kind: 'normal',
      x,
      y,
      z,
      size,
      crumble: false,
      section: from.section,
      fromIndex: -1
    })
  }

  return route
}

/**
 * The running order of the tower, authored rather than rolled.
 *
 * Zones used to be sampled at random with a no-immediate-repeat rule. On the
 * seed this tower is built from that produced a climb with FOUR plunges, three
 * crumbling runs - and not a single fork. The one section that asks the player
 * a question never appeared, so the tower had no decision in it anywhere.
 *
 * A random sequence was the right call when the course regenerated every few
 * minutes. There is one tower now and it is permanent, so it gets designed:
 * teach at the bottom, put the first decision early enough to matter, alternate
 * the co-op sections so a player alone is never far from a reason to want
 * somebody else, and never repeat a kind twice running.
 */
const ZONE_ORDER: SectionKind[] = [
  'gap jumps',        //  1  teach the jump, nothing else
  'zigzag steps',     //  2  teach turning while jumping
  'ring of platforms',//  3  first hazard, on a wide floor
  'the fork',         //  4  first decision, early
  'narrow bridge',    //  5
  'the lever',        //  6  first co-op: hold it for strangers
  'crumbling run',    //  7  commit, do not stop
  'spinner floor',    //  8
  'the plunge',       //  9  risk against certainty
  'piston hall',      // 10
  'the fork',         // 11
  'ring of platforms',// 12
  'the lever',        // 13
  'narrow bridge',    // 14
  'crumbling run',    // 15
  'the plunge',       // 16
  'zigzag steps',     // 17
  'the fork',         // 18  last decision before the summit run
  'spinner floor',    // 19
  'gap jumps'         // 20  the ladder: pure nerve, no tricks
]

function pickKind(index: number): SectionKind {
  return ZONE_ORDER[(index - 1) % ZONE_ORDER.length]
}

function buildSection(
  kind: SectionKind,
  index: number,
  cursor: Cursor,
  c: ReturnType<typeof curve>,
  rng: Rng,
  out: Build
) {
  switch (kind) {
    case 'ring of platforms':
      return ringOfPlatforms(index, cursor, c, rng, out)
    case 'spinner floor':
      return spinnerFloor(index, cursor, c, rng, out)
    case 'narrow bridge':
      return narrowBridge(index, cursor, c, rng, out)
    case 'crumbling run':
      return crumblingRun(index, cursor, c, rng, out)
    case 'piston hall':
      return pistonHall(index, cursor, c, rng, out)
    case 'zigzag steps':
      return zigzagSteps(index, cursor, c, rng, out)
    case 'the fork':
      return theFork(index, cursor, c, rng, out)
    case 'the plunge':
      return thePlunge(index, cursor, c, rng, out)
    case 'the lever':
      return theLever(index, cursor, c, rng, out)
    default:
      return gapJumps(index, cursor, c, rng, out)
  }
}

/* ------------------------------------------------------------------ */
/* Section shapes                                                      */
/* ------------------------------------------------------------------ */

/** Plain hops around the shaft, the bread and butter of any tower. */
function gapJumps(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  for (let i = 0; i < c.sectionLength; i++) {
    hop(out, cursor, index, c, { size: c.padSize, rise: c.rise, turn: rng.range(-0.3, 0.3) })
  }
  closeSection(index, cursor, c, rng, out)
}

/**
 * A flat arc of platforms with a beam sweeping over the middle. Flat on
 * purpose: when this rose as it curved, pads ended up stacked over each other
 * and the player was trapped underneath with nowhere to jump.
 */
function ringOfPlatforms(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const count = 6 + Math.round(c.t * 3)
  const size = c.padSize * 0.9
  const first = out.pads.length

  hop(out, cursor, index, c, { size, rise: c.rise })
  for (let i = 1; i < count; i++) {
    hop(out, cursor, index, c, { size, rise: 0, turn: (Math.PI * 2) / count })
  }

  const ring = out.pads.slice(first)
  const hubX = ring.reduce((sum, pad) => sum + pad.x, 0) / ring.length
  const hubZ = ring.reduce((sum, pad) => sum + pad.z, 0) / ring.length
  const reach = Math.max(...ring.map((pad) => Math.hypot(pad.x - hubX, pad.z - hubZ)))

  out.spinners.push({
    x: hubX,
    y: ring[0].y + HAZARD_CLEARANCE,
    z: hubZ,
    length: reach * 2 + c.spinnerReach,
    speed: (rng.next() < 0.5 ? -1 : 1) * c.spinnerSpeed,
    phase: rng.range(0, 360)
  })

  closeSection(index, cursor, c, rng, out)
}

/** One wide floor with several beams turning above it. */
function spinnerFloor(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const size = 7 + c.t * 3
  hop(out, cursor, index, c, { size, rise: c.rise })

  const beams = 2 + Math.round(c.t * 2)
  for (let i = 0; i < beams; i++) {
    out.spinners.push({
      x: cursor.x + rng.range(-size * 0.18, size * 0.18),
      y: cursor.y + HAZARD_CLEARANCE,
      z: cursor.z + rng.range(-size * 0.18, size * 0.18),
      length: size * rng.range(0.55, 0.95),
      speed: (rng.next() < 0.5 ? -1 : 1) * c.spinnerSpeed * rng.range(0.7, 1.3),
      phase: rng.range(0, 360)
    })
  }

  closeSection(index, cursor, c, rng, out)
}

/** A run of small planks with a bar sweeping across the end of it. */
function narrowBridge(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const planks = 3 + Math.round(c.t * 2)
  const width = Math.max(1.8, c.padSize * 0.66)

  for (let i = 0; i < planks; i++) {
    hop(out, cursor, index, c, { size: width, rise: c.rise * 0.6, gapScale: 0.85 })
  }

  out.movers.push({
    x: cursor.x,
    y: cursor.y + HAZARD_CLEARANCE,
    z: cursor.z,
    sizeX: HAZARD_THICKNESS,
    sizeY: HAZARD_THICKNESS,
    sizeZ: c.padSize + c.moverReach,
    axis: 'x',
    range: c.padSize + 1.2,
    speed: c.moverSpeed,
    phase: rng.range(0, Math.PI * 2)
  })

  closeSection(index, cursor, c, rng, out)
}

/** Pads that drop away shortly after you land on them. Keep moving. */
function crumblingRun(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const count = 3 + Math.round(c.t * 3)
  for (let i = 0; i < count; i++) {
    hop(out, cursor, index, c, {
      size: c.padSize,
      rise: c.rise * 0.7,
      turn: rng.range(-0.2, 0.2),
      crumble: true,
      gapScale: 0.9
    })
  }
  closeSection(index, cursor, c, rng, out)
}

/** Pads with blocks punching up and down through them. */
function pistonHall(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const count = 3 + Math.round(c.t * 2)

  for (let i = 0; i < count; i++) {
    hop(out, cursor, index, c, { size: c.padSize, rise: c.rise * 0.8 })

    // Every other pad is a breather. A piston on each one left nowhere to
    // stand and wait, which is what made this section impossible rather than
    // hard.
    if (i % 2 === 1) continue

    // The piston covers part of the pad, never all of it: at pad width it
    // swept the whole standing area and no timing could beat it.
    const offset = c.padSize * 0.3
    const side = rng.next() < 0.5 ? 1 : -1

    out.movers.push({
      x: cursor.x + Math.cos(cursor.angle) * offset * side,
      y: cursor.y + 1.5,
      z: cursor.z + Math.sin(cursor.angle) * offset * side,
      sizeX: c.padSize * 0.5,
      sizeY: HAZARD_THICKNESS,
      sizeZ: c.padSize * 0.5,
      axis: 'y',
      range: 1.4,
      speed: c.moverSpeed * rng.range(0.8, 1.2),
      phase: rng.range(0, Math.PI * 2)
    })
  }
  closeSection(index, cursor, c, rng, out)
}

/** Small pads thrown left and right of the climb line. */
function zigzagSteps(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const count = 4 + Math.round(c.t * 3)
  for (let i = 0; i < count; i++) {
    hop(out, cursor, index, c, {
      size: c.padSize * 0.8,
      rise: c.rise,
      turn: (i % 2 === 0 ? 1 : -1) * 0.6
    })
  }
  closeSection(index, cursor, c, rng, out)
}

/**
 * THE FORK - two ways up, and you must pick before you can see how it ends.
 *
 * The short arm is two long jumps; the long arm is four short ones and takes
 * noticeably more time. Both rejoin at the same landing, so choosing wrong
 * costs seconds rather than the run. Every gap on both arms is inside
 * jumpGap, which is already bounded well under runJumpHeight 1.5m of reach.
 */
function theFork(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  const junction = out.pads[out.pads.length - 1]
  const boldFirst = out.pads.length

  // Bold arm: fewer, longer hops.
  hop(out, cursor, index, c, { size: c.padSize * 0.85, rise: c.rise, gapScale: 1.35, from: junction })
  hop(out, cursor, index, c, { size: c.padSize * 0.85, rise: c.rise, gapScale: 1.35 })
  const boldTip = out.pads[out.pads.length - 1]

  // Safe arm: starts back at the junction, more hops, shorter and wider.
  const safeFirst = out.pads.length
  const safe: Cursor = { x: junction.x, y: junction.y, z: junction.z, angle: cursor.angle + 1.1 }
  for (let i = 0; i < 4; i++) {
    // Half the rise over twice the hops: the two arms end level, so the shared
    // landing is one jump from either. Taking the max of two different heights
    // instead put the landing 3m above the lower arm.
    hop(out, safe, index, c, {
      size: c.padSize,
      rise: c.rise * 0.5,
      turn: rng.range(-0.2, 0.2),
      gapScale: 0.8,
      from: i === 0 ? junction : undefined
    })
  }

  // Price the two arms with the same model config uses for the whole climb,
  // so the signs carry a real number rather than a guess.
  const boldPads = out.pads.slice(boldFirst, boldFirst + 2)
  const safePads = out.pads.slice(safeFirst, safeFirst + 4)
  out.forks.push({
    junction: out.pads.indexOf(junction),
    boldFirst,
    safeFirst,
    boldPads: boldPads.length,
    safePads: safePads.length,
    savesSeconds: Math.max(
      0,
      estimateClimbSeconds([junction, ...safePads]) - estimateClimbSeconds([junction, ...boldPads])
    )
  })

  cursor.x = boldTip.x
  cursor.y = boldTip.y
  cursor.z = boldTip.z
  cursor.angle = Math.atan2(cursor.z - CENTER_Z, cursor.x - CENTER_X)
  closeSection(index, cursor, c, rng, out, boldTip)
}

/**
 * THE PLUNGE - the fast way is downwards.
 *
 * A high ledge sits above a landing that is closer to the exit. Dropping is
 * quicker than walking the rim around, but a drop that misses is a fall, and a
 * fall costs the freeze plus the climb back. The rim exists so the section is
 * never a coin flip: it is slower, not safer to ignore.
 */
function thePlunge(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  // Climb to the ledge.
  for (let i = 0; i < 3; i++) {
    hop(out, cursor, index, c, { size: c.padSize, rise: c.rise * 1.1 })
  }
  const ledge = out.pads[out.pads.length - 1]

  // The rim: the long way round, level and safe.
  const rim: Cursor = { x: ledge.x, y: ledge.y, z: ledge.z, angle: cursor.angle }
  for (let i = 0; i < 4; i++) {
    hop(out, rim, index, c, {
      size: c.padSize * 0.9,
      rise: 0,
      turn: 0.55,
      gapScale: 0.85,
      from: i === 0 ? ledge : undefined
    })
  }

  // The catch pad, below the ledge and already past the rim's arc.
  const drop = Math.max(2.5, c.rise * 3)
  const size = Math.max(c.padSize, 3)
  const target: Cursor = { x: rim.x, y: Math.max(0.4, ledge.y - drop), z: rim.z, angle: rim.angle }

  if (isClear(out, target.x, target.y, target.z, size)) {
    push(out, target, index, size, false, out.pads.length - 1)
    cursor.x = target.x
    cursor.y = target.y
    cursor.z = target.z
    cursor.angle = target.angle
  } else {
    // Something already occupies the landing zone. Walk on from the rim rather
    // than dropping a pad on top of the climb.
    cursor.x = rim.x
    cursor.y = rim.y
    cursor.z = rim.z
    cursor.angle = rim.angle
  }
  closeSection(index, cursor, c, rng, out)
}

/**
 * THE LEVER - one player can make it easier for everyone.
 *
 * A beam sweeps the only pad. A lever pad sits off to the side, and while
 * anybody stands on it the beam stops. Alone you time the beam; together, one
 * person holds the lever and the rest walk through. Nothing is gated on a
 * second player - the beam is always beatable solo.
 */
function theLever(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  hop(out, cursor, index, c, { size: Math.max(c.padSize, 3.4), rise: c.rise })
  const guarded = out.pads[out.pads.length - 1]

  out.spinners.push({
    x: guarded.x,
    y: guarded.y + HAZARD_CLEARANCE,
    z: guarded.z,
    length: guarded.size + c.spinnerReach,
    speed: (rng.next() < 0.5 ? -1 : 1) * c.spinnerSpeed,
    phase: rng.range(0, 360),
    leverSection: index
  })

  // The lever sits on its own pad, off the climbing line.
  const side = cursor.angle + Math.PI / 2
  const leverCursor: Cursor = {
    x: guarded.x + Math.cos(side) * (c.jumpGap + c.padSize),
    y: guarded.y,
    z: guarded.z + Math.sin(side) * (c.jumpGap + c.padSize),
    angle: cursor.angle
  }
  if (!isClear(out, leverCursor.x, leverCursor.y, leverCursor.z, c.padSize)) {
    closeSection(index, cursor, c, rng, out, guarded)
    return
  }
  push(out, leverCursor, index, c.padSize, false, out.pads.length - 1)
  out.levers.push({ x: leverCursor.x, y: leverCursor.y + 0.3, z: leverCursor.z, section: index })

  // From the guarded pad, not the lever off to its side: the cursor stands on
  // the former while the latter is simply the last thing pushed, and measuring
  // one against the other recorded an 8.6m jump.
  closeSection(index, cursor, c, rng, out, guarded)
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Every section ends on a generous landing. Only every third landing is a
 * checkpoint: one per section meant a save every few jumps, which removed any
 * reason to be careful.
 */
function closeSection(
  index: number,
  cursor: Cursor,
  c: ReturnType<typeof curve>,
  rng: Rng,
  out: Build,
  /**
   * Which pad the landing is jumped from. Branching sections must say: after a
   * fork the cursor sits on one arm's tip while the last pad in the array is
   * the other arm's, and measuring one against the other produced recorded
   * jumps of 17 metres.
   */
  from?: Pad
) {
  hop(out, cursor, index, c, {
    size: Math.max(c.padSize, 3.2),
    rise: c.rise,
    turn: rng.range(-0.3, 0.3),
    from
  })

  if (index % CHECKPOINT_EVERY_SECTIONS === 0) {
    out.pads[out.pads.length - 1].kind = 'checkpoint'
  }
}

/**
 * Places the next pad exactly `jumpGap` metres of clear air from the edge of
 * the one before it, and refuses any position that would sit under or over an
 * existing pad. Both rules were missing before: the gap was measured centre to
 * centre, which made 3m pads look like they were touching, and nothing stopped
 * a section from building a ceiling over its own path.
 */
function hop(
  out: Build,
  cursor: Cursor,
  section: number,
  c: ReturnType<typeof curve>,
  opts: {
    size: number
    rise: number
    turn?: number
    crumble?: boolean
    gapScale?: number
    /**
     * Measure the jump from this pad instead of the last one placed. Branches
     * need it: the second arm of a fork starts at the fork itself, not at the
     * tip of the arm built before it.
     */
    from?: Pad
  }
) {
  const size = opts.size
  const previous = opts.from ?? out.pads[out.pads.length - 1]
  // Hard ceiling, applied here so no section can opt out of it. The fork's
  // bold arm asked for gapScale 1.35, which at the top of the curve is
  // 3.6 * 1.35 = 4.86 m - the single reason any jump in the game broke the
  // 70% budget. Capping at the source keeps the arm longer than its safe
  // twin (2.88 m) without making it unfair on a thumbstick.
  const gap = Math.min(c.jumpGap * (opts.gapScale ?? 1), REACH_BUDGET)
  // Edge to edge is the jump; centre to centre has to include both half-pads.
  const distance = gap + previous.size / 2 + size / 2

  // Measure from the pad this jump is recorded as starting from. Every caller
  // currently parks the cursor there first, so this changes no geometry - it
  // just stops the two from being able to drift apart.
  const fromX = previous.x
  const fromZ = previous.z
  cursor.angle += opts.turn ?? 0

  const ceiling = Math.min(MAX_PAD_HEIGHT, cursor.y + MAX_STEP_RISE)
  let y = Math.min(ceiling, cursor.y + opts.rise)

  for (let lift = 0; lift < 5; lift++) {
    const heading = cursor.angle + Math.PI / 2
    let stepX = Math.cos(heading) * distance
    let stepZ = Math.sin(heading) * distance

    for (let attempt = 0; attempt < 16; attempt++) {
      const x = fromX + stepX
      const z = fromZ + stepZ
      if (inShaft(x, z, y) && isClear(out, x, y, z, size)) {
        cursor.x = x
        cursor.z = z
        cursor.y = y
        cursor.angle = Math.atan2(z - CENTER_Z, x - CENTER_X)
        push(out, cursor, section, size, opts.crumble ?? false, out.pads.indexOf(previous))
        return
      }
      const turnBy = Math.PI / 8
      const rx = stepX * Math.cos(turnBy) - stepZ * Math.sin(turnBy)
      const rz = stepX * Math.sin(turnBy) + stepZ * Math.cos(turnBy)
      stepX = rx
      stepZ = rz
    }
    // Nowhere on this level is free: climb a little and sweep again.
    //
    // The step used to be VERTICAL_CLEARANCE * 0.6, which is 1.9m, and two of
    // them stacked into rises over 3m - past doubleJumpHeight 2, so the pad was
    // placed where nobody could reach it. Kept inside a jump, with more
    // attempts to make up for the smaller step.
    // Never past what a jump reaches, however many sweeps it takes.
    if (y >= ceiling) break
    y = Math.min(ceiling, y + MAX_SHORTCUT_RISE * 0.5)
  }

  // Widen the search before giving up: the same jump, more headings, and the
  // air just outside the shaft. The shaft band is only 11 m deep and the pads
  // got wider for mobile, so "nowhere on this level" happens far more often
  // than it used to.
  for (const distance of [gap + previous.size / 2 + size / 2, (gap + previous.size / 2 + size / 2) * 0.8]) {
    for (let step = 0; step < 32; step++) {
      const heading = cursor.angle + Math.PI / 2 + (step * Math.PI) / 16
      const x = fromX + Math.cos(heading) * distance
      const z = fromZ + Math.sin(heading) * distance
      if (!inDetourAir(x, z)) continue
      if (!isClear(out, x, y, z, size, previous)) continue

      cursor.x = x
      cursor.z = z
      cursor.y = y
      cursor.angle = Math.atan2(z - CENTER_Z, x - CENTER_X)
      push(out, cursor, section, size, opts.crumble ?? false, out.pads.indexOf(previous))
      return
    }
  }

  // Last resort. This used to place the pad with no clearance check at all,
  // which is how a slab ended up 1.10 m directly above another one - a landing
  // an avatar cannot stand on, found by the sight-line test rather than by
  // anything looking for it. It still has to go somewhere, but it goes to the
  // least-bad spot rather than straight up into whatever is there.
  let bestX = fromX
  let bestZ = fromZ
  let bestClearance = -Infinity
  for (let step = 0; step < 32; step++) {
    const heading = cursor.angle + Math.PI / 2 + (step * Math.PI) / 16
    const x = fromX + Math.cos(heading) * distance
    const z = fromZ + Math.sin(heading) * distance
    let nearest = Infinity
    for (const pad of out.pads) {
      if (pad === previous) continue
      if (Math.abs(pad.y - y) > VERTICAL_CLEARANCE) continue
      nearest = Math.min(nearest, Math.hypot(pad.x - x, pad.z - z) - (pad.size + size) / 2)
    }
    if (nearest > bestClearance) {
      bestClearance = nearest
      bestX = x
      bestZ = z
    }
  }
  cursor.x = bestX
  cursor.z = bestZ
  cursor.y = y
  push(out, cursor, section, size, opts.crumble ?? false, out.pads.indexOf(previous))
}

/**
 * Open air beyond the climbing shaft, still comfortably on the plate.
 * Used only by the ante, which is meant to hang away from the route.
 */
function inDetourAir(x: number, z: number): boolean {
  // Radius alone is enough, and deliberately so. This used to also test
  // MIN_XZ/MAX_XZ and threw "MIN_XZ is not defined" at runtime while
  // type-checking clean: esbuild assigns those inside config's lazy __esm
  // initializer, and this runs before it. The radius bound already keeps the
  // detour inside the plate - SHAFT_MAX_RADIUS + 7 is 24 m from centre on an
  // 80 m square - so the second test was redundant as well as fragile.
  const radius = Math.hypot(x - CENTER_X, z - CENTER_Z)
  return radius >= SHAFT_MIN_RADIUS && radius <= SHAFT_MAX_RADIUS + 7
}

/** Inside the shaft band, and never above the lobby or the gate. */
function inShaft(x: number, z: number, y: number): boolean {
  const radius = Math.hypot(x - CENTER_X, z - CENTER_Z)
  if (radius < SHAFT_MIN_RADIUS || radius > SHAFT_MAX_RADIUS) return false

  if (y < 6) return true
  if (Math.hypot(x - LOBBY_X, z - LOBBY_Z) < LOBBY_KEEPOUT_RADIUS) return false
  return Math.hypot(x - GATE_X, z - GATE_Z) >= 5
}

/**
 * True when no existing pad sits close above or below this spot.
 *
 * `except` is the pad being jumped FROM. It has to be excluded or the first
 * step of any detour fails against its own parent: measured, all 35 candidate
 * ante detours were rejected 0.05 m short, by the very landing they hang off.
 * A normal hop never hits this because it measures edge to edge.
 */
function isClear(out: Build, x: number, y: number, z: number, size: number, except?: Pad): boolean {
  for (const pad of out.pads) {
    if (pad === except) continue
    if (Math.abs(pad.y - y) > VERTICAL_CLEARANCE) continue
    const needed = pad.size / 2 + size / 2 + HORIZONTAL_CLEARANCE
    if (Math.hypot(pad.x - x, pad.z - z) < needed) return false
  }
  return true
}

function push(
  out: Build,
  cursor: Cursor,
  section: number,
  size: number,
  crumble: boolean,
  fromIndex = out.pads.length - 1
) {
  out.pads.push({
    kind: 'normal',
    x: cursor.x,
    y: cursor.y,
    z: cursor.z,
    size,
    crumble,
    section,
    fromIndex
  })
}

export type BandPanel = {
  x: number
  z: number
  y: number
  /** Yaw in degrees. Local +Z must lie on the tangent, never on the radius. */
  yaw: number
  height: number
  length: number
  thickness: number
  backdrop: string
}

/** Four walls per band: one per side of the field. */
export const BACKDROP_PANELS = 4

/** Corner overlap, so the four walls close into a box with no gap. */
const CORNER_OVERLAP = 1.2

/**
 * The boundary wall, as pure numbers.
 *
 * A square, following the field, not a circle inscribed in it. The ring it
 * replaced left four unexplained wedges of ground in the corners and never
 * agreed with the parcel edge the player can actually see.
 *
 * It also costs half as much: four walls per band instead of eight panels, so
 * sixteen material slots come back for the climb to spend.
 *
 * Kept here rather than in build.ts for the reason the ring was: this geometry
 * shipped rotated ninety degrees once and nothing but a screenshot noticed.
 */
export function backdropRing(): BandPanel[] {
  const panels: BandPanel[] = []
  const length = BACKDROP_HALF * 2 + CORNER_OVERLAP

  // Long axis along X for the two walls that face up and down the Z axis, and
  // along Z for the other two. A yaw of 90 puts local +Z on world +X.
  const sides = [
    { dx: 0, dz: 1, yaw: 90 },
    { dx: 0, dz: -1, yaw: 90 },
    { dx: 1, dz: 0, yaw: 0 },
    { dx: -1, dz: 0, yaw: 0 }
  ]

  for (const band of BANDS) {
    const height = band.high - band.low
    for (const side of sides) {
      panels.push({
        x: CENTER_X + side.dx * BACKDROP_HALF,
        z: CENTER_Z + side.dz * BACKDROP_HALF,
        y: band.low + height / 2,
        yaw: side.yaw,
        height,
        length,
        thickness: 0.4,
        backdrop: band.backdrop
      })
    }
  }
  return panels
}


export type TreeDef = { x: number; z: number; yaw: number; scale: number }

/**
 * The forest edge, as pure numbers.
 *
 * Two things it must never do, both of which it did before this was written
 * down: stand inside the lobby (the ring was set to radius 27 and the lobby
 * deck is a 24 m square centred at radius 22, so trees grew through the
 * leaderboard and the camera sat inside a canopy), and reach far enough in to
 * touch a pad.
 *
 * Deterministic by construction - angle, wobble and scale are functions of
 * the index, never of Math.random - because every client grows its own copy
 * of this forest and they have to match.
 */
export function treeLine(): TreeDef[] {
  const trees: TreeDef[] = []
  const halfLobby = LOBBY_SIZE / 2 + TREE_TRUNK_RADIUS

  for (let i = 0; i < TREE_COUNT; i++) {
    const angle = (i / TREE_COUNT) * Math.PI * 2
    const radius = TREE_RING_RADIUS + Math.sin(i * 2.399) * 2.2
    const x = CENTER_X + Math.cos(angle) * radius
    const z = CENTER_Z + Math.sin(angle) * radius

    // The lobby deck is an axis-aligned square, so this is a box test, not a
    // radius test. A radius test would leave trees standing on the corners.
    const clearsLobby = (px: number, pz: number) =>
      Math.abs(px - LOBBY_X) >= halfLobby || Math.abs(pz - LOBBY_Z) >= halfLobby

    // Dropping a tree that lands on the deck left a bald third of the ring
    // exactly behind the board - the one direction a player faces while
    // reading it, and the only place in the clearing with no forest in it.
    // Push it outward instead, to the last radius that still clears the wall.
    let px = x
    let pz = z
    if (!clearsLobby(px, pz)) {
      const out = TREE_RING_OUTER
      px = CENTER_X + Math.cos(angle) * out
      pz = CENTER_Z + Math.sin(angle) * out
      if (!clearsLobby(px, pz)) continue
    }

    trees.push({
      x: px,
      z: pz,
      yaw: (i * 47) % 360,
      scale: TREE_SCALE * (1 + Math.sin(i * 1.107) * 0.22)
    })
  }
  return trees
}


/**
 * The altitude of every checkpoint pad, in climb order.
 *
 * Exists so decoration cannot drift away from the thing it describes. The
 * trunk's collars were first placed at height * zone / TOWER_ZONES - an even
 * share of the tallest pad - while checkpoints land wherever the difficulty
 * curve puts them. The collars said "a checkpoint is here" several metres from
 * where one was.
 */
export function checkpointAltitudes(layout: Layout): number[] {
  return layout.pads.filter((pad) => pad.kind === 'checkpoint').map((pad) => pad.y)
}
