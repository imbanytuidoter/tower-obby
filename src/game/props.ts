import { Animator, ColliderLayer, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

/**
 * Real models from the Decentraland Sci-fi asset pack, downloaded into
 * assets/models. They are set dressing only - every surface the player
 * actually stands on stays a primitive, so collision is predictable.
 */
/**
 * Every model the scene places, and nothing else.
 *
 * The list had grown to twelve entries while five were being placed: leftovers
 * from the perimeter ring, the sci-fi lamp the torch replaced, and candidates
 * that were downloaded, compared and passed over. Declared-but-unplaced costs
 * nothing at runtime and everything at deploy - the files still upload, and
 * the signing window for a deploy is 300 seconds.
 */
export const MODELS = {
  /**
   * The forest edge. 2 meshes / 2 materials / 1 texture, no animation, ships
   * its own `TreeFir_02_collider`, so it goes in with hasColliderMeshes: true.
   * 5.11 m tall at scale 1, measured out of the file with node rotation
   * applied - the catalog's "555 m" is the raw bbox with the GLB's own 0.01
   * node scale ignored.
   */
  tree: 'assets/Models/tree-fir-02.glb',
  /**
   * A wooden torch on a tripod, beside the board. 2 meshes / 2 materials /
   * 5 textures, NO collider meshes. Its origin sits 2.23 m above its own base,
   * so it buries itself if placed at ground level.
   */
  torch: 'assets/Models/torch.glb',
  /**
   * The greeter at the crown. 2 meshes / 1 material / 2 textures, an `idle`
   * clip, and a collider mesh (named Dragon_collider in the file, which is
   * somebody else's leftover but is still a collider mesh). Origin at its
   * feet, 2.36 m of wingspan.
   */
  owl: 'assets/Models/owl.glb',
  /** Small animated crystals marking safe and unstable ground. 1 mesh each. */
  crystalSafe: 'assets/Models/crystal-teal.glb',
  crystalUnstable: 'assets/Models/crystal-orange.glb'
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
  /**
   * True when the GLB ships its own `_collider` meshes.
   *
   * The two patterns are not interchangeable and must never be mixed: a model
   * WITH collider meshes wants them on the invisible mask and nothing on the
   * visible one, and a model without wants the reverse. The rocks have them
   * and the obelisks do not, which is only knowable by opening the files -
   * so both were opened.
   */
  hasColliderMeshes?: boolean
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

  const solid = options.solid ?? false
  GltfContainer.create(entity, {
    src,
    visibleMeshesCollisionMask:
      options.hasColliderMeshes || !solid ? ColliderLayer.CL_NONE : ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask:
      options.hasColliderMeshes && solid ? ColliderLayer.CL_PHYSICS : ColliderLayer.CL_NONE
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
