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
  Transform,
  SkyboxTime
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CHOICE_EDGE, CHOICE_EDGE_3, SAFE_FILL } from './build'
import {
  CENTER_X,
  CENTER_Z,
  curve,
  GATE_DIR_X,
  GATE_DIR_Z,
  GATE_WIDTH,
  GATE_X,
  GATE_Z,
  LOBBY_SIZE,
  LOBBY_X,
  LOBBY_Y,
  LOBBY_Z,
  GROUND_SIZE,
  START_PAD_X,
  START_PAD_Z,
  BOARD_SIZE,
  BOARD_FORWARD,
  FOREST,
  MAX_PAD_HEIGHT,
  RANKING_SIZE,
  REACH_ABILITY,
  SKYBOX_TIME,
  BOARD_LATERAL,
  LOBBY_SPAWN_X,
  LOBBY_SPAWN_Z
} from './config'
import { formatTime } from './format'
import { MODELS, placeProp } from './props'

/**
 * The leaderboard is a compact board standing beside the starting pad.
 * It is built as a real table: one entity per column per row, so spacing is
 * exact instead of relying on line breaks inside a single block of text.
 */
const BOARD_W = 5.6
const ROW_H = 0.44
const HEADER_H = 1.05
const BOARD_H = HEADER_H + BOARD_SIZE * ROW_H + 0.5
const BOARD_Y = 3.3

/** Yaw in degrees that turns a board's readable face towards a target point. */
function yawFacing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return (Math.atan2(-(toX - fromX), -(toZ - fromZ)) * 180) / Math.PI
}

/**
 * The board stands to one SIDE of the lobby, angled at whoever just arrived.
 *
 * It used to sit at the back, facing the gate - which put it exactly 180
 * degrees behind a player at the spawn, 11 m away, at the one moment they are
 * standing still. The social centrepiece of the scene was the one thing you
 * could not see without turning round first, and most people never did.
 *
 * Off to the side it stays out of the sightline to the tower while sitting
 * inside peripheral vision, so it is read with a glance rather than a
 * pirouette. Measured angle from the arrival gaze is asserted below.
 */
const SIDE_OF_GATE_X = -GATE_DIR_Z
const SIDE_OF_GATE_Z = GATE_DIR_X

const BOARD_X = LOBBY_X + GATE_DIR_X * BOARD_FORWARD + SIDE_OF_GATE_X * BOARD_LATERAL
const BOARD_Z = LOBBY_Z + GATE_DIR_Z * BOARD_FORWARD + SIDE_OF_GATE_Z * BOARD_LATERAL
const BOARD_YAW = yawFacing(BOARD_X, BOARD_Z, LOBBY_SPAWN_X, LOBBY_SPAWN_Z)

/** Unit vector from the board towards whoever is reading it. */
const FRONT_X = -Math.sin((BOARD_YAW * Math.PI) / 180)
const FRONT_Z = -Math.cos((BOARD_YAW * Math.PI) / 180)
/** The reader's right, along the board face. */
const SIDE_X = Math.cos((BOARD_YAW * Math.PI) / 180)
const SIDE_Z = -Math.sin((BOARD_YAW * Math.PI) / 180)

const CYAN3 = Color3.create(0.2, 0.8, 1)
const CYAN4 = Color4.create(0.3, 0.9, 1, 1)
// The board face. Near-black read as an unfinished slab rather than as a
// screen; this is dark enough for white rows to carry and light enough to
// look like an object somebody built.
const INK = Color4.create(0.13, 0.16, 0.24, 1)
const DIM = Color4.create(0.62, 0.7, 0.8, 1)
const GOLD4 = Color4.create(1, 0.82, 0.25, 1)

/** Where to point the camera so a player sees the gate they must walk through. */
/**
 * The progress rail: the tower's height, shrunk to something you can stand in
 * front of, with a light on it for every climber currently up there.
 *
 * The live ranking already existed as three lines of HUD text, which is a
 * private thing each player reads alone. This is the same information as an
 * object in the yard: two people waiting can look at it together, point at it,
 * and watch a light climb. The design brief's complaint about the lobby is
 * that people cross it and leave - this gives them a reason to stop, and the
 * thing they stop to watch is each other.
 */
