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
  SHAFT_MAX_RADIUS,
  SHAFT_MIN_RADIUS,
  START_PAD_X,
  START_PAD_Z,
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

  return { round, pads: out.pads, spinners: out.spinners, movers: out.movers, sectionNames }
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

    out.movers.push({
      x: cursor.x,
      y: cursor.y + 1.5,
      z: cursor.z,
      sizeX: c.padSize * 0.9,
      sizeY: HAZARD_THICKNESS,
      sizeZ: c.padSize * 0.9,
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
