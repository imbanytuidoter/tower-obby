import { engine, Entity, Material, MeshCollider, MeshRenderer, TextAlignMode, TextShape, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

export type PadKind = 'start' | 'normal' | 'checkpoint' | 'finish'

export type Pad = {
  kind: PadKind
  pos: [number, number, number]
  size: [number, number, number]
}

export type SpinnerDef = {
  center: [number, number, number]
  length: number
  /** Degrees per second. Negative spins the other way. */
  speed: number
  /** Starting angle in degrees, to offset paired beams. */
  phase: number
}

export type Spinner = SpinnerDef & { entity: Entity; angle: number }

/**
 * The course climbs anticlockwise around the parcel.
 * Rises are ~0.9m so a normal jump always clears them.
 */
export const COURSE: Pad[] = [
  { kind: 'start', pos: [3, 0.2, 3], size: [4, 0.4, 4] },
  { kind: 'normal', pos: [6.6, 1.0, 3], size: [2.4, 0.4, 2.4] },
  { kind: 'normal', pos: [9.8, 1.9, 3.4], size: [2.2, 0.4, 2.2] },
  { kind: 'normal', pos: [12.8, 2.8, 4.8], size: [2.2, 0.4, 2.2] },
  { kind: 'checkpoint', pos: [13.2, 3.7, 7.8], size: [3, 0.4, 3] },

  { kind: 'normal', pos: [11.5, 4.6, 11.2], size: [5.5, 0.4, 5.5] },
  { kind: 'normal', pos: [8, 5.5, 13.6], size: [2.2, 0.4, 2.2] },
  { kind: 'checkpoint', pos: [5, 6.4, 13.6], size: [3, 0.4, 3] },

  { kind: 'normal', pos: [3.4, 7.3, 11.4], size: [1, 0.3, 3.6] },
  { kind: 'normal', pos: [3.4, 8.2, 7.8], size: [1, 0.3, 3.6] },
  { kind: 'normal', pos: [3.4, 9.1, 5.2], size: [2, 0.4, 2] },
  { kind: 'checkpoint', pos: [5.6, 10.0, 3.2], size: [3, 0.4, 3] },

  { kind: 'normal', pos: [9, 10.9, 3.2], size: [2.2, 0.4, 2.2] },
  { kind: 'normal', pos: [12.4, 11.8, 4.4], size: [2.2, 0.4, 2.2] },

  { kind: 'normal', pos: [12, 12.7, 8], size: [5.5, 0.4, 5.5] },
  { kind: 'normal', pos: [8.6, 13.6, 11], size: [2.2, 0.4, 2.2] },
  { kind: 'checkpoint', pos: [5.4, 14.5, 12.4], size: [3, 0.4, 3] },

  { kind: 'normal', pos: [3.2, 15.4, 9.6], size: [2, 0.4, 2] },
  { kind: 'finish', pos: [3.2, 16.3, 6.4], size: [3.4, 0.4, 3.4] }
]

/** Rotating beams, centred over the two wide arena pads. */
export const SPINNERS: SpinnerDef[] = [
  { center: [11.5, 5.3, 11.2], length: 5.2, speed: 55, phase: 0 },
  { center: [12, 13.4, 8], length: 5.2, speed: -70, phase: 0 },
  { center: [12, 13.4, 8], length: 5.2, speed: -70, phase: 90 }
]

const COLORS: Record<PadKind, { albedo: Color4; emissive: Color3; intensity: number }> = {
  start: { albedo: Color4.create(0.3, 0.9, 0.5, 1), emissive: Color3.create(0.2, 0.8, 0.4), intensity: 1.5 },
  normal: { albedo: Color4.create(0.55, 0.6, 0.72, 1), emissive: Color3.Black(), intensity: 0 },
  checkpoint: { albedo: Color4.create(0.25, 0.85, 1, 1), emissive: Color3.create(0.2, 0.8, 1), intensity: 2.5 },
  finish: { albedo: Color4.create(1, 0.8, 0.25, 1), emissive: Color3.create(1, 0.7, 0.1), intensity: 4 }
}

/** Builds every pad, the ground, the spinners and the goal marker. */
export function buildCourse(): { spinners: Spinner[]; checkpoints: Vector3[]; finish: Vector3 } {
  createGround()

  const checkpoints: Vector3[] = []
  let finish = Vector3.create(3.2, 16.3, 6.4)

  for (const pad of COURSE) {
    createPad(pad)
    const top = Vector3.create(pad.pos[0], pad.pos[1] + pad.size[1] / 2, pad.pos[2])
    if (pad.kind === 'start' || pad.kind === 'checkpoint') checkpoints.push(top)
    if (pad.kind === 'finish') {
      finish = top
      createGoalMarker(pad)
    }
  }

  const spinners = SPINNERS.map(createSpinner)
  return { spinners, checkpoints, finish }
}

function createGround() {
  const ground = engine.addEntity()
  Transform.create(ground, { position: Vector3.create(8, -0.15, 8), scale: Vector3.create(16, 0.3, 16) })
  MeshRenderer.setBox(ground)
  MeshCollider.setBox(ground)
  Material.setPbrMaterial(ground, {
    albedoColor: Color4.create(0.07, 0.07, 0.12, 1),
    metallic: 0.3,
    roughness: 0.8
  })
}

function createPad(pad: Pad) {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(pad.pos[0], pad.pos[1], pad.pos[2]),
    scale: Vector3.create(pad.size[0], pad.size[1], pad.size[2])
  })
  MeshRenderer.setBox(entity)
  MeshCollider.setBox(entity)

  const color = COLORS[pad.kind]
  Material.setPbrMaterial(entity, {
    albedoColor: color.albedo,
    emissiveColor: color.emissive,
    emissiveIntensity: color.intensity,
    metallic: 0.2,
    roughness: 0.6
  })
}

function createSpinner(def: SpinnerDef): Spinner {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(def.center[0], def.center[1], def.center[2]),
    scale: Vector3.create(def.length, 0.45, 0.45),
    rotation: Quaternion.fromEulerDegrees(0, def.phase, 0)
  })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(1, 0.25, 0.3, 1),
    emissiveColor: Color3.create(1, 0.15, 0.2),
    emissiveIntensity: 4
  })
  return { ...def, entity, angle: def.phase }
}

function createGoalMarker(pad: Pad) {
  const pole = engine.addEntity()
  Transform.create(pole, {
    position: Vector3.create(pad.pos[0], pad.pos[1] + 1.1, pad.pos[2]),
    scale: Vector3.create(0.35, 2, 0.35)
  })
  MeshRenderer.setCylinder(pole)
  Material.setPbrMaterial(pole, {
    albedoColor: Color4.create(1, 0.85, 0.3, 1),
    emissiveColor: Color3.create(1, 0.75, 0.15),
    emissiveIntensity: 4
  })

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(pad.pos[0], pad.pos[1] + 2.4, pad.pos[2]) })
  TextShape.create(sign, {
    text: 'FINISH',
    fontSize: 3,
    textColor: Color4.create(1, 0.85, 0.3, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
}