const RAIL_HEIGHT = 7.5
let railMarkers: Entity[] = []

function createProgressRail() {
  // Forward of the board and off to one side, on open deck.
  //
  // It used to sit at BOARD_W/2 + 0.75 along the side axis, which is where the
  // gold marker post already stands at BOARD_W/2 + 0.7 - five centimetres
  // apart, so the rail was drawn straight through it. The lamp is at +1.9 on
  // the same axis, so that whole line is taken. Arithmetic found this; looking
  // at it had not, across several screenshots.
  // Offsets found by searching the deck for a spot clear of the board, both
  // marker posts, both lamps, the gate posts and the doorway itself - rather
  // than by picking a number and looking at it, which is how the rail ended up
  // inside a marker post the first time and inside the gate the second.
  const x = BOARD_X + FRONT_X * 3.2 - SIDE_X * 2.4
  const z = BOARD_Z + FRONT_Z * 3.2 - SIDE_Z * 2.4

  const rail = engine.addEntity()
  Transform.create(rail, {
    position: Vector3.create(x, RAIL_HEIGHT / 2 + 0.4, z),
    scale: Vector3.create(0.4, RAIL_HEIGHT, 0.4)
  })
  MeshRenderer.setBox(rail)
  Material.setPbrMaterial(rail, {
    albedoColor: Color4.create(0.3, 0.34, 0.42, 1),
    roughness: 0.9
  })

  label(x, RAIL_HEIGHT + 1.4, z, 'ON THE TOWER NOW', CYAN4, 1.8)

  // One marker per ranked climber. Parked below the floor until the server
  // says somebody is up there.
  railMarkers = []
  for (let i = 0; i < RANKING_SIZE; i++) {
    const marker = engine.addEntity()
    Transform.create(marker, {
      position: Vector3.create(x, -20, z),
      scale: Vector3.create(1.35, 0.3, 1.35)
    })
    MeshRenderer.setBox(marker)
    Material.setPbrMaterial(marker, {
      albedoColor: i === 0 ? GOLD4 : CYAN4,
      emissiveColor: i === 0 ? Color3.create(1, 0.75, 0.2) : CYAN3,
      emissiveIntensity: 2.5
    })
    railMarkers.push(marker)
  }
}

/** Places a light per climber at their share of the tower's height. */
export function showClimbers(heights: number[]) {
  for (let i = 0; i < railMarkers.length; i++) {
    const transform = Transform.getMutableOrNull(railMarkers[i])
    if (!transform) continue
    const height = heights[i]
    transform.position.y =
      height === undefined
        ? -20
        : 0.4 + Math.min(1, Math.max(0, height / MAX_PAD_HEIGHT)) * RAIL_HEIGHT
  }
}

/** The tower record line on the gate, rewritten when the server sends one. */
let recordSign: Entity | null = null

/** Called from the client when the all-time board arrives. */
export function showTowerRecord(name: string, seconds: number) {
  if (!recordSign) return
  const shape = TextShape.getMutableOrNull(recordSign)
  if (!shape) return
  shape.text =
    seconds > 0 ? 'TOWER RECORD  ' + formatTime(seconds) + '  -  ' + name : 'NO RECORD YET  -  SET IT'
}

export const GATE_LOOK = Vector3.create(GATE_X, LOBBY_Y + 2.6, GATE_Z)

type Row = { label: Entity; value: Entity }

let rowEntities: Row[] = []
const markers: Entity[] = []
let spin = 0

export function buildPlaza(opening: Opening) {
  // Pin the time of day.
  //
  // The scene was rendering at whatever hour the client happened to be on,
  // and on a sunset sky every surface goes dark no matter what albedo it
  // carries - the platforms, the ground and the core all read as near-black
  // silhouettes. worldConfiguration.skyboxConfig is not applied in local
  // preview, so the fix has to be the runtime component.
  //
  // SkyboxTime, fixedTime in seconds since midnight. Confirmed against the
  // installed @dcl/ecs typings (components/generated/SkyboxTime.gen.d.ts).
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: SKYBOX_TIME })

  createGround()
  createProgressRail()
  createPerimeter()
  createLobby()
  createStartGate()
  createGuideArrows()
  createPracticeHops(opening)
  createBoard()
  createDressing()
  refreshBoard()
}

