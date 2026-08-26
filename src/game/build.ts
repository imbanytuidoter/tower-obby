import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  Material,
  MeshCollider,
  MeshRenderer,
  VisibilityComponent,
  LightSource,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CLIPS, MODELS, placeProp } from './props'
import { ColliderLayer, TriggerArea, triggerAreaEventsSystem } from '@dcl/sdk/ecs'
import {
  BANDS,
  CENTER_X,
  CENTER_Z,
  DECOR_MAX_SATURATION,
  FOREST,
  PAD_EMISSIVE,
  SHADOW_MAX_HEIGHT,
  CELEBRATION_SHARDS,
  CHECKPOINT_EVERY_SECTIONS,
  TOWER_ZONES,
  FINISH_RADIUS,
  FINISH_TOUCH_MARGIN,
  HAZARD_THICKNESS,
  PAD_RADIUS,
  WALL_SIZE,
  HAUL_TARGET
} from './config'
import {
  backdropRing,
  checkpointAltitudes,
  Layout,
  Pickup,
  MoverDef,
  Pad,
  SpinnerDef,
  treeLine,
  undergrowth,
  trunkGrowth
} from './layout'
import { accentRgb, BACKDROP_EMISSIVE, bodyRgb, MEANING, zoneRamp } from './palette'

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
  /** The landing's own width, so banking can test the pad and not a circle. */
  size: number
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
  /** Where the choice is made, so the prompt knows when to speak. */
  junction: Vector3
  boldPads: number
  safePads: number
  savesSeconds: number
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

export type BuiltPickup = { entity: Entity; def: Pickup; taken: boolean }

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
  /** Optional pickups. Hidden one at a time as this player finds them. */
  pickups: BuiltPickup[]
  /** Shards that burst from the crown on a summit. Parked when idle. */
  celebration: Entity[]
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
/**
 * The forest may not shout. A boot-time guard, not a note in a review.
 *
 * Decoration exists to be ignored; the four meanings exist to be read. The
 * moment a leaf is as saturated as a hazard, the player has to think about
 * which is which, and that is the whole failure mode this style has.
 */
/** Which band a zone belongs to. The band name is the only tutorial left. */
export function bandFor(section: number): string {
  const band = BANDS.find((b) => section >= b.from && section <= b.to)
  return band ? band.name : BANDS[BANDS.length - 1].name
}

export function assertDecorIsQuiet() {
  const saturation = (hex: string) => {
    const c = Color4.fromHexString(hex)
    const mx = Math.max(c.r, c.g, c.b)
    const mn = Math.min(c.r, c.g, c.b)
    if (mx === mn) return 0
    const l = (mx + mn) / 2
    return (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn)
  }

  for (const [name, hex] of Object.entries(FOREST)) {
    const s = saturation(hex)
    if (s > DECOR_MAX_SATURATION) {
      throw new Error(
        'build: decor ' + name + ' at ' + s.toFixed(2) + ' competes with a meaning'
      )
    }
  }
}

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
// Was #FF9D2E, fourteen degrees of hue from the checkpoint gold. Moved down
// and warmer: 21 degrees and 0.35 of luminance from gold, 30 degrees from the
// hazard red. Kept in palette.ts as MEANING.unstable so the separation between
// every pair of meanings is checked rather than trusted.
const CRUMBLE_ALBEDO = Color4.fromHexString(MEANING.unstable + 'FF')
const CRUMBLE_EMISSIVE = Color3.create(0.86, 0.34, 0.06)
const FINISH_ALBEDO = Color4.fromHexString('#FFD23FFF')
const FINISH_EMISSIVE = Color3.create(1, 0.7, 0.1)
const CP_ALBEDO = Color4.fromHexString('#FFD23FFF')
const CP_EMISSIVE = Color3.create(1, 0.72, 0.15)
const CP_DONE_ALBEDO = Color4.fromHexString(MEANING.banked + 'FF')
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
/** Colour lives in palette.ts so the value rule can be asserted in Node. */
function sectionBody(section: number): Color4 {
  const [r, g, b] = bodyRgb(section)
  return Color4.create(r, g, b, 1)
}

/** The edge light. Brighter than the face so the lip of a slab reads first. */
export function sectionAccent(section: number): Color3 {
  const [r, g, b] = accentRgb(section)
  return Color3.create(r, g, b)
}

/**
 * The optional pickups.
 *
 * Billboarded rather than spun by a system: a disc that always faces the
 * player is legible from every angle for free, and a spin would cost a system
 * running every frame for eight objects nobody has to interact with.
 *
 * No collider by construction. It is a thing you pass through, and a
 * collectible you can stand on is a platform the layout never accounted for.
 */
