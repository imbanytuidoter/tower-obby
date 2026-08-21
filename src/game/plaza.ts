import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  LightSource,
  Material,
  MeshCollider,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
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
  BOARD_SIZE
} from './config'
import { formatTime } from './format'
import { MODELS, placeProp } from './props'

/**
 * The leaderboard is a compact board standing beside the starting pad.
 * It is built as a real table: one entity per column per row, so spacing is
 * exact instead of relying on line breaks inside a single block of text.
 */
const BOARD_W = 5.6
const ROW_H = 0.34
const HEADER_H = 0.85
const BOARD_H = HEADER_H + BOARD_SIZE * ROW_H + 0.5
const BOARD_Y = 3.3

/** Yaw in degrees that turns a board's readable face towards a target point. */
function yawFacing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return (Math.atan2(-(toX - fromX), -(toZ - fromZ)) * 180) / Math.PI
}

/** The board stands at the back of the lobby, facing the start gate. */
const BOARD_X = LOBBY_X - GATE_DIR_X * (LOBBY_SIZE / 2 - 1.2)
const BOARD_Z = LOBBY_Z - GATE_DIR_Z * (LOBBY_SIZE / 2 - 1.2)
const BOARD_YAW = yawFacing(BOARD_X, BOARD_Z, GATE_X, GATE_Z)

/** Unit vector from the board towards whoever is reading it. */
const FRONT_X = -Math.sin((BOARD_YAW * Math.PI) / 180)
const FRONT_Z = -Math.cos((BOARD_YAW * Math.PI) / 180)
/** The reader's right, along the board face. */
const SIDE_X = Math.cos((BOARD_YAW * Math.PI) / 180)
const SIDE_Z = -Math.sin((BOARD_YAW * Math.PI) / 180)

const CYAN3 = Color3.create(0.2, 0.8, 1)
const CYAN4 = Color4.create(0.3, 0.9, 1, 1)
const INK = Color4.create(0.04, 0.05, 0.09, 1)
const DIM = Color4.create(0.62, 0.7, 0.8, 1)
const GOLD4 = Color4.create(1, 0.82, 0.25, 1)

/** Where to point the camera so a player sees the gate they must walk through. */
export const GATE_LOOK = Vector3.create(GATE_X, LOBBY_Y + 2.6, GATE_Z)

type Row = { label: Entity; value: Entity }

let rowEntities: Row[] = []
const markers: Entity[] = []
let spin = 0

