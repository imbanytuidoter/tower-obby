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
  glidingSpeed: 6,
  glidingFallingSpeed: 1,
  hardLandingCooldown: 0.75
} as const

/**
 * Both stay ON, and that is a deliberate reversal.
 *
 * I previously turned them off believing the glider let a player fly to the
 * top. It does not: glidingFallingSpeed is a descent cap, and only a
 * continuous force applied by the scene can lift a gliding player - this scene
 * applies none. Gliding here just slows a fall and lets you drift, which on
 * touch controls is a mercy, not an exploit.
 *
 * This game is judged on mobile. A thumb on a virtual joystick is far less
 * precise than a keyboard, so the honest way to keep a climb hard is wider
 * margins on the gaps, not stripping the abilities that make an imprecise
 * input survivable.
 *
 * Flip either to true to take the ability away again.
 */
export const DISABLE_GLIDING = false
export const DISABLE_DOUBLE_JUMP = false

/**
 * Seconds the player cannot move after a fall. This is what makes a fall cost
 * something: the round clock is the server's wall clock, so lost seconds are
 * real and cannot be under-reported the way a client-side penalty could be.
 */
export const FALL_FREEZE_SECONDS = 1.5

let frozenFor = 0

export function applyFairness() {
  AvatarLocomotionSettings.createOrReplace(engine.PlayerEntity, LOCOMOTION)

  restoreInput()
  engine.addSystem(freezeSystem, 0, 'freezeSystem')
}

function restoreInput() {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({
      disableGliding: DISABLE_GLIDING,
      disableDoubleJump: DISABLE_DOUBLE_JUMP
    })
  })
}

/** Called on every fall. Movement returns by itself. */
export function freezeAfterFall() {
  frozenFor = FALL_FREEZE_SECONDS
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })
}

function freezeSystem(dt: number) {
  if (frozenFor <= 0) return
  frozenFor -= dt
  if (frozenFor <= 0) restoreInput()
}