function createPickups(layout: Layout, entities: Entity[]): BuiltPickup[] {
  return layout.pickups.map((def) => {
    const entity = engine.addEntity()
    entities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(def.x, def.y, def.z),
      scale: Vector3.create(0.95, 0.1, 0.95),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0)
    })
    MeshRenderer.setCylinder(entity)
    // It used to be a billboard, which held it permanently flat-on to the
    // camera: a gold circle pasted on the world, dead still, easy to read as
    // part of the backdrop. A coin that turns is the oldest pickup signal
    // there is, and the edge-on moment is what makes it a coin and not a dot.
    Material.setPbrMaterial(entity, {
      albedoColor: CP_ALBEDO,
      emissiveColor: Color3.create(CP_ALBEDO.r, CP_ALBEDO.g, CP_ALBEDO.b),
      emissiveIntensity: PAD_EMISSIVE.goal * 2.2,
      roughness: 0.25,
      metallic: 0.6,
      castShadows: false
    })
    return { entity, def, taken: false }
  })
}

/**
 * Gold beacons - the ante coin, the plate's target line, a checkpoint ring,
 * the crown's ring - were at 4 and 5. Gold at that intensity renders white,
 * which costs a beacon the exact thing that makes it one. Bright, but still
 * gold: emphasis by brightness, identity by hue, the same rule everywhere.
 */
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
    const blob = createGroundShadow(pad)
    if (blob) entities.push(blob)

    const top = Vector3.create(pad.x, pad.y + PAD_TOP, pad.z)

    if (pad.kind === 'start') {
      checkpoints.push({
        top,
        ring: null,
        column: null,
        label: null,
        number: 0,
        padIndex,
        size: pad.size
      })
    }

    if (pad.kind === 'checkpoint') {

      // No crystal here any more.
      //
      // It said "safe" a second time on a pad that is already round, already
      // cyan, and already wearing a collar - and it said it in the shape of a
      // small glowing object sitting on the floor, which in every game ever
      // made means PICK ME UP. Two different players asked what it was for
      // and one tried to collect it. A decoration that has to be explained on
      // a signboard has already lost; redundancy that actively misleads is
      // worse than no decoration at all.

      const marker = createCheckpointMarker(pad, checkpoints.length)
      entities.push(marker.ring, marker.column, marker.label)

      checkpoints.push({
        top,
        ring: marker.ring,
        column: marker.column,
        label: marker.label,
        number: checkpoints.length,
        padIndex,
        size: pad.size
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

  entities.push(...createSpine(tallest, checkpointAltitudes(layout)))

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
    // The point of the lever is that it is a favour. 'STOPS THE BEAM' reads
    // as something you do for yourself, and you cannot: holding it means you
    // are standing still while other people climb through.
    return { pad, section: lever.section }
  })

  const shortcut = buildShortcut(layout, entities)
  createBands(entities)
  createTreeLine(entities)
  createUndergrowth(entities, layout.pads)
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
    pickups: createPickups(layout, entities),
    // BY KIND, not by index. The crown is marked before the coin ledges are
    // appended, so the last pad in the array is now a 2.6 m perch somewhere
    // in the middle of the climb - and the finish burst was parked on it.
    // Nothing failed loudly; the fireworks simply went off in the wrong place.
    celebration: createCelebration(
      layout.pads.filter((pad) => pad.kind === 'finish')[0] ?? layout.pads[layout.pads.length - 1],
      entities
    ),
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
    // At unstable * 5 the emissive drowned the albedo and a dark orange slab
    // rendered cream - the same failure already found and written up on the
    // hazard bars, which came out salmon-pink at intensity 4. The table value
    // is the table value; a colour that only exists in the source is not a
    // colour the player can read.
    Material.setPbrMaterial(slab, {
      texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
      albedoColor: CRUMBLE_ALBEDO,
      emissiveColor: CRUMBLE_EMISSIVE,
      emissiveIntensity: PAD_EMISSIVE.unstable,
      roughness: 0.7
    })
    const blob = createGroundShadow(pad)
    if (blob) entities.push(blob)
  }

  // The detour pads used to carry an orange crystal apiece. Same verdict as
  // the teal ones: the pads are already rust orange, so the crystal repeated
  // what the pad said while looking like the coin at the end of the detour.
  // Three fake collectibles guarding one real one.

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
    emissiveIntensity: PAD_EMISSIVE.goal * 2
  })

  const anchor = def.route[def.route.length - 1]
  // No board. The gold coin on a rust-orange detour says "optional reward off
  // the route" in colour and shape, and the prompt line names the deal when
  // you are close enough to take it.

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
  // Cyan albedo under a pale lilac emissive at 1.2 rendered as a white disc -
  // the fourth time in this file the same mistake produced the same result.
  // The plate IS safe ground, so it keeps the safe colour, and the fact that
  // it is special is carried by being brighter than ordinary safe ground
  // rather than by being a different colour.
  Material.setPbrMaterial(entity, {
    texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
    albedoColor: SAFE_FILL,
    emissiveColor: Color3.create(SAFE_FILL.r, SAFE_FILL.g, SAFE_FILL.b),
    emissiveIntensity: PAD_EMISSIVE.safe * 2,
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
    emissiveIntensity: PAD_EMISSIVE.goal * 2
  })

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

    // The ring stays; the two floating boards do not.
    //
    // They priced both arms before you committed, which is the right idea and
    // was the wrong object: on a phone, from where you have to stand to make
    // the choice, "SAFE" and "4 pads no drop" filled the screen in letters
    // taller than the avatar, with the plate behind them clipped by the near
    // plane so only the words were left hanging. The same numbers now go to
    // the prompt line - the place Decentraland's mobile guidance reserves for
    // contextual hints, and where every other choice in this tower already
    // explains itself. See forkPrompt in index.ts.
    entities.push(createChoiceEdge(junction))

    const range = (start: number, count: number) =>
      Array.from({ length: count }, (unused, i) => start + i)
    built.push({
      zone: junction.section,
      bold: range(fork.boldFirst, fork.boldPads),
      safe: range(fork.safeFirst, fork.safePads),
      saves: fork.savesSeconds,
      junction: Vector3.create(junction.x, junction.y, junction.z),
      boldPads: fork.boldPads,
      safePads: fork.safePads,
      savesSeconds: fork.savesSeconds
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

  return { route, padA, padB, open: false }
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
  // Gold waiting, green held: the same pair the checkpoints use, because it
  // means the same thing - here is a thing to do, and now it is done. The
  // change of state is carried by the colour AND by brightness, which is what
  // a momentary state wants; a permanent identity would use only hue.
  Material.setPbrMaterial(pad, {
    albedoColor: pressed ? CP_DONE_ALBEDO : CP_ALBEDO,
    emissiveColor: pressed ? CP_DONE_EMISSIVE : CP_EMISSIVE,
    emissiveIntensity: pressed ? PAD_EMISSIVE.goal * 2 : PAD_EMISSIVE.goal
  })
}

/** Turns the bypass solid, or ghosts it again. */
export function setShortcutOpen(shortcut: BuiltShortcut, open: boolean) {
  if (shortcut.open === open) return
  shortcut.open = open

  for (const entity of shortcut.route) {
    if (open) {
      MeshCollider.setBox(entity)
      // Ground you can now walk on is safe ground, and safe ground is cyan.
      // In gold it was a third meaning for that colour - checkpoint, coin and
      // now route - which is precisely what the palette rule exists to stop.
      // That it just opened is said by being brighter, not by being gold.
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
        albedoColor: SAFE_FILL,
        emissiveColor: Color3.create(SAFE_FILL.r, SAFE_FILL.g, SAFE_FILL.b),
        emissiveIntensity: PAD_EMISSIVE.safe * 2
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
function createGroundShadow(pad: Pad): Entity | null {
  // A blob on the ground under a pad forty metres up is never in frame with
  // the pad it belongs to: by then the ground is behind you and out of sight,
  // and the anchor it was drawing anchors nothing. One per pad cost 119
  // material slots - a quarter of the whole mobile budget - to draw an anchor
  // that ninety of them could not be seen next to.
  //
  // The cut is the top of the understory band rather than a round number,
  // because that is exactly the height above which the clearing floor stops
  // sharing the screen with the climb.
  if (pad.y > SHADOW_MAX_HEIGHT) return null

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
/**
 * The forest behind the climb.
 *
 * There is no fog component in SDK7 - only SkyboxTime - so the bands are
 * built rather than rendered: a ring of inward-facing panels per band,
 * standing outside every pad and inside the ground plate. Each ring is one
 * flat colour, and they darken with altitude so a pad is always lighter than
 * what is behind it. That is the value separation the whole style depends on,
 * and it is why the crown is the darkest band rather than the brightest.
 */
function createBands(entities: Entity[]) {
  // Geometry comes from layout.ts so it can be asserted in Node. Everything
  // below is material work only - no angles are computed here any more.
  for (const panel of backdropRing()) {
    const colour = Color4.fromHexString(panel.backdrop)

    const entity = engine.addEntity()
    entities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(panel.x, panel.y, panel.z),
      rotation: Quaternion.fromEulerDegrees(0, panel.yaw, 0),
      scale: Vector3.create(panel.thickness, panel.height, panel.length)
    })
    MeshRenderer.setBox(entity)
    // The boundary now BOUNDS.
    //
    // These panels had a renderer and nothing else, so the wall around the
    // whole scene was a painting: measured in-world, a six-second run from
    // the spawn put the player at x = -3, outside the 0..80 parcel box
    // entirely. A boundary that does not stop anybody is scenery pretending
    // to be a rule, and it was the first thing asked for about this scene.
    MeshCollider.setBox(entity)
    // Self-lit at low intensity. A vertical panel facing inward catches no
    // sky, so an unlit one renders black and the band reads as a hole
    // rather than as distance. The emissive is the band colour itself, so
    // it holds its exact value instead of whatever the sun leaves it.
    Material.setPbrMaterial(entity, {
      albedoColor: colour,
      emissiveColor: Color3.create(colour.r, colour.g, colour.b),
      emissiveIntensity: BACKDROP_EMISSIVE,
      roughness: 1,
      metallic: 0,
      // A 33 m wall ringing the whole scene threw the clearing into full
      // shade - the grass floor rendered black and the lobby with it. The
      // backdrop is distance, not an object; it has no business casting.
      castShadows: false
    })
  }
}

/**
 * A tree line standing between the climb and the backdrop wall.
 *
 * The wall alone was the problem: flat colour across more than half the frame
 * reads as cardboard, not as distance. Silhouette is what makes it a forest,
 * and silhouette is the one thing a painted box cannot supply.
 *
 * Placed at TREE_RING_RADIUS - outside every pad by construction, inside the
 * wall - so it can never enter a jump. Deterministic: angle and scale come
 * from the index, never from Math.random, or two clients grow different
 * forests.
 */
/**
 * The jungle floor.
 *
 * Geometry comes from layout.ts so it can be counted in Node; this function
 * only decides which GLB each kind maps to. Nothing here is solid - a player
 * who can get stuck on a fern beside a parkour tower has found a bug, not a
 * plant - and nothing casts, because 30-odd shadow casters ringing a clearing
 * is what turned the grass black the last time this scene grew a forest.
 */
function createUndergrowth(entities: Entity[], pads: Pad[]) {
  const source = {
    fern: MODELS.fern,
    plant: MODELS.junglePlant
  }

  for (const plant of [...undergrowth(), ...trunkGrowth(pads)]) {
    entities.push(
      placeProp(source[plant.kind], {
        position: Vector3.create(plant.x, plant.y ?? 0.06, plant.z),
        yaw: plant.yaw,
        scale: plant.scale,
        // Only the fern ships a clip, and it is the one that reads as alive.
        clip: plant.kind === 'fern' ? CLIPS.fern : undefined
      })
    )
  }
}

function createTreeLine(entities: Entity[]) {
  for (const tree of treeLine()) {
    entities.push(
      placeProp(MODELS.tree, {
        position: Vector3.create(tree.x, 0, tree.z),
        yaw: tree.yaw,
        scale: tree.scale,
        solid: true,
        hasColliderMeshes: true
      })
    )
  }
}

function createSpine(height: number, checkpointYs: number[]): Entity[] {
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
    // Bark. The trunk was always the thing this scene was going to become.
    albedoColor: Color4.fromHexString(FOREST.bark),
    metallic: 0.1,
    roughness: 0.8
  })
  made.push(core)

  // A collar on every zone read as a drill bit: twenty near-white rings up a
  // brown pole, and twenty material slots spent on the worst detail in frame.
  // Now a collar means one thing - a checkpoint is at this height - so the
  // trunk tells you where the next place you cannot fall below is. Same gold
  // as the checkpoint pads, because one colour must never mean two things.
  //
  // Heights come from the pads themselves. Spacing them evenly up the trunk
  // put them several metres off, because the climb does not rise evenly.
  for (const y of checkpointYs) {
    const t = Math.min(1, Math.max(0, y / height))
    const width = BASE + (TOP - BASE) * t + 0.32

    // A flat disc the width of a dinner plate read as a plate bolted to the
    // trunk. A collar wants to hug what it is around: barely wider than the
    // bark, taller than it is proud of it, and tapered so the light catches
    // one edge. setCylinder's two radii are what make the taper possible.
    const collar = engine.addEntity()
    Transform.create(collar, {
      position: Vector3.create(CENTER_X, y, CENTER_Z),
      scale: Vector3.create(width, 0.62, width)
    })
    MeshRenderer.setCylinder(collar, 0.5, 0.44)
    Material.setPbrMaterial(collar, {
      albedoColor: CP_ALBEDO,
      emissiveColor: Color3.create(CP_ALBEDO.r, CP_ALBEDO.g, CP_ALBEDO.b),
      emissiveIntensity: PAD_EMISSIVE.goal,
      roughness: 0.4,
      castShadows: false
    })
    made.push(collar)
  }

  return made
}

/** Turns a checkpoint green once the player has banked it. */
export function activateCheckpoint(checkpoint: Checkpoint) {
  if (checkpoint.ring) {
    Material.setPbrMaterial(checkpoint.ring, {
      albedoColor: CP_DONE_ALBEDO,
      emissiveColor: CP_DONE_EMISSIVE,
      emissiveIntensity: PAD_EMISSIVE.goal
    })
  }
  if (checkpoint.column) {
    Material.setPbrMaterial(checkpoint.column, {
      albedoColor: Color4.create(CP_DONE_ALBEDO.r, CP_DONE_ALBEDO.g, CP_DONE_ALBEDO.b, 0.42),
      emissiveColor: CP_DONE_EMISSIVE,
      emissiveIntensity: PAD_EMISSIVE.goal * 2
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
    emissiveIntensity: PAD_EMISSIVE.goal * 2
  })

  // A slim beacon, visible from far below. Kept narrow and very transparent:
  // at any real width it renders as a flat grey slab instead of a light shaft.
  const column = engine.addEntity()
  Transform.create(column, {
    position: Vector3.create(pad.x, pad.y + 2.6, pad.z),
    scale: Vector3.create(1.5, 4.6, 1.5)
  })
  // A CONE, wide at the pad and closed at the top, not a stick.
  //
  // It was a 0.4 m cylinder 6.6 m tall at 42% alpha, and from any distance
  // that reads as a pale pole somebody left standing on the checkpoint - the
  // exact opposite of a shaft of light. A beam of light is widest where it
  // lands and fades as it rises, so the geometry now says that instead of
  // relying on the alpha to imply it. Shorter, too: 6.6 m of it was taller
  // than the gap to the next pad and cluttered the climb above.
  MeshRenderer.setCylinder(column, 0.06, 0.5)
  // Cyan albedo under a gold emissive at intensity 5 came out white, which is
  // two rule breaks in one material: cyan means safe ground everywhere else in
  // this scene, and white is what everything turns into when the emissive is
  // set by feel. Gold, at the level the collars and the landing use, because
  // all four of them are saying the same word.
  Material.setPbrMaterial(column, {
    albedoColor: Color4.create(CP_ALBEDO.r, CP_ALBEDO.g, CP_ALBEDO.b, 0.24),
    emissiveColor: CP_EMISSIVE,
    emissiveIntensity: PAD_EMISSIVE.goal * 2,
    castShadows: false
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
    emissiveIntensity: PAD_EMISSIVE.hurts * 5,
    roughness: 0.6
  })
}

export function paintPad(entity: Entity, pad: Pad) {
  if (pad.crumble) {
    Material.setPbrMaterial(entity, {
      texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
      albedoColor: CRUMBLE_ALBEDO,
      emissiveColor: CRUMBLE_EMISSIVE,
      emissiveIntensity: PAD_EMISSIVE.unstable,
      roughness: 0.7
    })
    return
  }

  // The landmarks kept the emissive levels they had before the brief's table
  // arrived, while every other pad moved onto it. At 1.8 and 4 they blew out
  // to white plates: the gold that says "checkpoint" was the first thing to
  // go, and a landmark that loses its colour stops being a landmark.
  //
  // They also skipped the slab texture, so they had no rim while everything
  // around them had one. Same texture, so the edge reads the same way.
  switch (pad.kind) {
    case 'start':
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
        albedoColor: START_ALBEDO,
        emissiveColor: START_EMISSIVE,
        emissiveIntensity: PAD_EMISSIVE.goal
      })
      return
    case 'checkpoint':
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
        albedoColor: CP_ALBEDO,
        emissiveColor: CP_EMISSIVE,
        emissiveIntensity: PAD_EMISSIVE.goal
      })
      return
    case 'finish':
      // The one pad allowed to be brighter than the rule: it is the only pad
      // in the tower you are trying to reach from three zones below.
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: SLAB_TEXTURE }),
        albedoColor: FINISH_ALBEDO,
        emissiveColor: FINISH_EMISSIVE,
        emissiveIntensity: PAD_EMISSIVE.goal * 1.6
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
        emissiveIntensity: PAD_EMISSIVE.safe,
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
  // Same colour, louder. The warning was a raw orange at intensity 6 - close
  // enough to white that the pad appeared to change into something else
  // rather than to become urgent. Identity is carried by hue; urgency is
  // carried by brightness, and mixing the two costs you the identity.
  const warning = {
    albedoColor: CRUMBLE_ALBEDO,
    emissiveColor: CRUMBLE_EMISSIVE,
    emissiveIntensity: PAD_EMISSIVE.unstable * 5
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
/**
 * The shards that burst out of the crown when somebody summits.
 *
 * Not a particle system: the docs list SDK particles as still missing on the
 * mobile client, and the whole point of this scene is that it runs on a phone.
 * Fourteen small emissive boxes flung outward by one system, parked far below
 * the world the rest of the time, cost fourteen material slots and work
 * everywhere.
 */
export function createCelebration(pad: Pad, entities: Entity[]): Entity[] {
  const shards: Entity[] = []
  for (let i = 0; i < CELEBRATION_SHARDS; i++) {
    const shard = engine.addEntity()
    entities.push(shard)
    Transform.create(shard, {
      position: Vector3.create(pad.x, PARKED_Y, pad.z),
      scale: Vector3.create(0.22, 0.22, 0.5)
    })
    MeshRenderer.setBox(shard)
    Material.setPbrMaterial(shard, {
      albedoColor: FINISH_ALBEDO,
      emissiveColor: FINISH_EMISSIVE,
      emissiveIntensity: 3,
      castShadows: false
    })
    shards.push(shard)
  }
  return shards
}

/** Where a shard waits between summits. Far enough down to never be seen. */
export const PARKED_Y = -60

/** The turning ring over the crown, driven from the client's frame loop. */
export let crownHalo: Entity | null = null

/** The greeter's line. Dark until somebody actually finishes. */
export let greeterLine: Entity | null = null

/**
 * The crown's roll of names, in display order: newest first.
 *
 * Filled by the client whenever the server publishes a new Wall, which is the
 * only place the list exists - the crown builds the empty rows and never
 * invents a name for one.
 */
export const crownRoll: (Entity | null)[] = []

/**
 * The grove's day, written on the one object built to be read from the ground.
 *
 * The halo above the crown exists purely to be seen from the yard seventy
 * metres down, which makes it the only place a shared number can be shown to
 * somebody who is not at the top. It brightens as the day's coins come in and
 * goes to full when the grove has its target - so a climber in the lobby can
 * see, without reading anything, whether people have been here today.
 *
 * Written only when the count CHANGES. Setting a material every frame is a
 * component write every frame, for a value that moves a handful of times a
 * day.
 */
export function lightTheCrown(coins: number) {
  if (!crownHalo) return
  const share = Math.max(0, Math.min(1, coins / HAUL_TARGET))
  Material.setPbrMaterial(crownHalo, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    // Range, not just a nudge. The ring's old fixed value was goal * 3, which
    // is already near the top of what this material shows: ramping 3 -> 6.5
    // moved it from bright gold to blown-out white, and the two ends were
    // hard to tell apart in a screenshot taken deliberately to tell them
    // apart. Starting at 1.4 gives an unmistakably DIMMER ring at dawn and
    // keeps the same blaze at the top, so the change is legible from the yard
    // rather than only to whoever knew to look for it.
    emissiveIntensity: PAD_EMISSIVE.goal * (1.4 + share * 5.1)
  })
}

