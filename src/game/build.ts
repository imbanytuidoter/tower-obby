import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  Material,
  MeshCollider,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ColliderLayer, TriggerArea, triggerAreaEventsSystem } from '@dcl/sdk/ecs'
import {
  CENTER_X,
  CENTER_Z,
  TOWER_ZONES,
  FINISH_RADIUS,
  FINISH_TOUCH_MARGIN,
  HAZARD_THICKNESS,
  PAD_RADIUS
} from './config'
import { Layout, MoverDef, Pad, SpinnerDef } from './layout'

export type BuiltPad = {
  entity: Entity
  /** Thin emissive slab under the pad. Reads as an edge light. */
  pad: Pad
  /** Crumbling floors count down once stepped on, then come back. */
  state: 'solid' | 'falling' | 'gone'
  timer: number
}

export type BuiltSpinner = { entity: Entity; def: SpinnerDef; angle: number }
export type BuiltLever = { pad: Entity; section: number }
export type BuiltMover = { entity: Entity; def: MoverDef; clock: number }

export type Checkpoint = {
  top: Vector3
  ring: Entity | null
  column: Entity | null
  label: Entity | null
  number: number
  /** Index of this checkpoint's pad in the course, for aiming the camera. */
  padIndex: number
}

/**
 * A fork as the client needs it: the two arms as pad indices, and what the
 * bold one is worth. A run is a series of these answers, and naming them back
 * at the finish is the difference between "you took 3:12" and "you took 3:12
 * BECAUSE you played it safe twice".
 */
export type BuiltFork = {
  zone: number
  bold: number[]
  safe: number[]
  saves: number
}

export type BuiltCoin = {
  entity: Entity
  at: Vector3
  skipsToCheckpoint: number
  taken: boolean
}

export type BuiltPlate = {
  entity: Entity
  /** Resting position and travel, so the client can place it from `lift`. */
  baseY: number
  rise: number
  /** Footprint, for deciding whether the local player is aboard. */
  x: number
  z: number
  size: number
  /** Where a full lift delivers whoever is standing on it. */
  landing: Vector3
}

export type BuiltShortcut = {
  /** Route pads, solid only while the bypass is open. */
  route: Entity[]
  /** The two pressure pads and their lights. */
  padA: Entity
  padB: Entity
  open: boolean
}

export type World = {
  /** Section names bottom to top, so the HUD can name the current one. */
  sectionNames: string[]
  pads: BuiltPad[]
  spinners: BuiltSpinner[]
  movers: BuiltMover[]
  checkpoints: Checkpoint[]
  finish: Vector3
  /** Touch radius for this round's finish slab, derived from its real size. */
  finishReach: number
  levers: BuiltLever[]
  shortcut: BuiltShortcut | null
  /** Which pads belong to which arm, so a run can tell what it chose. */
  forks: BuiltFork[]
  /** The tandem plate, or null when the tower had no room for one. */
  plate: BuiltPlate | null
  /** The ante, or null when it did not fit. */
  coin: BuiltCoin | null
  entities: Entity[]
}

/**
 * Fixed gameplay colours. These never change between rounds: cyan always means
 * safe, red always means it will hurt, gold always means the goal. Only the
 * neutral pad body and its accent follow the round theme.
 */
/**
 * CHOICE - the fifth meaning, and the only one that is never a fill.
 *
 * It is a line and a glyph drawn ON TOP of a pad that already carries one of
 * the four fills, so it can mark "the level is asking you something here"
 * without overwriting whether the pad is safe, unstable or a goal. Using it as
 * a face colour would break the one-colour-one-meaning rule the whole
 * vocabulary rests on.
 */
/** The one fill that means "you can stand here". Shared with the plaza. */
export const SAFE_FILL = Color4.fromHexString('#4EE3F2FF')

export const CHOICE_EDGE = Color4.fromHexString('#CFC6FFFF')
export const CHOICE_EDGE_3 = Color3.create(0.81, 0.78, 1)

/**
 * Surfaces, generated rather than downloaded.
 *
 * Textures measured at 1 of the 47 the scene is allowed, which is the honest
 * reason the tower read as a greybox: every face in the game was one flat
 * colour. These three are drawn procedurally into images/textures - a poured
 * slab for the ground, vertical panelling for the core, a brushed finish for
 * the platforms - so nothing is licensed from anywhere and they cost three
 * texture slots between them however many meshes use them.
 *
 * albedoColor multiplies the texture, so the colour vocabulary survives: a
 * safe pad is still cyan, it now has a surface as well.
 */
const GROUND_TEXTURE = 'images/textures/ground.png'
const CORE_TEXTURE = 'images/textures/core.png'
const SLAB_TEXTURE = 'images/textures/slab.png'

