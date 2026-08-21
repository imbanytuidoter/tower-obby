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
import { CENTER_X, CENTER_Z, HAZARD_THICKNESS, PAD_RADIUS } from './config'
import { Layout, MoverDef, Pad, SpinnerDef } from './layout'

export type BuiltPad = {
  entity: Entity
  /** Thin emissive slab under the pad. Reads as an edge light. */
  glow: Entity
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
  levers: BuiltLever[]
  shortcut: BuiltShortcut | null
  entities: Entity[]
}

/**
 * Fixed gameplay colours. These never change between rounds: cyan always means
 * safe, red always means it will hurt, gold always means the goal. Only the
 * neutral pad body and its accent follow the round theme.
 */
const HAZARD_ALBEDO = Color4.create(0.9, 0.16, 0.2, 1)
const HAZARD_EMISSIVE = Color3.create(1, 0.12, 0.16)
const CRUMBLE_ALBEDO = Color4.create(0.85, 0.45, 0.16, 1)
const CRUMBLE_EMISSIVE = Color3.create(1, 0.4, 0.08)
const FINISH_ALBEDO = Color4.create(1, 0.8, 0.25, 1)
const FINISH_EMISSIVE = Color3.create(1, 0.7, 0.1)
const CP_ALBEDO = Color4.create(0.25, 0.9, 1, 1)
const CP_EMISSIVE = Color3.create(0.15, 0.8, 1)
const CP_DONE_ALBEDO = Color4.create(0.35, 1, 0.55, 1)
const CP_DONE_EMISSIVE = Color3.create(0.25, 1, 0.45)
const START_ALBEDO = Color4.create(0.3, 0.9, 0.5, 1)
const START_EMISSIVE = Color3.create(0.18, 0.85, 0.42)

/**
 * A palette of matte body colours, one per section. Tower of Hell gives every
 * section its own colour so a climb reads as a stack of distinct places; the
 * same trick works here, and it costs nothing.
 */
const SECTION_BODIES: Color4[] = [
  Color4.create(0.44, 0.52, 0.66, 1),
  Color4.create(0.38, 0.58, 0.56, 1),
  Color4.create(0.56, 0.46, 0.64, 1),
  Color4.create(0.62, 0.54, 0.44, 1),
  Color4.create(0.4, 0.5, 0.42, 1),
  Color4.create(0.58, 0.44, 0.5, 1),
  Color4.create(0.46, 0.48, 0.58, 1),
  Color4.create(0.5, 0.58, 0.48, 1)
]

const SECTION_ACCENTS: Color3[] = [
  Color3.create(0.3, 0.65, 1),
  Color3.create(0.2, 0.9, 0.75),
  Color3.create(0.7, 0.4, 1),
  Color3.create(1, 0.7, 0.3),
  Color3.create(0.5, 0.9, 0.4),
  Color3.create(1, 0.45, 0.6),
  Color3.create(0.6, 0.7, 1),
  Color3.create(0.75, 1, 0.4)
]

function sectionBody(section: number): Color4 {
  return SECTION_BODIES[section % SECTION_BODIES.length]
}

