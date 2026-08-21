import {
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
  PAD_SEPARATION,
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

  const shortcut = buildShortcut(out, curve(0.35))

  return {
    pads: out.pads,
    spinners: out.spinners,
    movers: out.movers,
    levers: out.levers,
    sectionNames,
    shortcut,
    forks: out.forks
  }
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
  const width = Math.max(1.1, c.padSize * 0.55)

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

  // Last resort: straight up, still a legal jump.
  cursor.y = y
  push(out, cursor, section, size, opts.crumble ?? false, out.pads.indexOf(previous))
}

/** Inside the shaft band, and never above the lobby or the gate. */
function inShaft(x: number, z: number, y: number): boolean {
  const radius = Math.hypot(x - CENTER_X, z - CENTER_Z)
  if (radius < SHAFT_MIN_RADIUS || radius > SHAFT_MAX_RADIUS) return false

  if (y < 6) return true
  if (Math.hypot(x - LOBBY_X, z - LOBBY_Z) < LOBBY_SIZE / 2 + 2) return false
  return Math.hypot(x - GATE_X, z - GATE_Z) >= 5
}

/** True when no existing pad sits close above or below this spot. */
function isClear(out: Build, x: number, y: number, z: number, size: number): boolean {
  for (const pad of out.pads) {
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
