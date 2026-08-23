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
  cliff: 'assets/Models/cliff-a.glb',
  rockTall: 'assets/Models/rock-tall.glb',
  crystalSafe: 'assets/Models/crystal-teal.glb',
  crystalUnstable: 'assets/Models/crystal-orange.glb',
  shard: 'assets/Models/stone-shard.glb',
  /**
   * The forest edge. Audited before placing: 2 meshes / 2 materials / 1
   * texture, no animation, ships its own `TreeFir_02_collider`, so it goes in
   * with hasColliderMeshes: true and nothing on the visible mesh. 412 tri.
   *
   * Chosen over wm-tree01 for two measured reasons: it is faceted rather than
   * painted, which matches the flat-shaded pads, and it costs 2 material slots
   * per instance instead of 3 - eighteen of the other one put the scene at 516
   * against a 500 hard cap on mobile, which is a scene that does not load.
   *
   * Native bounding box is 270 x 253 x 555 units, so it wants a small scale.
   */
  tree: 'assets/Models/tree-fir-02.glb',
  /** 1 mesh / 1 material / 1 texture, clip "fernidle", no collider meshes. */
  fern: 'assets/Models/fern.glb',
  /**
   * A wooden torch on a tripod, for the clearing. Audited: 2 meshes /
   * 2 materials / 5 textures, no animation, NO collider meshes - so collision
   * goes on the visible mesh or nowhere. 1.43 x 2.51 x 1.53 m at scale 1.
   *
   * Replaces LampPostSciFi_01 beside the board. A chrome sci-fi lamp post in a
   * forest clearing was the loudest single style clash in the scene.
   */
  torch: 'assets/Models/torch.glb',
  /**
   * The greeter at the crown. Audited: 2 meshes / 1 material / 2 textures,
   * an `idle` clip, and it ships a collider mesh (named Dragon_collider in
   * the file, which is somebody else's leftover but is still a collider mesh
   * and has to be treated as one). Origin at its feet, 2.36 x 1.15 x 1.04 m.
   */
  owl: 'assets/Models/owl.glb'
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
