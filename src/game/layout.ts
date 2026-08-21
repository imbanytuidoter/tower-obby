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
}

export type SpinnerDef = {
  x: number
  y: number
  z: number
  length: number
  speed: number
  phase: number
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
  round: number
  pads: Pad[]
  spinners: SpinnerDef[]
  movers: MoverDef[]
  /** Names of the sections stacked this round, bottom to top. */
  sectionNames: string[]
  /** The co-op bypass, or null when this round had no room for one. */
  shortcut: Shortcut | null
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
  'zigzag steps'
] as const

type SectionKind = (typeof SECTION_KINDS)[number]

type Cursor = { x: number; y: number; z: number; angle: number }

type Build = {
  pads: Pad[]
  spinners: SpinnerDef[]
  movers: MoverDef[]
}

export function buildLayout(round: number): Layout {
  const rng = makeRng(round * 7919)
  const c = curve(round)

  const out: Build = { pads: [], spinners: [], movers: [] }
  const sectionNames: string[] = []

  // Pad zero never moves: the lobby, the gate and the spawn are built around it.
  out.pads.push({
    kind: 'start',
    x: START_PAD_X,
    y: 0.4,
    z: START_PAD_Z,
    size: Math.max(c.padSize, 3.4),
    crumble: false,
    section: 0
  })

  const cursor: Cursor = {
    x: START_PAD_X,
    y: 0.4,
    z: START_PAD_Z,
    angle: Math.atan2(START_Z - CENTER_Z, START_X - CENTER_X)
  }

  let previous: SectionKind | null = null
  for (let index = 1; index <= c.sections; index++) {
    const kind = pickKind(index, previous, rng)
    previous = kind
    sectionNames.push(kind)
    buildSection(kind, index, cursor, c, rng, out)
  }

  // The last pad of the last section is the goal.
  const last = out.pads[out.pads.length - 1]
  last.kind = 'finish'
  last.crumble = false
  last.size = Math.max(last.size, 3.2)

  const shortcut = buildShortcut(out, c)

  return {
    round,
    pads: out.pads,
    spinners: out.spinners,
    movers: out.movers,
    sectionNames,
    shortcut
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
    route.push({ kind: 'normal', x, y, z, size, crumble: false, section: from.section })
  }

  return route
}

/**
 * Round one opens gently; after that anything goes, minus a repeat of the
 * section just built. The previous kind is threaded through rather than kept
 * in module state: a round has to generate identically no matter what was
 * generated before it, or leaderboard times stop being comparable.
 */
function pickKind(index: number, previous: SectionKind | null, rng: Rng): SectionKind {
  if (index === 1) return 'gap jumps'

  for (let attempt = 0; attempt < 8; attempt++) {
    const kind = SECTION_KINDS[rng.int(0, SECTION_KINDS.length - 1)]
    if (kind !== previous) return kind
  }
  return SECTION_KINDS[0]
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

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Every section ends on a generous landing. Only every third landing is a
 * checkpoint: one per section meant a save every few jumps, which removed any
 * reason to be careful.
 */
function closeSection(index: number, cursor: Cursor, c: ReturnType<typeof curve>, rng: Rng, out: Build) {
  hop(out, cursor, index, c, {
    size: Math.max(c.padSize, 3.2),
    rise: c.rise,
    turn: rng.range(-0.3, 0.3)
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
  opts: { size: number; rise: number; turn?: number; crumble?: boolean; gapScale?: number }
) {
  const size = opts.size
  const previous = out.pads[out.pads.length - 1]
  const gap = c.jumpGap * (opts.gapScale ?? 1)
  // Edge to edge is the jump; centre to centre has to include both half-pads.
  const distance = gap + previous.size / 2 + size / 2

  const fromX = cursor.x
  const fromZ = cursor.z
  cursor.angle += opts.turn ?? 0

  let y = Math.min(MAX_PAD_HEIGHT, cursor.y + opts.rise)

  for (let lift = 0; lift < 3; lift++) {
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
        push(out, cursor, section, size, opts.crumble ?? false)
        return
      }
      const turnBy = Math.PI / 8
      const rx = stepX * Math.cos(turnBy) - stepZ * Math.sin(turnBy)
      const rz = stepX * Math.sin(turnBy) + stepZ * Math.cos(turnBy)
      stepX = rx
      stepZ = rz
    }
    // Nowhere on this level is free: climb a little and sweep again.
    y = Math.min(MAX_PAD_HEIGHT, y + VERTICAL_CLEARANCE * 0.6)
  }

  // Last resort: straight up, still a legal jump.
  cursor.y = y
  push(out, cursor, section, size, opts.crumble ?? false)
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

function push(out: Build, cursor: Cursor, section: number, size: number, crumble: boolean) {
  out.pads.push({
    kind: 'normal',
    x: cursor.x,
    y: cursor.y,
    z: cursor.z,
    size,
    crumble,
    section
  })
}