const HAZARD_ALBEDO = Color4.fromHexString('#FF3B4DFF')
const HAZARD_EMISSIVE = Color3.create(1, 0.12, 0.16)
const CRUMBLE_ALBEDO = Color4.fromHexString('#FF9D2EFF')
const CRUMBLE_EMISSIVE = Color3.create(1, 0.4, 0.08)
const FINISH_ALBEDO = Color4.fromHexString('#FFD23FFF')
const FINISH_EMISSIVE = Color3.create(1, 0.7, 0.1)
const CP_ALBEDO = Color4.fromHexString('#FFD23FFF')
const CP_EMISSIVE = Color3.create(1, 0.72, 0.15)
const CP_DONE_ALBEDO = Color4.create(0.35, 1, 0.55, 1)
const CP_DONE_EMISSIVE = Color3.create(0.25, 1, 0.45)
const START_ALBEDO = Color4.fromHexString('#4EE3F2FF')
const START_EMISSIVE = Color3.create(0.18, 0.85, 0.42)

/**
 * A palette of matte body colours, one per section. Tower of Hell gives every
 * section its own colour so a climb reads as a stack of distinct places; the
 * same trick works here, and it costs nothing.
 */
/**
 * SAFE is a fill, and a plain pad is safe.
 *
 * These slabs used to carry a grey-blue ramp that meant altitude and nothing
 * else, which is why the tower read as rubble: the largest surface in the game
 * said nothing about the game. The design pass is explicit - cyan means solid
 * ground you can stand on forever, drawn as a full-face fill. That is what the
 * player is looking at nine tenths of the time, so that is what it says.
 *
 * Altitude survives as a hue shift WITHIN the safe family, which keeps the
 * Tower of Hell section-colour convention without letting a zone's identity
 * overwrite what the pad means. Nothing here can be mistaken for red, orange
 * or gold.
 */
const SAFE_HUE = 185
const SAFE_HUE_SWING = 26
const ZONE_STEPS = 10

/** 0 at the gate, 1 at the crown, quantised to bound the material count. */
function zoneRamp(section: number): number {
  const t = Math.min(1, Math.max(0, (section - 1) / (TOWER_ZONES - 1)))
  return Math.round(t * (ZONE_STEPS - 1)) / (ZONE_STEPS - 1)
}

/** Minimal HSL, only ever called at build time. */
function hsl(h: number, sat: number, light: number): Color3 {
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = light - c / 2
  const seg = Math.floor(h / 60) % 6
  const rgb =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  return Color3.create(rgb[0] + m, rgb[1] + m, rgb[2] + m)
}

function sectionBody(section: number): Color4 {
  const t = zoneRamp(section)
  // Azure at the base through green-cyan at the crown. Still unmistakably
  // "safe" at both ends.
  const c = hsl(SAFE_HUE + SAFE_HUE_SWING - t * (SAFE_HUE_SWING * 2), 0.8, 0.5 - t * 0.05)
  return Color4.create(c.r, c.g, c.b, 1)
}

/** The edge light. Brighter than the face so the lip of a slab reads first. */
export function sectionAccent(section: number): Color3 {
  const t = zoneRamp(section)
  return hsl(SAFE_HUE + SAFE_HUE_SWING - t * (SAFE_HUE_SWING * 2), 0.9, 0.74)
}

/** Landmarks are round, plain pads are square: readable at a glance. */
const isLandmark = (pad: Pad) => pad.kind === 'checkpoint' || pad.kind === 'finish'

/** Half the pad thickness: the height of a pad's walking surface. */
export const PAD_TOP = 0.25

/**
 * Height fade is quantised into a few steps on purpose. A smooth fade gives
 * every pad its own albedo, and every distinct albedo is a material: on a tall
 * round that alone blew past the log2(n+1)*20 material budget. Four steps look
 * the same in motion and cost four materials per section instead of seventy.
 */
const HAZE_STEPS = 4
const SHADOW_STEPS = 3
const FADE_TOP = 36

function quantise(y: number, steps: number): number {
  const raw = Math.min(1, Math.max(0, y / FADE_TOP))
  return Math.round(raw * (steps - 1)) / (steps - 1)
}

