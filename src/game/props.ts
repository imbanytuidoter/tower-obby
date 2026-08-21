import { ColliderLayer, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

/**
 * Real models from the Decentraland Sci-fi asset pack, downloaded into
 * assets/models. They are set dressing only - every surface the player
 * actually stands on stays a primitive, so collision is predictable.
 */
export const MODELS = {
  lampPost: 'assets/models/LampPostSciFi_01/LampPostSciFi_01.glb',
  lightColumn: 'assets/models/Light_02/Light_02.glb',
  floorLight: 'assets/models/Light_04/Light_04.glb',
  column: 'assets/models/Column_01/Column_01.glb',
  neonTube: 'assets/models/NeonLightTube_04/NeonLightTube_04.glb',
  hexFloor: 'assets/models/FloorHexa_01/FloorHexa_01.glb',
  barrier: 'assets/models/Fence_Straight_01/Fence_Straight_01.glb'
} as const

export type PropOptions = {
  position: Vector3
  yaw?: number
  scale?: number | Vector3
  /** Props are decoration by default and must never block a jump. */
  solid?: boolean
}

export function placeProp(src: string, options: PropOptions): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, {
    position: options.position,
    rotation: Quaternion.fromEulerDegrees(0, options.yaw ?? 0, 0),
    scale:
      typeof options.scale === 'number'
        ? Vector3.create(options.scale, options.scale, options.scale)
        : options.scale ?? Vector3.One()
  })

  GltfContainer.create(entity, {
    src,
    visibleMeshesCollisionMask: options.solid ? ColliderLayer.CL_PHYSICS : ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  return entity
}
