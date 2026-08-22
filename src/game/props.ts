import { Animator, ColliderLayer, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

/**
 * Real models from the Decentraland Sci-fi asset pack, downloaded into
 * assets/models. They are set dressing only - every surface the player
 * actually stands on stays a primitive, so collision is predictable.
 */
export const MODELS = {
  lampPost: 'assets/models/LampPostSciFi_01/LampPostSciFi_01.glb',
  /**
   * From the OpenDCL catalog, chosen to fit the stone the gates are built
   * from rather than to fill space. Audited before placing, as the skill
   * requires: obelisk 2 x 4 x 2 m / 46 tri, crystals ~1.6-2 m / 15 tri each
   * and animated, shard 0.07 x 0.86 x 1.26 m / 24 tri. None of them contains
   * _collider meshes, so collision is set on the visible mesh or left off.
   */
  obelisk: 'assets/Models/obelisk.glb',
  crystalSafe: 'assets/Models/crystal-teal.glb',
  crystalUnstable: 'assets/Models/crystal-orange.glb',
  shard: 'assets/Models/stone-shard.glb'
} as const

/** Clip names read out of the GLBs, not guessed. */
export const CLIPS = {
  crystalSafe: 'Crystals TealAction',
  crystalUnstable: 'Crystals OrangeAction'
} as const

export type PropOptions = {
  position: Vector3
  yaw?: number
  scale?: number | Vector3
  /** Props are decoration by default and must never block a jump. */
  solid?: boolean
  /** Clip to loop, for the models that ship with one. */
  clip?: string
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

  // A GLB with animations loops its first clip forever whether or not anyone
  // asked, so the ones that have clips get an Animator that says which.
  if (options.clip) {
    Animator.create(entity, {
      states: [{ clip: options.clip, playing: true, loop: true }]
    })
  }

  return entity
}