export function buildWorld(layout: Layout): World {
  const entities: Entity[] = []
  const pads: BuiltPad[] = []
  const checkpoints: Checkpoint[] = []
  let finish = Vector3.create(8, 1, 8)
  let finishReach = FINISH_RADIUS
  let tallest = 0

  for (let padIndex = 0; padIndex < layout.pads.length; padIndex++) {
    const pad = layout.pads[padIndex]
    tallest = Math.max(tallest, pad.y)

    const entity = engine.addEntity()
    entities.push(entity)

    Transform.create(entity, {
      position: Vector3.create(pad.x, pad.y, pad.z),
      scale: Vector3.create(pad.size, 1, pad.size)
    })
    if (isLandmark(pad)) {
      // Round to look at, square to stand on.
      //
      // Decentraland's own docs list "Colliders Shape Consistency Review vs
      // Unity" as an open gap between the desktop and mobile clients, and
      // these are the checkpoints and the crown - the pads it matters most to
      // land on. A box is the shape with no ambiguity between the two.
      //
      // The trade is a corner of each landmark that is solid without looking
      // it. That is the right way round: on a parkour tower, falling through
      // something that looks solid is a far worse failure than an invisible
      // ledge, and both clients agree about a box.
      MeshRenderer.setCylinder(entity)
      MeshCollider.setBox(entity)
    } else {
      MeshRenderer.setBox(entity)
      MeshCollider.setBox(entity)
    }
    paintPad(entity, pad)

    // One mesh per pad, plus its ground shadow. The glow slab and the plinth
    // used to be separate entities under every slab - 240 more meshes, and
    // the mobile client counts ONE MATERIAL PER MESH against a hard limit of
    // 500 that blocks the scene from loading. At 120 pads that decoration
    // alone was most of the budget.
    //
    // Neither is missed. The glow predates the pad carrying its own emissive
    // edge, which it now does. The plinth gave the slab mass, and a thicker
    // slab gives the same read: the top face is lit by the sky and the sides
    // are not, so a single box is still two-tone in practice.
    entities.push(createGroundShadow(pad))

    const top = Vector3.create(pad.x, pad.y + PAD_TOP, pad.z)

    if (pad.kind === 'start') {
      checkpoints.push({ top, ring: null, column: null, label: null, number: 0, padIndex })
    }

    if (pad.kind === 'checkpoint') {
      const marker = createCheckpointMarker(pad, checkpoints.length)
      entities.push(marker.ring, marker.column, marker.label)

      checkpoints.push({
        top,
        ring: marker.ring,
        column: marker.column,
        label: marker.label,
        number: checkpoints.length,
        padIndex
      })
    }

    if (pad.kind === 'finish') {
      finish = top
      // Half-diagonal: the furthest point a player can legitimately stand on
      // the slab. Clamped so the client stays inside the server's tolerance.
      const corner = (pad.size / 2) * Math.SQRT2
      finishReach = Math.min(corner + FINISH_TOUCH_MARGIN, FINISH_RADIUS)
      // fromIndex, not padIndex - 1: once a section branches, array order
      // stops being traversal order, and the gate's yaw comes straight from
      // the approach direction. Three rounds had it squared to a pad the
      // route never touches - 28 m away in round 6.
      const previous = layout.pads[pad.fromIndex] ?? layout.pads[padIndex - 1] ?? pad
      entities.push(...createGoal(pad, previous.x, previous.z))
    }

    pads.push({ entity, pad, state: 'solid', timer: 0 })
  }

  entities.push(...createSpine(tallest, sectionAccent(0)))

  const spinners = layout.spinners.map((def) => {
    const entity = engine.addEntity()
    entities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(def.x, def.y, def.z),
      scale: Vector3.create(def.length, HAZARD_THICKNESS, HAZARD_THICKNESS),
      rotation: Quaternion.fromEulerDegrees(0, def.phase, 0)
    })
    MeshRenderer.setBox(entity)
    paintHazard(entity)
    return { entity, def, angle: def.phase }
  })

  const movers = layout.movers.map((def) => {
    const entity = engine.addEntity()
    entities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(def.x, def.y, def.z),
      scale: Vector3.create(def.sizeX, def.sizeY, def.sizeZ)
    })
    MeshRenderer.setBox(entity)
    paintHazard(entity)
    return { entity, def, clock: def.phase }
  })

  const levers = layout.levers.map((lever) => {
    const pad = createPressurePad(lever, entities)
    labelPad(lever, 'STAND HERE - STOPS THE BEAM', entities)
    return { pad, section: lever.section }
  })

  const shortcut = buildShortcut(layout, entities)
  const forks = buildForks(layout, entities)
  const plate = buildPlate(layout, entities)
  const coin = buildCoin(layout, entities)

  return {
    sectionNames: layout.sectionNames,
    pads,
    spinners,
    movers,
    checkpoints,
    finish,
    finishReach,
    levers,
    shortcut,
    forks,
    plate,
    coin,
    entities
  }
}

/** Cyan means safe, so a route you can rely on only turns cyan once it is real. */
const SHORTCUT_CLOSED = Color4.create(0.3, 0.34, 0.42, 0.25)

/**
 * The co-op bypass: two pressure pads and the route they open.
 *
 * The route exists from the start but is ghosted and has no collider until the
 * server says both pads are held. Building it up front keeps the reveal
 * instant - spawning a dozen entities at the moment two people cooperate would
 * land after the moment had passed.
 */
/**
 * Marks every fork and prices both of its arms.
 *
 * A fork whose cost the player cannot read is a coin toss, not a decision. The
 * junction gets the CHOICE edge - a line, never a fill, so the pad still says
 * whether it is safe - and each arm gets a two-line sign carrying the number
 * of pads and what the arm is worth in seconds. Those seconds come from the
 * same climb model the round length uses, so the sign cannot drift from the
 * geometry.
 */
/**
 * The tandem plate: a slab that only goes up under two people.
 *
 * It is drawn as safe ground with a choice edge, because standing on it is
 * safe and what it is asking you is whether you can find somebody. The sign
 * says the rule in one line - there is no other way to learn it, and a rules
 * panel is a player already leaving.
 */
