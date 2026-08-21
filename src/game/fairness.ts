import { AvatarLocomotionSettings, engine, InputModifier } from '@dcl/sdk/ecs'

/**
 * This is a race, so everyone has to move identically.
 *
 * Wearables can carry locomotion overrides, which in a timed climb is a
 * straight advantage. Writing the engine defaults explicitly pins every player
 * to the same physics rather than trusting whatever they walked in wearing.
 * Values are the documented engine defaults.
 */
export const LOCOMOTION = {
  walkSpeed: 1.5,
  jogSpeed: 8,
  runSpeed: 10,
  jumpHeight: 1,
  runJumpHeight: 1.5,
  doubleJumpHeight: 2,
  hardLandingCooldown: 0.75
} as const

/**
 * Both of these trivialise a tower: the glider turns a climb into a flight
 * straight to the finish pad, and a double jump makes every gap in the course
 * roughly half as wide as it was designed to be.
 *
 * Flip either to false to hand the ability back.
 */
export const DISABLE_GLIDING = true
export const DISABLE_DOUBLE_JUMP = true

export function applyFairness() {
  AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, LOCOMOTION)

  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({
      disableGliding: DISABLE_GLIDING,
      disableDoubleJump: DISABLE_DOUBLE_JUMP
    })
  })
}