export function setCrownRoll(names: string[], seconds: number[]) {
  for (let i = 0; i < crownRoll.length; i++) {
    const line = crownRoll[i]
    if (!line) continue
    const shape = TextShape.getMutableOrNull(line)
    if (!shape) continue

    if (i >= names.length) {
      // An empty world says so on the first row rather than hanging a heading
      // over ten blank slots. Nobody has climbed it yet is a fact worth
      // reading, and it is the only invitation this scene can honestly make.
      shape.text = i === 0 && names.length === 0 ? 'BE THE FIRST' : ''
      continue
    }

    /**
     * Nine characters is what fits the cloth, measured rather than guessed.
     *
     * At fontSize 1.5 a character is about 0.105 m wide on this banner - taken
     * off a screenshot, by counting pixels across the heading and dividing by
     * the banner's known 1.9 m - so a nine-character name plus '  12.4s' comes
     * to 1.58 m and leaves a margin at each edge. The first build put a
     * twenty-five character line on it and the words hung past both sides of
     * the cloth into open air, which is the same failure the legend's samples
     * had and is worse than a name that is simply cut.
     */
    const name = names[i].length > 9 ? names[i].slice(0, 8) + '.' : names[i]
    shape.text = name + '  ' + (seconds[i] ?? 0).toFixed(1) + 's'
  }
}