/**
 * THE ANTE - three crumbling pads out into open air, and a coin at the end.
 *
 * The wager has to be readable before it is taken, so both halves are drawn:
 * the pads are orange because orange means it stops holding, and the coin is
 * gold because gold means go here. Nothing explains the trade; the two colours
 * already do, and the fall is the price.
 */
function buildCoin(layout: Layout, entities: Entity[]): BuiltCoin | null {
  const def = layout.coin
  if (!def) return null

  for (const pad of def.route) {
    const slab = engine.addEntity()
    entities.push(slab)
    Transform.create(slab, {
      position: Vector3.create(pad.x, pad.y, pad.z),
      scale: Vector3.create(pad.size, 0.5, pad.size)
    })
    MeshRenderer.setBox(slab)
    MeshCollider.setBox(slab)
    Material.setPbrMaterial(slab, {
      albedoColor: CRUMBLE_ALBEDO,
      emissiveColor: CRUMBLE_EMISSIVE,
      emissiveIntensity: 1.2,
      roughness: 0.7
    })
    entities.push(createGroundShadow(pad))
  }

  const entity = engine.addEntity()
  entities.push(entity)
  Transform.create(entity, {
    position: Vector3.create(def.x, def.y, def.z),
    scale: Vector3.create(1.1, 1.1, 1.1)
  })
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: 4
  })

  const anchor = def.route[def.route.length - 1]
  entities.push(...routeSign(anchor, 'THE ANTE', 'TAKE THE COIN, SKIP A SECTION', FINISH_EMISSIVE))

  return {
    entity,
    at: Vector3.create(def.x, def.y, def.z),
    skipsToCheckpoint: def.skipsToCheckpoint,
    taken: false
  }
}

function buildPlate(layout: Layout, entities: Entity[]): BuiltPlate | null {
  const def = layout.plate
  if (!def) return null

  const entity = engine.addEntity()
  entities.push(entity)
  Transform.create(entity, {
    position: Vector3.create(def.x, def.y, def.z),
    scale: Vector3.create(def.size, 0.6, def.size)
  })
  MeshRenderer.setCylinder(entity, 0.5, 0.5)
  // Box, for the same reason the landmarks are: this one carries two people
  // twelve metres and neither of them should fall through it on a phone.
  MeshCollider.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: SAFE_FILL,
    emissiveColor: CHOICE_EDGE_3,
    emissiveIntensity: 1.2,
    roughness: 0.6
  })

  // The line it is trying to reach, drawn in gold at the top of its travel so
  // the point of standing on it is visible from the ground.
  const mark = engine.addEntity()
  entities.push(mark)
  Transform.create(mark, {
    position: Vector3.create(def.x, def.y + def.rise + 0.9, def.z),
    scale: Vector3.create(def.size * 1.25, 0.12, def.size * 1.25)
  })
  MeshRenderer.setCylinder(mark, 0.5, 0.5)
  Material.setPbrMaterial(mark, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: 2
  })

  entities.push(...routeSign(
    { ...def, kind: 'normal', crumble: false, section: 0, fromIndex: -1 } as Pad,
    'TANDEM PLATE',
    'IT ONLY RISES WITH TWO',
    CHOICE_EDGE_3
  ))

  return {
    entity,
    baseY: def.y,
    rise: def.rise,
    x: def.x,
    z: def.z,
    size: def.size,
    landing: Vector3.create(def.toX, def.toY + 1.2, def.toZ)
  }
}

function buildForks(layout: Layout, entities: Entity[]): BuiltFork[] {
  const built: BuiltFork[] = []

  for (const fork of layout.forks) {
    const junction = layout.pads[fork.junction]
    const bold = layout.pads[fork.boldFirst]
    const safe = layout.pads[fork.safeFirst]
    if (!junction || !bold || !safe) continue

    entities.push(createChoiceEdge(junction))
    entities.push(
      ...routeSign(bold, 'BOLD', fork.boldPads + ' pads   -' + fork.savesSeconds.toFixed(1) + 's', CRUMBLE_EMISSIVE),
      ...routeSign(safe, 'SAFE', fork.safePads + ' pads   no drop', CP_EMISSIVE)
    )

    const range = (start: number, count: number) =>
      Array.from({ length: count }, (unused, i) => start + i)
    built.push({
      zone: junction.section,
      bold: range(fork.boldFirst, fork.boldPads),
      safe: range(fork.safeFirst, fork.safePads),
      saves: fork.savesSeconds
    })
  }

  return built
}

/** A ring of choice colour around a pad's lip. Line only - never a fill. */
function createChoiceEdge(pad: Pad): Entity {
  const edge = engine.addEntity()
  Transform.create(edge, {
    position: Vector3.create(pad.x, pad.y + 0.3, pad.z),
    scale: Vector3.create(pad.size * 1.16, 0.09, pad.size * 1.16)
  })
  MeshRenderer.setCylinder(edge, 0.5, 0.5)
  Material.setPbrMaterial(edge, {
    albedoColor: CHOICE_EDGE,
    emissiveColor: CHOICE_EDGE_3,
    emissiveIntensity: 2
  })
  return edge
}