export function sectionAccent(section: number): Color3 {
  return SECTION_ACCENTS[section % SECTION_ACCENTS.length]
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
  let tallest = 0

  for (let padIndex = 0; padIndex < layout.pads.length; padIndex++) {
    const pad = layout.pads[padIndex]
    tallest = Math.max(tallest, pad.y)

    const entity = engine.addEntity()
    entities.push(entity)

    Transform.create(entity, {
      position: Vector3.create(pad.x, pad.y, pad.z),
      scale: Vector3.create(pad.size, 0.5, pad.size)
    })
    if (isLandmark(pad)) {
      MeshRenderer.setCylinder(entity)
      MeshCollider.setCylinder(entity)
    } else {
      MeshRenderer.setBox(entity)
      MeshCollider.setBox(entity)
    }
    paintPad(entity, pad)

    const glow = createGlow(pad)
    entities.push(glow)
    entities.push(createStrut(pad, padIndex))
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
      const previous = layout.pads[padIndex - 1] ?? pad
      entities.push(...createGoal(pad, previous.x, previous.z))
    }

    pads.push({ entity, glow, pad, state: 'solid', timer: 0 })
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
    labelPad(lever, 'STAND HERE
STOPS THE BEAM', entities)
    return { pad, section: lever.section }
  })

  const shortcut = buildShortcut(layout, entities)

  return {
    sectionNames: layout.sectionNames,
    pads,
    spinners,
    movers,
    checkpoints,
    finish,
    levers,
    shortcut,
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
  labelPad(layout.shortcut.padA, 'BOTH PADS
OPENS A SHORTCUT', entities)
  labelPad(layout.shortcut.padB, 'BOTH PADS
OPENS A SHORTCUT', entities)

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
  MeshCollider.setCylinder(pad)
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
function createStrut(pad: Pad, index: number): Entity {
  const strut = engine.addEntity()
  const height = 1.4 + (index % 3) * 0.5

  Transform.create(strut, {
    position: Vector3.create(pad.x, pad.y - 0.45 - height / 2, pad.z),
    scale: Vector3.create(pad.size * 0.24, height, pad.size * 0.24)
  })
  if (isLandmark(pad)) MeshRenderer.setCylinder(strut)
  else MeshRenderer.setBox(strut)

  Material.setPbrMaterial(strut, {
    albedoColor: Color4.create(0.13, 0.14, 0.19, 1),
    metallic: 0.7,
    roughness: 0.45
  })
  return strut
}

/** A thin bright slab tucked under a pad, so every platform has a lit edge. */
function createGlow(pad: Pad): Entity {
  const glow = engine.addEntity()
  Transform.create(glow, {
    position: Vector3.create(pad.x, pad.y - 0.36, pad.z),
    scale: Vector3.create(pad.size * 0.9, 0.12, pad.size * 0.9)
  })
  if (isLandmark(pad)) MeshRenderer.setCylinder(glow)
  else MeshRenderer.setBox(glow)

  paintGlow(glow, sectionAccent(pad.section))
  return glow
}

/**
 * A dark mast through the middle of the tower. It gives the scattered pads a
 * vertical anchor, so a round reads as one structure instead of loose boxes.
 */
function createSpine(height: number, accent: Color3): Entity[] {
  const made: Entity[] = []

  const mast = engine.addEntity()
  Transform.create(mast, {
    position: Vector3.create(CENTER_X, height / 2, CENTER_Z),
    scale: Vector3.create(0.7, height + 2.5, 0.7)
  })
  MeshRenderer.setCylinder(mast)
  Material.setPbrMaterial(mast, {
    albedoColor: Color4.create(0.2, 0.22, 0.3, 1),
    metallic: 0.85,
    roughness: 0.3
  })
  made.push(mast)

  const ringCount = Math.max(3, Math.round(height / 4))
  for (let i = 1; i <= ringCount; i++) {
    const ring = engine.addEntity()
    Transform.create(ring, {
      position: Vector3.create(CENTER_X, (height / ringCount) * i, CENTER_Z),
      scale: Vector3.create(1.5, 0.12, 1.5)
    })
    MeshRenderer.setCylinder(ring)
    Material.setPbrMaterial(ring, {
      albedoColor: Color4.create(accent.r, accent.g, accent.b, 1),
      emissiveColor: accent,
      emissiveIntensity: 2.5
    })
    made.push(ring)
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
  Material.setPbrMaterial(entity, {
    albedoColor: HAZARD_ALBEDO,
    emissiveColor: HAZARD_EMISSIVE,
    emissiveIntensity: 4
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
      const haze = quantise(pad.y, HAZE_STEPS) * 0.45
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(
          base.r + (0.82 - base.r) * haze,
          base.g + (0.8 - base.g) * haze,
          base.b + (0.88 - base.b) * haze,
          1
        ),
        emissiveColor: sectionAccent(pad.section),
        emissiveIntensity: 0.4,
        metallic: 0.2,
        roughness: 0.7
      })
    }
  }
}

/**
 * Flashes a crumbling pad the moment it is triggered. Without this the only
 * feedback is the floor already being gone, which reads as the game cheating.
 */
export function paintCrumbling(entity: Entity, glow: Entity) {
  const warning = {
    albedoColor: Color4.create(1, 0.55, 0.15, 1),
    emissiveColor: Color3.create(1, 0.5, 0.05),
    emissiveIntensity: 6
  }
  Material.setPbrMaterial(entity, warning)
  Material.setPbrMaterial(glow, warning)
}

/** Dimmed look while a crumbling pad is gone. */
export function paintCrumbled(entity: Entity, glow: Entity) {
  const faded = {
    albedoColor: Color4.create(0.28, 0.18, 0.12, 0.3),
    emissiveColor: Color3.Black(),
    emissiveIntensity: 0
  }
  Material.setPbrMaterial(entity, faded)
  Material.setPbrMaterial(glow, faded)
}

/** Paints a pad's edge light. Also used to restore a crumbled pad. */
export function paintGlow(glow: Entity, accent: Color3) {
  Material.setPbrMaterial(glow, {
    albedoColor: Color4.create(accent.r, accent.g, accent.b, 1),
    emissiveColor: accent,
    emissiveIntensity: 3
  })
}

/**
 * The finish gate: posts, a lintel and a line across the pad, squared up to
 * the direction the player arrives from so they run through it, not past it.
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
  const width = Math.max(pad.size, 2.6)
  const deck = pad.y + PAD_TOP

  for (const direction of [-1, 1]) {
    const post = engine.addEntity()
    Transform.create(post, {
      position: Vector3.create(
        pad.x + acrossX * direction * (width / 2),
        deck + 3.1,
        pad.z + acrossZ * direction * (width / 2)
      ),
      scale: Vector3.create(0.45, 6.2, 0.45)
    })
    MeshRenderer.setCylinder(post)
    Material.setPbrMaterial(post, {
      albedoColor: FINISH_ALBEDO,
      emissiveColor: FINISH_EMISSIVE,
      emissiveIntensity: 3
    })
    made.push(post)
  }

  const lintel = engine.addEntity()
  Transform.create(lintel, {
    position: Vector3.create(pad.x, deck + 4.6, pad.z),
    rotation,
    scale: Vector3.create(width + 1.6, 0.7, 0.5)
  })
  MeshRenderer.setBox(lintel)
  Material.setPbrMaterial(lintel, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: 4
  })
  made.push(lintel)

  const line = engine.addEntity()
  Transform.create(line, {
    position: Vector3.create(pad.x, deck + 0.07, pad.z),
    rotation,
    scale: Vector3.create(width, 0.1, 0.7)
  })
  MeshRenderer.setBox(line)
  Material.setPbrMaterial(line, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: 5
  })
  made.push(line)

  // Same as the start gate: a fixed sign squared up to the gate, not a
  // billboard that swings around and looks detached from the structure.
  const signY = deck + 5.5
  const panel = engine.addEntity()
  Transform.create(panel, {
    position: Vector3.create(pad.x, signY, pad.z),
    rotation,
    scale: Vector3.create(6, 1.4, 0.18)
  })
  MeshRenderer.setBox(panel)
  Material.setPbrMaterial(panel, {
    albedoColor: Color4.create(0.14, 0.1, 0.02, 1),
    metallic: 0,
    roughness: 0.95
  })
  made.push(panel)

  const sign = engine.addEntity()
  Transform.create(sign, {
    position: Vector3.create(pad.x - dirX * 0.2, signY, pad.z - dirZ * 0.2),
    rotation
  })
  TextShape.create(sign, {
    text: 'FINISH',
    fontSize: 4.2,
    textColor: FINISH_ALBEDO,
    outlineColor: Color4.Black(),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  made.push(sign)

  return made
}