/**
 * Shows or hides what the owl says.
 *
 * Called on a completed run and on the reset that follows it, so the summit
 * is silent for everybody who has not earned the line yet - including the
 * climber standing on it a second time.
 */
export function setGreeting(on: boolean) {
  if (!greeterLine) return
  const visibility = VisibilityComponent.getMutableOrNull(greeterLine)
  if (visibility) visibility.visible = on
}

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

  /**
   * Where the columns stand, measured from the centre.
   *
   * It used to be width / 2 - the slab's own radius - which put each plinth's
   * CENTRE on the rim and left its outer 0.75 m hanging over nothing. On a
   * square that reads as flush; the crown is a cylinder, so the floor curves
   * away underneath and the arch appears to float.
   *
   * The plinth is 1.5 m across, so its half-width plus a margin comes off the
   * radius and the whole footing lands on stone.
   */
  const PLINTH_HALF = 0.75
  const half = Math.max(1.6, pad.size / 2 - PLINTH_HALF - 0.3)
  /** Distance between the two column centres - what the lintel has to span. */
  const span = half * 2

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

  // The lintel spans the COLUMNS, not the slab. Sized off the slab it
  // overhung the posts by two metres on each side and read as a shelf.
  block(at(0, 5.5), Vector3.create(span + 1.7, 0.85, 1.1), STONE)
  block(at(0, 5), Vector3.create(span + 1.1, 0.2, 0.9), STONE_DARK)
  gold(at(0, 4.86, 0.45), Vector3.create(span + 0.6, 0.1, 0.12), 4)

  // Two banners off the lintel, and they carry the roll of names.
  //
  // The crown had the geometry of a monument and none of the ceremony: a
  // slab, two posts, a beam. Cloth is what tells you a place was DRESSED for
  // an occasion rather than merely built, and it is two boxes.
  //
  // One in each of the two colours a player has been reading for the whole
  // climb - the cyan that meant safe ground and the gold that meant the goal.
  // Nothing new to learn at the top.
  //
  // They were pure decoration until now, and the crown had no room left for a
  // monument of its own: the far edge is the greeter's, the centre is where
  // you land, and a stele anywhere on the near half is something to walk into.
  // The banners were already hanging at reading height, already facing the
  // arrival, already meaning ceremony - and text costs no material at all, so
  // the roll goes on the thing that was built to carry it.
  //
  // WIDTH is derived, not chosen. The outer edge stops just inside the column
  // shaft (half - 0.5 is its inner face) and the inner edge leaves a 2 m gap
  // down the middle, because the greeter stands dead centre behind them and a
  // pair of banners that meet in the middle is a pair of banners that hide it.
  const ROLL_GAP = 1.0
  const rollOuter = half - 0.55
  const rollWidth = Math.max(0.9, rollOuter - ROLL_GAP)
  const rollSide = ROLL_GAP + rollWidth / 2
  // Clear of the shafts, which reach out to 0.5 either side of the columns.
  const rollOut = 0.75

  for (const direction of [-1, 1]) {
    const banner = engine.addEntity()
    Transform.create(banner, {
      position: at(direction * rollSide, 3.35, rollOut),
      rotation,
      scale: Vector3.create(rollWidth, 3.5, 0.06)
    })
    MeshRenderer.setBox(banner)
    Material.setPbrMaterial(banner, {
      albedoColor: direction < 0 ? Color4.fromHexString(MEANING.safe) : FINISH_ALBEDO,
      emissiveColor: direction < 0 ? Color3.fromHexString(MEANING.safe) : FINISH_EMISSIVE,
      emissiveIntensity: 0.35,
      roughness: 0.95,
      castShadows: false
    })
    made.push(banner)
  }

  /**
   * The roll itself: WALL_SIZE rows, split evenly down the two banners.
   *
   * Row count comes from config, never from a number typed here - the legend
   * board shipped the wrong number of coins twice for exactly that reason.
   *
   * Two sign conventions, and both were got wrong on the first build here.
   *
   * `out` runs along the approach direction, and a climber arrives from the
   * far side of it - so anything meant to be read on arrival sits at a
   * SMALLER out than the thing it labels, never a larger one. The heading went
   * on at +0.62 against a lintel that only reaches 0.55, which put it behind
   * the beam it was carved into, invisible from the only place it is read.
   *
   * And the rotation is plain `yaw`, NOT yaw + 180. A TextShape in this client
   * reads from its local -Z - the same fact that makes Billboard BM_Y turn -Z
   * at the camera - so aligning local +Z with the approach direction is what
   * turns the words towards the person walking in. Turned the other way it
   * renders mirrored, which is what shipped: NOBODY YET - BE THE FIRST,
   * backwards, on the cloth. The greeter beside it does use yaw + 180, and
   * that is not a contradiction: it is a model, and a model faces along its
   * own forward axis.
   */
  const rows = Math.max(1, Math.floor(WALL_SIZE / 2))
  const ROW_STEP = 3.5 / (rows + 1)
  const rollRotation = rotation

  for (const direction of [-1, 1]) {
    for (let row = 0; row < rows; row++) {
      const line = engine.addEntity()
      Transform.create(line, {
        position: at(direction * rollSide, 3.35 + 1.75 - ROW_STEP * (row + 1), rollOut - 0.08),
        rotation: rollRotation
      })
      TextShape.create(line, {
        text: '',
        fontSize: 1.5,
        textColor: Color4.create(0.12, 0.14, 0.18, 1),
        outlineColor: Color4.create(1, 1, 1, 0.55),
        outlineWidth: 0.12,
        textAlign: TextAlignMode.TAM_MIDDLE_CENTER
      })
      made.push(line)
      /**
       * Newest names on the reader's LEFT, because a list that starts on the
       * right reads backwards - which is how it first shipped.
       *
       * Which side that is falls out of the axes rather than out of taste. A
       * viewer on the deck looks along `dir`; in this left-handed, Y-up space
       * their right hand is up x forward = (dirZ, -dirX), which is exactly
       * -across. So `across` points to their left, and the +1 banner - the
       * gold one - is the one they read first. Confirmed against a screenshot
       * before it was written down.
       */
      crownRoll[(direction > 0 ? 0 : rows) + row] = line
    }
  }

  // The heading goes on the lintel, which is span + 1.7 across and was blank.
  const frieze = engine.addEntity()
  Transform.create(frieze, { position: at(0, 5.5, -0.62), rotation: rollRotation })
  TextShape.create(frieze, {
    text: 'WHO STOOD HERE BEFORE YOU',
    fontSize: 2.1,
    textColor: FINISH_ALBEDO,
    outlineColor: Color4.Black(),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  made.push(frieze)

  // A stepped dais under the slab.
  //
  // Seen from below the crown was a disc hanging in the air, identical in
  // silhouette to every other pad in the tower and merely wider. Two tiers
  // under it cost two boxes and change what the shape MEANS: a slab you land
  // on becomes a plinth something stands on, and the thing standing on it is
  // whoever got there.
  //
  // Widths stay inside the arch's own footprint so nothing new overhangs the
  // climb below.
  for (const tier of [
    { radius: pad.size * 1.1, drop: 0.62, colour: STONE },
    { radius: pad.size * 1.22, drop: 1.18, colour: STONE_DARK }
  ]) {
    const step = engine.addEntity()
    Transform.create(step, {
      position: Vector3.create(pad.x, pad.y - tier.drop, pad.z),
      scale: Vector3.create(tier.radius, 0.48, tier.radius)
    })
    MeshRenderer.setCylinder(step)
    Material.setPbrMaterial(step, { albedoColor: tier.colour, roughness: 0.9 })
    made.push(step)
  }

  // A warm light under the arch.
  //
  // Costs nothing against the material budget - LightSource is not a renderer
  // - and it is the one place in the scene where light can do a job emissive
  // cannot: the arch is STONE, so it has no glow of its own, and a lamp under
  // the lintel is what makes the columns and the dais read as lit rather than
  // as pale. Absent on mobile, like every dynamic light here, so the crown
  // still has to work on its gold and its banners alone.
  const crownLamp = engine.addEntity()
  Transform.create(crownLamp, { position: at(0, 4.2) })
  LightSource.create(crownLamp, {
    type: LightSource.Type.Point({}),
    color: Color3.create(1, 0.82, 0.5),
    intensity: 14000,
    range: 22
  })
  made.push(crownLamp)

  // The ring above: the one shape here that exists purely to be seen from the
  // yard, seventy metres down. It turns - slowly, and for free, because a
  // rotation costs no material and a still hoop reads as scaffolding.
  const ring = engine.addEntity()
  crownHalo = ring
  Transform.create(ring, {
    position: at(0, 6.9),
    scale: Vector3.create(pad.size * 0.92, 0.28, pad.size * 0.92)
  })
  MeshRenderer.setCylinder(ring, 0.5, 0.5)
  Material.setPbrMaterial(ring, {
    albedoColor: FINISH_ALBEDO,
    emissiveColor: FINISH_EMISSIVE,
    emissiveIntensity: PAD_EMISSIVE.goal * 3
  })
  made.push(ring)

  const label = engine.addEntity()
  made.push(label)
  // Squared to the arch, it read correctly on the approach and MIRRORED from
  // anywhere else - and the crown is the one pad in the tower where people
  // stand still and turn around. Billboarded it costs nothing extra and is
  // never backwards.
  Transform.create(label, { position: at(0, 4.4, -0.62) })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(label, {
    text: 'THE CROWN',
    fontSize: 2.6,
    textColor: Color4.create(1, 0.86, 0.35, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  gold(at(0, 0.06), Vector3.create(width, 0.08, 0.5), 4)


  // A greeter at the top of the tree. It ships its own collider mesh, so
  // collision goes on that and nothing on the visible one; solid because a
  // bird you walk through is a decal.
  made.push(
    placeProp(MODELS.owl, {
      // On the far edge along the approach, not off to one side: from there
      // it is behind a pylon and half of it is hidden. Straight ahead is
      // where a climber is already looking when they land.
      position: Vector3.create(
        pad.x + dirX * (half - 0.3),
        deck,
        pad.z + dirZ * (half - 0.3)
      ),
      yaw: yaw + 180,
      // 2.36 m of wingspan at scale 1. It was 0.85 - sized down when the crown
      // was a 5.2 m slab and the bird crowded the space a climber lands in.
      // The slab is 9 m now, and at 0.85 the greeter read as a sparrow at the
      // far end of a plaza. 1.5 gives it 3.5 m of wingspan: unmistakably the
      // thing waiting for you, and still clear of where you touch down.
      scale: 1.5,
      solid: true,
      hasColliderMeshes: true,
      clip: 'idle'
    })
  )

  // What the greeter says, hanging over its head and dark until you finish.
  //
  // A character that congratulates you was asked for and half-built: the bird
  // arrived, the congratulation never did, so it stood at the summit in
  // silence like scenery. One TextShape, hidden on the same VisibilityComponent
  // the route signs use, switched on by the client the moment a run completes.
  const greeting = engine.addEntity()
  Transform.create(greeting, {
    position: Vector3.create(
      pad.x + dirX * (half - 0.3),
      deck + 3.5,
      pad.z + dirZ * (half - 0.3)
    )
  })
  TextShape.create(greeting, {
    text: 'YOU MADE IT TO THE TOP',
    fontSize: 3.4,
    textColor: FINISH_ALBEDO,
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(greeting, { billboardMode: BillboardMode.BM_Y })
  VisibilityComponent.create(greeting, { visible: false })
  made.push(greeting)
  greeterLine = greeting

  return made
}