/** The lobby: a raised deck you spawn on, with the board and the start gate. */
function createLobby() {
  const deck = engine.addEntity()
  Transform.create(deck, {
    position: Vector3.create(LOBBY_X, LOBBY_Y - 0.15, LOBBY_Z),
    scale: Vector3.create(LOBBY_SIZE, 0.3, LOBBY_SIZE)
  })
  MeshRenderer.setBox(deck)
  MeshCollider.setBox(deck)
  Material.setPbrMaterial(deck, {
    // Mown short at the start line: the deck is a lighter, tidier patch of
    // the same clearing rather than a slab dropped onto it.
    albedoColor: Color4.create(0.55, 0.6, 0.46, 1),
    metallic: 0.1,
    roughness: 0.5
  })

  // A glowing rim, one thin slab per edge, each clear of the deck surface.
  for (const axis of [0, 1]) {
    for (const direction of [-1, 1]) {
      const rim = engine.addEntity()
      const offset = (LOBBY_SIZE / 2) * direction
      Transform.create(rim, {
        position: Vector3.create(
          LOBBY_X + (axis === 0 ? offset : 0),
          LOBBY_Y + 0.03,
          LOBBY_Z + (axis === 1 ? offset : 0)
        ),
        scale: Vector3.create(axis === 0 ? 0.22 : LOBBY_SIZE, 0.06, axis === 1 ? 0.22 : LOBBY_SIZE)
      })
      MeshRenderer.setBox(rim)
      Material.setPbrMaterial(rim, {
        albedoColor: CYAN4,
        emissiveColor: CYAN3,
        emissiveIntensity: 2.5
      })
    }
  }
}

/**
 * The threshold.
 *
 * This was two bare cylinders and a green bar, and it looked like it: nothing
 * about it said "a thing somebody built". It is stone now - the same warm
 * stone as the tower's core, so the gate and the thing it leads to read as one
 * material - with tapered pylons standing on splayed footings, a deep lintel,
 * and the safe colour used as light rather than as paint.
 *
 * Cyan means safe in this game, and crossing this line is the safest moment in
 * it, so the light belongs here: recessed strips down the inner face of each
 * pylon frame the opening, and a strip across the ground marks the line the
 * clock starts on.
 */