export function buildPlaza() {
  createGround()
  createPerimeter()
  createLobby()
  createStartGate()
  createGuideArrows()
  createPracticeHops()
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
    albedoColor: Color4.create(0.12, 0.14, 0.2, 1),
    metallic: 0.6,
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

/** The start gate: two posts, a lintel and a lit line across the ground. */
function createStartGate() {
  const yaw = (Math.atan2(GATE_DIR_X, GATE_DIR_Z) * 180) / Math.PI
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  const acrossX = -GATE_DIR_Z
  const acrossZ = GATE_DIR_X

  for (const direction of [-1, 1]) {
    const post = engine.addEntity()
    Transform.create(post, {
      position: Vector3.create(
        GATE_X + acrossX * direction * (GATE_WIDTH / 2),
        LOBBY_Y + 3.1,
        GATE_Z + acrossZ * direction * (GATE_WIDTH / 2)
      ),
      scale: Vector3.create(0.5, 6.2, 0.5)
    })
    MeshRenderer.setCylinder(post)
    MeshCollider.setCylinder(post)
    Material.setPbrMaterial(post, {
      albedoColor: Color4.create(0.12, 0.14, 0.2, 1),
      metallic: 0.85,
      roughness: 0.3
    })
  }

  const lintel = engine.addEntity()
  Transform.create(lintel, {
    position: Vector3.create(GATE_X, LOBBY_Y + 4.6, GATE_Z),
    rotation,
    scale: Vector3.create(GATE_WIDTH + 1.2, 0.7, 0.5)
  })
  MeshRenderer.setBox(lintel)
  Material.setPbrMaterial(lintel, {
    albedoColor: Color4.create(0.3, 0.95, 0.6, 1),
    emissiveColor: Color3.create(0.2, 0.9, 0.5),
    emissiveIntensity: 3
  })

  // A fixed sign on the lintel. A billboard turns with the camera, so the
  // words drifted away from the gate and read as crooked floating text.
  const signY = LOBBY_Y + 5.5
  const panel = engine.addEntity()
  Transform.create(panel, {
    position: Vector3.create(GATE_X, signY, GATE_Z),
    rotation,
    scale: Vector3.create(6, 1.4, 0.18)
  })
  MeshRenderer.setBox(panel)
  Material.setPbrMaterial(panel, {
    albedoColor: Color4.create(0.05, 0.12, 0.08, 1),
    metallic: 0,
    roughness: 0.95
  })

  const label = engine.addEntity()
  Transform.create(label, {
    position: Vector3.create(GATE_X + GATE_DIR_X * -0.2, signY, GATE_Z + GATE_DIR_Z * -0.2),
    rotation
  })
  TextShape.create(label, {
    text: 'START',
    fontSize: 4.2,
    textColor: Color4.create(0.45, 1, 0.65, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.25,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  const crown = engine.addEntity()
  Transform.create(crown, {
    position: Vector3.create(GATE_X, LOBBY_Y + 6.35, GATE_Z),
    rotation,
    scale: Vector3.create(GATE_WIDTH + 1.6, 0.22, 0.6)
  })
  MeshRenderer.setBox(crown)
  Material.setPbrMaterial(crown, {
    albedoColor: Color4.create(0.4, 1, 0.65, 1),
    emissiveColor: Color3.create(0.3, 1, 0.6),
    emissiveIntensity: 4
  })

  const line = engine.addEntity()
  Transform.create(line, {
    position: Vector3.create(GATE_X, LOBBY_Y + 0.04, GATE_Z),
    rotation,
    scale: Vector3.create(GATE_WIDTH, 0.1, 0.7)
  })
  MeshRenderer.setBox(line)
  Material.setPbrMaterial(line, {
    albedoColor: Color4.create(0.35, 1, 0.6, 1),
    emissiveColor: Color3.create(0.25, 1, 0.55),
    emissiveIntensity: 4
  })
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
function createPracticeHops() {
  const c = curve(0)
  const step = c.jumpGap + c.padSize

  // Off to the side of the walk to the gate, never blocking it.
  const asideX = -GATE_DIR_Z
  const asideZ = GATE_DIR_X

  for (let i = 0; i < 3; i++) {
    const x = GATE_X + asideX * 7 + GATE_DIR_X * (i * step - step)
    const z = GATE_Z + asideZ * 7 + GATE_DIR_Z * (i * step - step)

    const pad = engine.addEntity()
    Transform.create(pad, {
      position: Vector3.create(x, LOBBY_Y + 0.4 + i * 0.5, z),
      scale: Vector3.create(c.padSize, 0.4, c.padSize)
    })
    MeshRenderer.setBox(pad)
    MeshCollider.setBox(pad)
    Material.setPbrMaterial(pad, {
      albedoColor: Color4.create(0.4, 0.46, 0.58, 1),
      emissiveColor: CYAN3,
      emissiveIntensity: 0.3
    })
  }

  const sign = engine.addEntity()
  Transform.create(sign, {
    position: Vector3.create(GATE_X + asideX * 7, LOBBY_Y + 3.4, GATE_Z + asideZ * 7)
  })
  TextShape.create(sign, {
    text: 'TRY A JUMP',
    fontSize: 2.4,
    textColor: CYAN4,
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
  Material.setPbrMaterial(ground, {
    albedoColor: Color4.create(0.06, 0.07, 0.11, 1),
    metallic: 0.3,
    roughness: 0.85
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
    const height = 5 + (i % 3) * 2.5

    const monolith = engine.addEntity()
    Transform.create(monolith, {
      position: Vector3.create(x, height / 2, z),
      rotation: Quaternion.fromEulerDegrees(0, (angle * 180) / Math.PI, 0),
      scale: Vector3.create(1.1, height, 1.1)
    })
    MeshRenderer.setBox(monolith)
    MeshCollider.setBox(monolith)
    Material.setPbrMaterial(monolith, {
      albedoColor: Color4.create(0.1, 0.11, 0.16, 1),
      metallic: 0.7,
      roughness: 0.45
    })

    // A lit cap, clear of the monolith's top face so the two never z-fight.
    const cap = engine.addEntity()
    Transform.create(cap, {
      position: Vector3.create(x, height + 0.16, z),
      rotation: Quaternion.fromEulerDegrees(0, (angle * 180) / Math.PI, 0),
      scale: Vector3.create(1.3, 0.14, 1.3)
    })
    MeshRenderer.setBox(cap)
    Material.setPbrMaterial(cap, {
      albedoColor: CYAN4,
      emissiveColor: CYAN3,
      emissiveIntensity: 2.5
    })
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
    fontSize: 2.8,
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
      fontSize: 1.5,
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
      fontSize: 1.5,
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

  // The scene's single dynamic light belongs on the one thing players read.
  // Aimed down at the deck, not at the board: pointing it at the face put a
  // visible beam across the text and washed the rows out.
  const light = engine.addEntity()
  const lightPos = front(3.2)
  Transform.create(light, {
    position: Vector3.create(lightPos.x, 5.5, lightPos.z),
    rotation: Quaternion.fromEulerDegrees(-80, BOARD_YAW + 180, 0)
  })
  LightSource.create(light, {
    type: LightSource.Type.Spot({ innerAngle: 30, outerAngle: 55 }),
    color: Color3.create(0.8, 0.92, 1),
    intensity: 450,
    shadow: false,
    range: 12
  })
}

export type BoardRow = { name: string; seconds: number }

/**
 * Redraws the monument from the server-owned board. Rows are wins, newest
 * first - a shared record of who closed each round out, not this player's
 * private history.
 */
export function showBoard(entries: BoardRow[]) {
  if (rowEntities.length === 0) return

  for (let i = 0; i < rowEntities.length; i++) {
    const entry = entries[i]
    const label = TextShape.getMutable(rowEntities[i].label)
    const value = TextShape.getMutable(rowEntities[i].value)

    if (!entry) {
      label.text = ''
      value.text = '- - : - -'
      value.textColor = DIM
      continue
    }

    label.text = String(i + 1) + '.  ' + entry.name
    value.text = formatTime(entry.seconds)
    value.textColor = Color4.White()
  }
}

/** Draws the empty board before the server has sent anything. */
export function refreshBoard() {
  showBoard([])
}