/** Two lines over an arm: what it is, and what it costs. */
function routeSign(pad: Pad, title: string, cost: string, tone: Color3): Entity[] {
  const made: Entity[] = []

  const head = engine.addEntity()
  Transform.create(head, { position: Vector3.create(pad.x, pad.y + 3.4, pad.z) })
  TextShape.create(head, {
    text: title,
    fontSize: 2.6,
    textColor: Color4.create(tone.r, tone.g, tone.b, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(head, { billboardMode: BillboardMode.BM_Y })
  made.push(head)

  const line = engine.addEntity()
  Transform.create(line, { position: Vector3.create(pad.x, pad.y + 2.5, pad.z) })
  TextShape.create(line, {
    text: cost,
    fontSize: 1.7,
    textColor: CHOICE_EDGE,
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(line, { billboardMode: BillboardMode.BM_Y })
  made.push(line)

  return made
}

function buildShortcut(layout: Layout, entities: Entity[]): BuiltShortcut | null {
  if (!layout.shortcut) return null

  const route = layout.shortcut.route.map((pad) => {
    const entity = engine.addEntity()
    entities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(pad.x, pad.y, pad.z),
      scale: Vector3.create(pad.size, 0.5, pad.size)
    })
    MeshRenderer.setBox(entity)
    Material.setPbrMaterial(entity, { albedoColor: SHORTCUT_CLOSED })
    return entity
  })

  const padA = createPressurePad(layout.shortcut.padA, entities)
  const padB = createPressurePad(layout.shortcut.padB, entities)
  labelPad(layout.shortcut.padA, 'BOTH PADS - OPENS A SHORTCUT', entities)
  labelPad(layout.shortcut.padB, 'BOTH PADS - OPENS A SHORTCUT', entities)

  return { route, padA, padB, open: false }
}

/**
 * A word floating over a pad, billboarded so it reads from anywhere.
 *
 * This is the only place the co-op mechanics are explained. A phone screen has
 * no room for a rules panel, and a player who has to read one has already left
 * - so the pad says what it wants in one word, in the world, where they are
 * standing on it.
 */
function labelPad(at: { x: number; y: number; z: number }, text: string, entities: Entity[]) {
  const sign = engine.addEntity()
  entities.push(sign)

  Transform.create(sign, { position: Vector3.create(at.x, at.y + 2.2, at.z) })
  TextShape.create(sign, {
    text,
    fontSize: 2.6,
    textColor: CP_ALBEDO,
    outlineColor: Color4.Black(),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
}

function createPressurePad(at: { x: number; y: number; z: number }, entities: Entity[]): Entity {
  const pad = engine.addEntity()
  entities.push(pad)

  Transform.create(pad, {
    position: Vector3.create(at.x, at.y, at.z),
    scale: Vector3.create(PAD_RADIUS * 2, 0.2, PAD_RADIUS * 2)
  })
  MeshRenderer.setCylinder(pad)
  MeshCollider.setBox(pad)
  paintPressurePad(pad, false)

  // CL_PLAYER, not CL_MAIN_PLAYER: the point is seeing that somebody ELSE is
  // standing on the other pad. This is local colour only - the server decides
  // whether the route actually opens.
  const zone = engine.addEntity()
  entities.push(zone)
  Transform.create(zone, {
    position: Vector3.create(at.x, at.y + 1, at.z),
    scale: Vector3.create(PAD_RADIUS, PAD_RADIUS, PAD_RADIUS)
  })
  TriggerArea.setSphere(zone, ColliderLayer.CL_PLAYER)

  triggerAreaEventsSystem.onTriggerEnter(zone, () => paintPressurePad(pad, true))
  triggerAreaEventsSystem.onTriggerExit(zone, () => paintPressurePad(pad, false))

  return pad
}

function paintPressurePad(pad: Entity, pressed: boolean) {
  Material.setPbrMaterial(pad, {
    albedoColor: pressed ? CP_DONE_ALBEDO : CP_ALBEDO,
    emissiveColor: pressed ? CP_DONE_EMISSIVE : CP_EMISSIVE,
    emissiveIntensity: pressed ? 5 : 2
  })
}

/** Turns the bypass solid, or ghosts it again. */
export function setShortcutOpen(shortcut: BuiltShortcut, open: boolean) {
  if (shortcut.open === open) return
  shortcut.open = open

  for (const entity of shortcut.route) {
    if (open) {
      MeshCollider.setBox(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: CP_ALBEDO,
        emissiveColor: CP_EMISSIVE,
        emissiveIntensity: 2.5
      })
    } else {
      MeshCollider.deleteFrom(entity)
      Material.setPbrMaterial(entity, { albedoColor: SHORTCUT_CLOSED })
    }
  }
}

export function clearWorld(world: World | null) {
  if (!world) return
  for (const entity of world.entities) {
    engine.removeEntity(entity)
  }
  world.entities = []
  world.pads = []
  world.spinners = []
  world.movers = []
  world.checkpoints = []
  world.shortcut = null
  world.levers = []
}

/**
 * A blob shadow on the ground under every pad. Research on 3D platformers is
 * blunt about this: without an anchor on the ground a floating object's
 * position is ambiguous, and players cannot judge where a platform actually is.
 * Higher pads cast a larger, fainter blob, which also reads as distance.
 */
function createGroundShadow(pad: Pad): Entity {
  const lift = quantise(pad.y, SHADOW_STEPS)
  const shadow = engine.addEntity()

  Transform.create(shadow, {
    position: Vector3.create(pad.x, 0.06, pad.z),
    scale: Vector3.create(pad.size * (1 + lift * 0.7), 0.02, pad.size * (1 + lift * 0.7))
  })
  MeshRenderer.setCylinder(shadow)
  Material.setPbrMaterial(shadow, {
    albedoColor: Color4.create(0, 0, 0.02, 0.42 - lift * 0.28),
    metallic: 0,
    roughness: 1
  })
  return shadow
}

/**
 * A short column hanging under each pad. Slabs floating in mid-air read as
 * placeholder geometry; give them a support and the round reads as built.
 */
/**
 * A short plinth directly under the slab.
 *
 * This used to be a 1.4-2.4 m stalk a quarter of the pad wide, in near-black.
 * From any distance the tower read as a field of dark lollipops - the stalks
 * were the loudest thing in frame and the platforms looked like paper discs
 * balanced on wires. A plinth the full width of the slab, only slightly
 * darker than it, gives the platform mass instead of a stem.
 */
function createStrut(pad: Pad, index: number): Entity {
  const plinth = engine.addEntity()
  const height = 0.8 + (index % 3) * 0.15

  Transform.create(plinth, {
    position: Vector3.create(pad.x, pad.y - 0.25 - height / 2, pad.z),
    scale: Vector3.create(pad.size * 0.82, height, pad.size * 0.82)
  })
  if (isLandmark(pad)) MeshRenderer.setCylinder(plinth)
  else MeshRenderer.setBox(plinth)

  // Two thirds of the slab's own colour: it reads as the same object seen in
  // shadow, rather than as a separate dark thing holding it up.
  const body = sectionBody(pad.section)
  Material.setPbrMaterial(plinth, {
    albedoColor: Color4.create(body.r * 0.86, body.g * 0.86, body.b * 0.9, 1),
    roughness: 0.85
  })
  return plinth
}


/**
 * A dark mast through the middle of the tower. It gives the scattered pads a
 * vertical anchor, so a round reads as one structure instead of loose boxes.
 */
/**
 * The tower's core.
 *
 * This was a 0.7 m cylinder standing 80 m tall - at any distance a black wire
 * with platforms scattered around it, which is why the scene read as debris
 * rather than as a building. A core needs mass to be a core: 5 m across at the
 * base tapering to 2.8 m, so the silhouette narrows the way a tower's does and
 * the climb visibly has something to climb around.
 *
 * setCylinder(entity, radiusBottom, radiusTop) - confirmed against the
 * installed @dcl/ecs MeshRenderer typings, not assumed.
 *
 * It stays clear of the pads by construction: SHAFT_MIN_RADIUS is 6 m and the
 * core's widest half-width is 2.5 m.
 */
function createSpine(height: number, accent: Color3): Entity[] {
  const made: Entity[] = []
  const BASE = 5
  const TOP = 2.8

  const core = engine.addEntity()
  Transform.create(core, {
    position: Vector3.create(CENTER_X, height / 2, CENTER_Z),
    scale: Vector3.create(BASE, height + 2.5, BASE)
  })
  MeshRenderer.setCylinder(core, 0.5, (TOP / BASE) * 0.5)
  // Dark enough to sit behind the platforms, light enough not to punch a
  // black hole in a bright sky - which is exactly what 0.16 did.
  Material.setPbrMaterial(core, {
    texture: Material.Texture.Common({ src: CORE_TEXTURE }),
    albedoColor: Color4.create(0.63, 0.6, 0.55, 1),
    metallic: 0.1,
    roughness: 0.8
  })
  made.push(core)

  // One band per zone, coloured by that zone's own accent, so the core itself
  // carries the altitude ramp and reads as storeys rather than as a pole.
  for (let zone = 1; zone <= TOWER_ZONES; zone++) {
    const t = zone / TOWER_ZONES
    const y = height * t
    const width = BASE + (TOP - BASE) * t + 1.1

    const band = engine.addEntity()
    Transform.create(band, {
      position: Vector3.create(CENTER_X, y, CENTER_Z),
      scale: Vector3.create(width, 0.35, width)
    })
    MeshRenderer.setCylinder(band, 0.5, 0.5)
    const tone = sectionAccent(zone)
    // Full-strength zone colour: the bands are how the core carries the
    // altitude ramp, and at half strength they just read as grey collars.
    Material.setPbrMaterial(band, {
      albedoColor: Color4.create(tone.r, tone.g, tone.b, 1),
      emissiveColor: tone,
      emissiveIntensity: 0.9,
      roughness: 0.4
    })
    made.push(band)
  }

  return made
}

/** Turns a checkpoint green once the player has banked it. */
export function activateCheckpoint(checkpoint: Checkpoint) {
  if (checkpoint.ring) {
    Material.setPbrMaterial(checkpoint.ring, {
      albedoColor: CP_DONE_ALBEDO,
      emissiveColor: CP_DONE_EMISSIVE,
      emissiveIntensity: 4
    })
  }
  if (checkpoint.column) {
    Material.setPbrMaterial(checkpoint.column, {
      albedoColor: Color4.create(0.35, 1, 0.55, 0.5),
      emissiveColor: CP_DONE_EMISSIVE,
      emissiveIntensity: 5
    })
  }
  if (checkpoint.label) {
    const text = TextShape.getMutable(checkpoint.label)
    text.text = 'CHECKPOINT ' + checkpoint.number + '\nSAVED'
    text.textColor = CP_DONE_ALBEDO
  }
}

function createCheckpointMarker(pad: Pad, number: number) {
  const ring = engine.addEntity()
  Transform.create(ring, {
    position: Vector3.create(pad.x, pad.y + 0.37, pad.z),
    scale: Vector3.create(pad.size * 1.06, 0.12, pad.size * 1.06)
  })
  MeshRenderer.setCylinder(ring)
  Material.setPbrMaterial(ring, {
    albedoColor: CP_ALBEDO,
    emissiveColor: CP_EMISSIVE,
    emissiveIntensity: 4
  })

  // A slim beacon, visible from far below. Kept narrow and very transparent:
  // at any real width it renders as a flat grey slab instead of a light shaft.
  const column = engine.addEntity()
  Transform.create(column, {
    position: Vector3.create(pad.x, pad.y + 3.6, pad.z),
    scale: Vector3.create(0.4, 6.6, 0.4)
  })
  MeshRenderer.setCylinder(column)
  Material.setPbrMaterial(column, {
    albedoColor: Color4.create(0.25, 0.9, 1, 0.5),
    emissiveColor: CP_EMISSIVE,
    emissiveIntensity: 5
  })

  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(pad.x, pad.y + 4.6, pad.z) })
  TextShape.create(label, {
    text: 'CHECKPOINT ' + number,
    fontSize: 2.2,
    textColor: CP_ALBEDO,
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

  return { ring, column, label }
}

function paintHazard(entity: Entity) {
  // Intensity 4 pushed the emissive past the albedo and the bars rendered
  // salmon-pink. Red is the one colour in the vocabulary that has to be
  // unmistakable at a glance, so it renders as its own colour, lit enough to
  // read against the sky and no further.
  Material.setPbrMaterial(entity, {
    albedoColor: HAZARD_ALBEDO,
    emissiveColor: HAZARD_EMISSIVE,
    emissiveIntensity: 1.4,
    roughness: 0.6
  })
}

export function paintPad(entity: Entity, pad: Pad) {
  if (pad.crumble) {
    Material.setPbrMaterial(entity, {
      albedoColor: CRUMBLE_ALBEDO,
      emissiveColor: CRUMBLE_EMISSIVE,
      emissiveIntensity: 1.6,
      roughness: 0.7
    })
    return
  }

  switch (pad.kind) {
    case 'start':
      Material.setPbrMaterial(entity, {
        albedoColor: START_ALBEDO,
        emissiveColor: START_EMISSIVE,
        emissiveIntensity: 2
      })
      return
    case 'checkpoint':
      Material.setPbrMaterial(entity, {
        albedoColor: CP_ALBEDO,
        emissiveColor: CP_EMISSIVE,
        emissiveIntensity: 1.8
      })
      return
    case 'finish':
      Material.setPbrMaterial(entity, {
        albedoColor: FINISH_ALBEDO,
        emissiveColor: FINISH_EMISSIVE,
        emissiveIntensity: 4
      })
      return
    default: {
      // Aerial perspective: the higher a pad sits, the more it washes towards
      // the sky. It reads as height even when nothing else in frame does.
      const base = sectionBody(pad.section)
      // 0.45 washed the top half of the tower to near-white and took the
      // altitude ramp with it. 0.22 still reads as aerial perspective while
      // leaving the zone colour legible from the ground.
      const haze = quantise(pad.y, HAZE_STEPS) * 0.1
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
        albedoColor: Color4.create(
          base.r + (0.82 - base.r) * haze,
          base.g + (0.8 - base.g) * haze,
          base.b + (0.88 - base.b) * haze,
          1
        ),
        // The top face points at a bright sky, which bleaches it - and the
        // top face is the one a climber actually looks at. A little self-lit
        // colour holds the "safe" reading from directly above.
        // Down from 1.05. That level was set when a dark plinth sat under
        // every slab to contrast against; without it the emissive simply
        // washed the fill to white and the safe-colour reading went with it.
        emissiveColor: sectionAccent(pad.section),
        emissiveIntensity: 0.32,
        metallic: 0,
        roughness: 0.75
      })
    }
  }
}

/**
 * Flashes a crumbling pad the moment it is triggered. Without this the only
 * feedback is the floor already being gone, which reads as the game cheating.
 */
export function paintCrumbling(entity: Entity) {
  const warning = {
    albedoColor: Color4.create(1, 0.55, 0.15, 1),
    emissiveColor: Color3.create(1, 0.5, 0.05),
    emissiveIntensity: 6
  }
  Material.setPbrMaterial(entity, warning)
}

/** Dimmed look while a crumbling pad is gone. */
export function paintCrumbled(entity: Entity) {
  const faded = {
    albedoColor: Color4.create(0.28, 0.18, 0.12, 0.3),
    emissiveColor: Color3.Black(),
    emissiveIntensity: 0
  }
  Material.setPbrMaterial(entity, faded)
}

/**
 * The finish gate: posts, a lintel and a line across the pad, squared up to
 * the direction the player arrives from so they run through it, not past it.
 */
/**
 * THE CROWN - the same architecture as the start gate, in gold.
 *
 * A climb should end somewhere that looks like an ending. This was two glowing
 * poles and a bar; it is a monument now, built from the same shapes as the
 * threshold seventy metres below, so arriving here rhymes with setting off.
 * Gold means goal everywhere else in the game and it means it hardest here.
 */
function createGoal(pad: Pad, fromX: number, fromZ: number): Entity[] {
  const made: Entity[] = []

  let dirX = pad.x - fromX
  let dirZ = pad.z - fromZ
  const length = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1
  dirX /= length
  dirZ /= length

  const acrossX = -dirZ
  const acrossZ = dirX
  const yaw = (Math.atan2(dirX, dirZ) * 180) / Math.PI
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  const width = Math.max(pad.size, 3.2)
  const deck = pad.y + PAD_TOP
  const half = width / 2

  const STONE = Color4.create(0.6, 0.55, 0.45, 1)
  const STONE_DARK = Color4.create(0.4, 0.36, 0.3, 1)

  const at = (side: number, up: number, out = 0) =>
    Vector3.create(
      pad.x + acrossX * side + dirX * out,
      deck + up,
      pad.z + acrossZ * side + dirZ * out
    )

  const block = (position: Vector3, scale: Vector3, colour: Color4) => {
    const e = engine.addEntity()
    Transform.create(e, { position, rotation, scale })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: colour, roughness: 0.85 })
    made.push(e)
  }

  const gold = (position: Vector3, scale: Vector3, intensity = 3) => {
    const e = engine.addEntity()
    Transform.create(e, { position, rotation, scale })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, {
      albedoColor: FINISH_ALBEDO,
      emissiveColor: FINISH_EMISSIVE,
      emissiveIntensity: intensity
    })
    made.push(e)
  }

  for (const direction of [-1, 1]) {
    const side = direction * half
    block(at(side, 0.3), Vector3.create(1.5, 0.6, 1.5), STONE_DARK)

    const shaft = engine.addEntity()
    Transform.create(shaft, {
      position: at(side, 2.7),
      rotation,
      scale: Vector3.create(1, 4.2, 1)
    })
    MeshRenderer.setCylinder(shaft, 0.5, 0.32)
    Material.setPbrMaterial(shaft, { albedoColor: STONE, roughness: 0.85 })
    made.push(shaft)

    block(at(side, 4.95), Vector3.create(1.2, 0.4, 1.2), STONE_DARK)
    gold(at(side - direction * 0.55, 2.7), Vector3.create(0.12, 3.6, 0.45))
  }

  block(at(0, 5.5), Vector3.create(width + 2.4, 0.85, 1.1), STONE)
  block(at(0, 5), Vector3.create(width + 1.7, 0.2, 0.9), STONE_DARK)
  gold(at(0, 4.86, 0.45), Vector3.create(width + 1.2, 0.1, 0.12), 4)

  // The ring above: the one shape here that exists purely to be seen from the
  // yard, seventy metres down.
  const ring = engine.addEntity()
  Transform.create(ring, {
    position: at(0, 6.9),
    scale: Vector3.create(width + 1.2, 0.28, width + 1.2)
  })
  MeshRenderer.setCylinder(ring, 0.5, 0.5)
  Material.setPbrMaterial(ring, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: 5
  })
  made.push(ring)

  const label = engine.addEntity()
  made.push(label)
  Transform.create(label, { position: at(0, 4.4, -0.62), rotation })
  TextShape.create(label, {
    text: 'THE CROWN',
    fontSize: 2.6,
    textColor: Color4.create(1, 0.86, 0.35, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  gold(at(0, 0.06), Vector3.create(width, 0.08, 0.5), 4)

  return made
}