function createStartGate() {
  const yaw = (Math.atan2(GATE_DIR_X, GATE_DIR_Z) * 180) / Math.PI
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  const acrossX = -GATE_DIR_Z
  const acrossZ = GATE_DIR_X
  const half = GATE_WIDTH / 2

  const STONE = Color4.create(0.63, 0.6, 0.55, 1)
  const STONE_DARK = Color4.create(0.42, 0.4, 0.38, 1)

  const at = (side: number, up: number, out = 0) =>
    Vector3.create(
      GATE_X + acrossX * side + GATE_DIR_X * out,
      LOBBY_Y + up,
      GATE_Z + acrossZ * side + GATE_DIR_Z * out
    )

  const block = (position: Vector3, scale: Vector3, colour: Color4, rot = rotation) => {
    const e = engine.addEntity()
    Transform.create(e, { position, rotation: rot, scale })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: colour, roughness: 0.85 })
    return e
  }

  const light = (position: Vector3, scale: Vector3) => {
    const e = engine.addEntity()
    Transform.create(e, { position, rotation, scale })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, {
      albedoColor: SAFE_FILL,
      emissiveColor: CYAN3,
      emissiveIntensity: 3.2
    })
    return e
  }

  for (const direction of [-1, 1]) {
    const side = direction * half

    // Splayed footing, so the pylon looks like it carries weight.
    block(at(side, 0.35), Vector3.create(1.9, 0.7, 1.9), STONE_DARK)
    block(at(side, 0.95), Vector3.create(1.5, 0.6, 1.5), STONE)

    // Tapered pylon: two stacked blocks read as a taper without a cone.
    const shaft = engine.addEntity()
    Transform.create(shaft, {
      position: at(side, 3.1),
      rotation,
      scale: Vector3.create(1.15, 4.1, 1.15)
    })
    MeshRenderer.setCylinder(shaft, 0.5, 0.34)
    MeshCollider.setBox(shaft)
    Material.setPbrMaterial(shaft, { albedoColor: STONE, roughness: 0.85 })

    // Capital under the lintel.
    block(at(side, 5.35), Vector3.create(1.35, 0.45, 1.35), STONE_DARK)

    // The light that frames the opening, on the inner face only.
    light(at(side - direction * 0.62, 3.1), Vector3.create(0.12, 3.6, 0.5))
  }

  // Lintel: deep, with a darker soffit under it so it casts its own line.
  block(at(0, 5.95), Vector3.create(GATE_WIDTH + 2.6, 0.9, 1.2), STONE)
  block(at(0, 5.42), Vector3.create(GATE_WIDTH + 1.9, 0.22, 0.95), STONE_DARK)
  light(at(0, 5.28, 0.5), Vector3.create(GATE_WIDTH + 1.4, 0.1, 0.12))

  // The name, cut into a recessed panel rather than floated on a black slab.
  // TextShape sits higher than its anchor suggests - measured against the
  // lintel rather than assumed, the label needed dropping by about 0.7 to
  // land on the panel cut for it instead of floating above the stone.
  const signY = LOBBY_Y + 5.35
  block(at(0, 5.95, -0.62), Vector3.create(GATE_WIDTH + 0.4, 0.62, 0.1), STONE_DARK)

  const label = engine.addEntity()
  Transform.create(label, { position: at(0, signY, -0.72), rotation })
  TextShape.create(label, {
    text: 'START',
    fontSize: 4,
    textColor: CYAN4,
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  /**
   * The number to beat, on the gate you beat it through. The all-time board
   * was computed, persisted and synced for days and displayed nowhere.
   */
  recordSign = engine.addEntity()
  Transform.create(recordSign, { position: at(0, LOBBY_Y + 4.05, -0.72), rotation })
  TextShape.create(recordSign, {
    text: 'NO RECORD YET  -  SET IT',
    fontSize: 2,
    textColor: GOLD4,
    outlineColor: Color4.Black(),
    outlineWidth: 0.3,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  // The line the clock starts on.
  light(at(0, 0.06), Vector3.create(GATE_WIDTH, 0.08, 0.55))
}


/**
 * Three pads beside the gate at exactly round one's spacing.
 *
 * A thumb on a virtual joystick has to learn the jump somewhere, and learning
 * it mid-race costs the run. These are the same gap the first round opens with,
 * so what the player finds out here transfers directly. They also give people
 * something to do in the lobby between rounds, which is the only place anyone
 * is ever standing still together.
 */
/**
 * The warm-up pad: the race's own first jump, at ground level.
 *
 * It used to be three pads sized from curve(0) - close to the opening gap but
 * not it, and signed "TRY A JUMP" with no number on it at all. The design pass
 * is specific: the exact gap the race opens with, with the ground underneath,
 * labelled in metres and as a share of what the jump allows.
 *
 * Failing here costs nothing, so the first real jump of a run is never a
 * player's first attempt at it. That is the entire tutorial - no modal, no
 * card, no HUD line spent.
 */
/**
 * The opening jump, measured from the tower and handed in.
 *
 * plaza.ts must not call buildTower() itself. esbuild wraps layout.ts in a
 * lazy __esm initializer - the scene uses a dynamic import for the server
 * branch, which forces that scheme - so a call from here runs before the
 * initializer does and throws "buildTower is not defined" at runtime while
 * type-checking perfectly. Caught in the client console, which is the only
 * place it appears.
 */
export type Opening = { gap: number; size: number }

function createPracticeHops(opening: Opening) {
  const gap = Math.max(1, opening.gap)
  const size = opening.size
  const share = Math.round((gap / REACH_ABILITY) * 100)

  // Opposite side of the walk from the leaderboard: the two things a new
  // arrival reads should not be stacked on top of each other.
  const asideX = GATE_DIR_Z
  const asideZ = -GATE_DIR_X
  const originX = GATE_X + asideX * 8.5 - GATE_DIR_X * 2
  const originZ = GATE_Z + asideZ * 8.5 - GATE_DIR_Z * 2
  const step = gap + size

  // Two pads, one gap: the jump the tower opens with and nothing else.
  for (let i = 0; i < 2; i++) {
    const x = originX + GATE_DIR_X * (i * step - step / 2)
    const z = originZ + GATE_DIR_Z * (i * step - step / 2)

    const pad = engine.addEntity()
    Transform.create(pad, {
      position: Vector3.create(x, LOBBY_Y + 0.45, z),
      scale: Vector3.create(size, 0.5, size)
    })
    MeshRenderer.setBox(pad)
    MeshCollider.setBox(pad)
    Material.setPbrMaterial(pad, {
      albedoColor: SAFE_FILL,
      emissiveColor: CYAN3,
      emissiveIntensity: 0.9,
      roughness: 0.75
    })
  }

  // The span itself, drawn on the ground in the choice colour. This is the
  // 70% rule made visible - it teaches the budget without a word of HUD.
  const span = engine.addEntity()
  Transform.create(span, {
    position: Vector3.create(originX, LOBBY_Y + 0.12, originZ),
    rotation: Quaternion.fromEulerDegrees(0, -yawFacing(originX, originZ, originX + GATE_DIR_X, originZ + GATE_DIR_Z), 0),
    scale: Vector3.create(0.18, 0.04, gap)
  })
  MeshRenderer.setBox(span)
  Material.setPbrMaterial(span, {
    albedoColor: CHOICE_EDGE,
    emissiveColor: CHOICE_EDGE_3,
    emissiveIntensity: 1.6
  })

  // TextShape height scales with fontSize, so the gaps have to scale with it
  // too - at 0.7 m apart these three lines were drawn through each other.
  label(originX, LOBBY_Y + 5.2, originZ, 'FREE PRACTICE', CYAN4, 2.4)
  label(
    originX,
    LOBBY_Y + 3.9,
    originZ,
    gap.toFixed(1) + ' m  -  ' + share + '% OF YOUR JUMP',
    CHOICE_EDGE,
    1.8
  )
  label(originX, LOBBY_Y + 3.0, originZ, 'THE RACE OPENS WITH THIS JUMP', DIM, 1.4)
}

/** A billboarded line of text standing in the world. */
function label(x: number, y: number, z: number, text: string, colour: Color4, fontSize: number) {
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(x, y, z) })
  TextShape.create(sign, {
    text,
    fontSize,
    textColor: colour,
    outlineColor: Color4.Black(),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
}


/**
 * Chevrons on the deck pointing at the gate. Wordless on purpose: on a phone
 * nobody reads a briefing, and an arrow works in every language.
 */
function createGuideArrows() {
  const yaw = (Math.atan2(GATE_DIR_X, GATE_DIR_Z) * 180) / Math.PI

  for (let i = 0; i < 3; i++) {
    const back = 5.5 - i * 1.8
    const x = GATE_X - GATE_DIR_X * back
    const z = GATE_Z - GATE_DIR_Z * back

    // Two bars meeting at a point: a chevron, built from what we have.
    for (const side of [-1, 1]) {
      const bar = engine.addEntity()
      Transform.create(bar, {
        position: Vector3.create(x, LOBBY_Y + 0.04, z),
        rotation: Quaternion.fromEulerDegrees(0, yaw + side * 45, 0),
        scale: Vector3.create(1.5, 0.05, 0.28)
      })
      MeshRenderer.setBox(bar)
      Material.setPbrMaterial(bar, {
        albedoColor: Color4.create(0.35, 1, 0.6, 1),
        emissiveColor: Color3.create(0.25, 1, 0.55),
        // Brighter the closer they get to the gate.
        emissiveIntensity: 1.2 + i * 0.9
      })
    }
  }
}

/** Slowly turns the two markers flanking the board. */
export function decorSystem(dt: number) {
  spin = (spin + dt * 22) % 360
  for (let i = 0; i < markers.length; i++) {
    Transform.getMutable(markers[i]).rotation = Quaternion.fromEulerDegrees(0, spin + i * 180, 0)
  }
}

function createGround() {
  const ground = engine.addEntity()
  Transform.create(ground, {
    position: Vector3.create(CENTER_X, -0.15, CENTER_Z),
    scale: Vector3.create(GROUND_SIZE, 0.3, GROUND_SIZE)
  })
  MeshRenderer.setBox(ground)
  MeshCollider.setBox(ground)
  // Near-black read as a hole cut in the world from any distance, and made
  // the whole scene look unlit. A mid slate reads as a floor, and gives the
  // pale slabs something to sit against.
  Material.setPbrMaterial(ground, {
    texture: Material.Texture.Common({ src: 'images/textures/ground.png' }),
    // The clearing floor. Grass from the forest ramp, inside the 20%
    // saturation rule like every other decorative surface.
    albedoColor: Color4.fromHexString(FOREST.grass),
    metallic: 0.05,
    roughness: 0.95
  })
}

/**
 * A ring of monoliths near the edge of the ground plate. With the Genesis City
 * landscape switched off there is nothing around the scene, and an empty plate
 * under an empty sky reads as a bug. These give the space a boundary without
 * putting anything near the course.
 */
function createPerimeter() {
  const count = 16
  const radius = GROUND_SIZE / 2 - 5

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const x = CENTER_X + Math.cos(angle) * radius
    const z = CENTER_Z + Math.sin(angle) * radius

    // Obelisks from the catalog rather than stretched boxes. Native size is
    // 2 x 4 x 2 m and it has no _collider meshes, so collision goes on the
    // visible mesh; the ring alternates height to break the rhythm.
    const scale = 0.9 + (i % 3) * 0.45
    placeProp(MODELS.obelisk, {
      position: Vector3.create(x, 0, z),
      yaw: (angle * 180) / Math.PI + 90,
      scale: Vector3.create(scale, scale, scale),
      solid: true
    })

    // A shard leaning at its foot, so the boundary reads as weathered rather
    // than as sixteen identical markers.
    if (i % 2 === 0) {
      const lean = angle + 0.9
      placeProp(MODELS.shard, {
        position: Vector3.create(x + Math.cos(lean) * 1.9, 0, z + Math.sin(lean) * 1.9),
        yaw: (lean * 180) / Math.PI,
        scale: 1.6
      })
    }
  }
}

/** A point pushed off the board face towards the reader. */
function front(distance: number): { x: number; z: number } {
  return { x: BOARD_X + FRONT_X * distance, z: BOARD_Z + FRONT_Z * distance }
}

/** An offset along the board face, positive to the reader's right. */
function side(distance: number): { x: number; z: number } {
  return { x: SIDE_X * distance, z: SIDE_Z * distance }
}

function createBoard() {
  const rotation = Quaternion.fromEulerDegrees(0, BOARD_YAW, 0)

  // Every layer is pushed clear of the one behind it. Two surfaces sharing a
  // plane z-fight and flicker, which is what made the old board look broken.
  const backing = engine.addEntity()
  const back = front(-0.07)
  Transform.create(backing, {
    position: Vector3.create(back.x, BOARD_Y, back.z),
    rotation,
    scale: Vector3.create(BOARD_W + 0.22, BOARD_H + 0.22, 0.06)
  })
  MeshRenderer.setBox(backing)
  Material.setPbrMaterial(backing, {
    albedoColor: CYAN4,
    emissiveColor: CYAN3,
    emissiveIntensity: 2.5
  })

  const face = engine.addEntity()
  Transform.create(face, {
    position: Vector3.create(BOARD_X, BOARD_Y, BOARD_Z),
    rotation,
    scale: Vector3.create(BOARD_W, BOARD_H, 0.14)
  })
  MeshRenderer.setBox(face)
  MeshCollider.setBox(face)
  // Matte on purpose: at metallic 0.5 the face mirrored the sky and the tower,
  // smearing a bright blur straight across the rows.
  Material.setPbrMaterial(face, {
    albedoColor: INK,
    metallic: 0,
    roughness: 0.95
  })

  const headerY = BOARD_Y + BOARD_H / 2 - HEADER_H / 2 - 0.12
  const headerPos = front(0.09)
  const headerBar = engine.addEntity()
  Transform.create(headerBar, {
    position: Vector3.create(headerPos.x, headerY, headerPos.z),
    rotation,
    scale: Vector3.create(BOARD_W - 0.3, HEADER_H, 0.04)
  })
  MeshRenderer.setBox(headerBar)
  Material.setPbrMaterial(headerBar, {
    albedoColor: Color4.create(0.05, 0.1, 0.16, 1),
    emissiveColor: Color3.create(0.03, 0.16, 0.26),
    emissiveIntensity: 1,
    metallic: 0,
    roughness: 0.95
  })

  const heading = engine.addEntity()
  const headingPos = front(0.17)
  Transform.create(heading, { position: Vector3.create(headingPos.x, headerY, headingPos.z), rotation })
  TextShape.create(heading, {
    text: "TODAY'S FASTEST",
    fontSize: 3.6,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  rowEntities = []
  const firstRowY = headerY - HEADER_H / 2 - ROW_H * 0.7
  const textPos = front(0.17)
  const stripePos = front(0.1)

  for (let i = 0; i < BOARD_SIZE; i++) {
    const y = firstRowY - i * ROW_H

    if (i % 2 === 0) {
      const stripe = engine.addEntity()
      Transform.create(stripe, {
        position: Vector3.create(stripePos.x, y, stripePos.z),
        rotation,
        scale: Vector3.create(BOARD_W - 0.3, ROW_H * 0.9, 0.03)
      })
      MeshRenderer.setBox(stripe)
      Material.setPbrMaterial(stripe, { albedoColor: Color4.create(1, 1, 1, 0.05) })
    }

    const left = side(-(BOARD_W / 2 - 0.35))
    const label = engine.addEntity()
    Transform.create(label, {
      position: Vector3.create(textPos.x + left.x, y, textPos.z + left.z),
      rotation
    })
    TextShape.create(label, {
      text: '',
      fontSize: 2,
      textColor: DIM,
      outlineColor: Color4.Black(),
      outlineWidth: 0.15,
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT
    })

    const right = side(BOARD_W / 2 - 0.35)
    const value = engine.addEntity()
    Transform.create(value, {
      position: Vector3.create(textPos.x + right.x, y, textPos.z + right.z),
      rotation
    })
    TextShape.create(value, {
      text: '',
      fontSize: 2,
      textColor: Color4.White(),
      outlineColor: Color4.Black(),
      outlineWidth: 0.15,
      textAlign: TextAlignMode.TAM_MIDDLE_RIGHT
    })

    rowEntities.push({ label, value })
  }
}

/** Two posts, a base plate, two lamps. Nothing more. */
function createDressing() {
  const rotation = Quaternion.fromEulerDegrees(0, BOARD_YAW, 0)
  const legHeight = BOARD_Y - BOARD_H / 2

  for (const direction of [-1, 1]) {
    const offset = side(direction * (BOARD_W / 2 - 0.5))

    const post = engine.addEntity()
    Transform.create(post, {
      position: Vector3.create(BOARD_X + offset.x, legHeight / 2, BOARD_Z + offset.z),
      scale: Vector3.create(0.22, legHeight, 0.22)
    })
    MeshRenderer.setCylinder(post)
    MeshCollider.setCylinder(post)
    Material.setPbrMaterial(post, {
      albedoColor: Color4.create(0.12, 0.13, 0.18, 1),
      metallic: 0.85,
      roughness: 0.3
    })

    const marker = engine.addEntity()
    const markerOffset = side(direction * (BOARD_W / 2 + 0.7))
    Transform.create(marker, {
      position: Vector3.create(BOARD_X + markerOffset.x, 0.85, BOARD_Z + markerOffset.z),
      scale: Vector3.create(0.26, 1.3, 0.26)
    })
    MeshRenderer.setBox(marker)
    Material.setPbrMaterial(marker, {
      albedoColor: GOLD4,
      emissiveColor: Color3.create(1, 0.72, 0.18),
      emissiveIntensity: 4
    })
    markers.push(marker)

    const lampOffset = side(direction * (BOARD_W / 2 + 1.9))
    placeProp(MODELS.lampPost, {
      position: Vector3.create(BOARD_X + lampOffset.x, 0.06, BOARD_Z + lampOffset.z),
      yaw: BOARD_YAW,
      scale: 1.4
    })
  }

  const plate = front(0.7)
  const base = engine.addEntity()
  Transform.create(base, {
    position: Vector3.create(plate.x, 0.05, plate.z),
    rotation,
    scale: Vector3.create(BOARD_W + 2.6, 0.1, 3.4)
  })
  MeshRenderer.setBox(base)
  MeshCollider.setBox(base)
  Material.setPbrMaterial(base, {
    albedoColor: Color4.create(0.1, 0.12, 0.17, 1),
    metallic: 0.7,
    roughness: 0.4
  })

  const trimPos = front(2.35)
  const trim = engine.addEntity()
  Transform.create(trim, {
    position: Vector3.create(trimPos.x, 0.13, trimPos.z),
    rotation,
    scale: Vector3.create(BOARD_W + 2.6, 0.06, 0.12)
  })
  MeshRenderer.setBox(trim)
  Material.setPbrMaterial(trim, {
    albedoColor: CYAN4,
    emissiveColor: CYAN3,
    emissiveIntensity: 3
  })

  // A pool of light under the board, built from emissive geometry rather than
  // a LightSource.
  //
  // Dynamic lights are not available on mobile, and mobile is the platform
  // this scene is judged on. A spot light here meant the board sat in a lit
  // pool on desktop and in flat shade on a phone - the two platforms did not
  // look like the same place, and the one that mattered got the worse version.
  // Emissive geometry renders identically on both.
  const pool = engine.addEntity()
  const poolPos = front(2.6)
  Transform.create(pool, {
    position: Vector3.create(poolPos.x, 0.08, poolPos.z),
    rotation: Quaternion.fromEulerDegrees(0, BOARD_YAW, 0),
    scale: Vector3.create(BOARD_W * 1.15, 0.05, 5.2)
  })
  MeshRenderer.setBox(pool)
  Material.setPbrMaterial(pool, {
    albedoColor: Color4.create(0.62, 0.78, 0.9, 1),
    emissiveColor: Color3.create(0.4, 0.62, 0.8),
    emissiveIntensity: 0.9,
    roughness: 0.6
  })
}

export type BoardRow = { name: string; seconds: number }

/**
 * Redraws the monument from the server-owned board. Rows are wins, newest
 * first - a shared record of who closed each round out, not this player's
 * private history.
 */
/** Rows given to the solo half of the board before the pair half starts. */
const SOLO_ROWS = 5

export function showBoard(solo: BoardRow[], together: BoardRow[]) {
  if (rowEntities.length === 0) return

  for (let i = 0; i < rowEntities.length; i++) {
    const label = TextShape.getMutable(rowEntities[i].label)
    const value = TextShape.getMutable(rowEntities[i].value)

    // The divider is the point of this board: it is the only place a player
    // is told that climbing with somebody is a separate, recorded thing.
    if (i === SOLO_ROWS) {
      label.text = 'CLIMBED TOGETHER'
      label.textColor = GOLD4
      value.text = ''
      continue
    }

    const pair = i > SOLO_ROWS
    const rank = pair ? i - SOLO_ROWS : i + 1
    const entry = pair ? together[rank - 1] : solo[i]

    if (!entry) {
      label.text = ''
      label.textColor = DIM
      value.text = '- - : - -'
      value.textColor = DIM
      continue
    }

    label.text = String(rank) + '.  ' + entry.name
    label.textColor = pair ? GOLD4 : DIM
    value.text = formatTime(entry.seconds)
    value.textColor = pair ? GOLD4 : Color4.White()
  }
}

/** Draws the empty board before the server has sent anything. */
export function refreshBoard() {
  showBoard([], [])
}
