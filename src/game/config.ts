/** Global tuning for the obby. Heights stay under the ~20m ceiling of one parcel. */

export const TOTAL_ROUNDS = 10

/**
 * Rough cost of climbing a course, in seconds.
 *
 * A model, not a playtest: each hop costs the greater of covering its gap at a
 * realistic 4 m/s - nobody holds jogSpeed 8 across a two metre pad - or the
 * airtime of a jump, plus hardLandingCooldown on hops that gain real height.
 */
export function estimateClimbSeconds(
  pads: { x: number; y: number; z: number; size: number }[]
): number {
  const SPEED = 4
  const JUMP_ARC = 1.1
  const RECOVER = 0.75

  let seconds = 0
  for (let i = 1; i < pads.length; i++) {
    const previous = pads[i - 1]
    const pad = pads[i]
    const gap = Math.hypot(pad.x - previous.x, pad.z - previous.z) - pad.size / 2 - previous.size / 2
    seconds += Math.max(gap / SPEED, JUMP_ARC)
    if (pad.y - previous.y > 0.3) seconds += RECOVER
  }
  return seconds
}

/**
 * How long a round lasts, from what the course actually costs to climb.
 *
 * Counting pads was a proxy for the wrong thing. Modelling the climb put round
 * ten at ~120s of clean running against a 261s clock - more than double, so
 * the round dragged whenever nobody finished. The clock is a backstop for that
 * case, and ROUND_SLACK is how much room it leaves for falls and retries.
 */
export const ROUND_SLACK = 1.7

export function roundSeconds(
  pads: { x: number; y: number; z: number; size: number }[]
): number {
  return Math.round(Math.min(300, Math.max(75, estimateClimbSeconds(pads) * ROUND_SLACK)))
}

/** How often the server proves it is alive. */
export const HEARTBEAT_SECONDS = 2

/** How close the server needs a player to be to accept a finish claim. */
export const FINISH_RADIUS = 3.5

/** Rows kept on the shared board. */
export const BOARD_SIZE = 10

/**
 * The co-op shortcut. Two pads held at the same time by two different avatars
 * open a shorter route past one section.
 *
 * The main climb always stays completable alone - a judge will arrive on their
 * own, and gating the only path on a second player would make the scene look
 * broken to them.
 */
export const PAD_RADIUS = 2.2
/** How far apart the two pads sit: far enough that one person cannot hold both. */
export const PAD_SEPARATION = 9
/** Which section boundary the shortcut starts from. */
export const SHORTCUT_FROM_SECTION = 2
/** Fewest pads a bypass is worth building from. */
export const SHORTCUT_HOPS = 4

/**
 * Highest rise the bypass may ask for in one hop. jumpHeight is 1m and
 * runJumpHeight 1.5m, so this stays inside what a jump actually reaches.
 */
export const MAX_SHORTCUT_RISE = 1.3

/** Live "who is highest" ranking: how many climbers, refreshed how often. */
export const RANKING_SIZE = 3
export const RANKING_SECONDS = 1

/** Hard ceiling for pad height. The 3x3 parcel scene allows about 66m. */
export const MAX_PAD_HEIGHT = 85

/**
 * A new pad must keep this much clear air from any other pad within
 * VERTICAL_WINDOW metres of it. Without this the spiral stacks pads
 * directly on top of each other and the tower reads as one column.
 */
export const MIN_PAD_SEPARATION = 3.4
export const VERTICAL_WINDOW = 2.6

/** Every Nth pad is flat, so a round can be long without hitting the ceiling. */
export const FLAT_EVERY = 3

/** A checkpoint every Nth pad. Higher number = longer stretches without a save. */
export const CHECKPOINT_EVERY = 6

/** Where the tower is centred inside the 80x80 scene. */
export const CENTER_X = 40
export const CENTER_Z = 40

/** Size of the ground plate the whole scene sits on. */
export const GROUND_SIZE = 80

/**
 * Direction of the first pad from the tower centre, and its fixed distance.
 * The radius must NOT follow the difficulty curve: the lobby, the start gate
 * and the spawn point are all built around this pad, so it has to sit in the
 * same place in every round.
 */
export const START_X = 20
export const START_Z = 20
export const START_RADIUS = 12

const startAngle = Math.atan2(START_Z - CENTER_Z, START_X - CENTER_X)

/** World position of the first pad of every round. */
export const START_PAD_X = CENTER_X + Math.cos(startAngle) * START_RADIUS
export const START_PAD_Z = CENTER_Z + Math.sin(startAngle) * START_RADIUS

/**
 * The lobby sits just OUTSIDE the tower, further along the same ray from the
 * centre through the first pad. Subtracting here would bury it in the tower.
 */
export const LOBBY_X = START_PAD_X + Math.cos(startAngle) * 10
export const LOBBY_Z = START_PAD_Z + Math.sin(startAngle) * 10
export const LOBBY_SIZE = 16
export const LOBBY_Y = 0.4

/** The start gate straddles the line between the lobby and the first pad. */
/** Unit vector pointing from the lobby towards the tower. */
export const GATE_DIR_X = -Math.cos(startAngle)
export const GATE_DIR_Z = -Math.sin(startAngle)

export const GATE_X = (LOBBY_X + START_PAD_X) / 2 + GATE_DIR_X * 1.6
export const GATE_Z = (LOBBY_Z + START_PAD_Z) / 2 + GATE_DIR_Z * 1.6

/**
 * Where a round drops you: a couple of steps short of the line, not across the
 * lobby from it. The first thirty seconds are the whole pitch, and walking is
 * not the game.
 */
export const LOBBY_SPAWN_X = LOBBY_X + (GATE_X - LOBBY_X) * 0.65
export const LOBBY_SPAWN_Z = LOBBY_Z + (GATE_Z - LOBBY_Z) * 0.65
export const GATE_WIDTH = 9

/** How close the player must be for an approach prompt to appear. */
export const PROMPT_RANGE = 11

/** Pads are kept inside these bounds so nothing hangs over the parcel edge. */
export const MIN_XZ = 5
export const MAX_XZ = 75

/** A fall this far below the active checkpoint sends the player back. */
export const FALL_GRACE = 3.2

export const CHECKPOINT_RADIUS = 2.2
export const RESPAWN_LIFT = 1.4
/**
 * Seconds the player cannot move after a fall. This is what makes a fall cost
 * something: the round clock is the server's wall clock, so lost seconds are
 * real and cannot be under-reported the way a client-side penalty could be.
 */
export const FALL_FREEZE_SECONDS = 1.5

/**
 * Hazards stay off this long after a respawn. It MUST outlast the freeze.
 *
 * At 0.9s against a 1.5s freeze there was a 0.6s window where the player was
 * both vulnerable and unable to move - and a checkpoint that happens to sit
 * under a spinning beam turns that into an unbreakable death loop. Derived
 * from the freeze so the two cannot drift apart again.
 */
export const RESPAWN_COOLDOWN = FALL_FREEZE_SECONDS + 0.3

/** Hazards only bite within this vertical window, so jumping over them works. */
export const HAZARD_CLEARANCE = 0.85
export const HAZARD_HALF_WIDTH = 0.85
export const HAZARD_THICKNESS = 0.7

/** Crumbling pads: how long before they drop, and how long until they return. */
export const CRUMBLE_DELAY = 0.7
export const CRUMBLE_RESPAWN = 4

/** No pad may sit above another one closer than this, or the climb is blocked. */
export const VERTICAL_CLEARANCE = 2.4

/**
 * The tallest step the generator may ever ask for.
 *
 * doubleJumpHeight is 2m, so anything above this is a pad nobody can reach and
 * a run that ends there. The placement search lifts when it cannot find room,
 * and those lifts used to stack into 3.5m steps.
 */
export const MAX_STEP_RISE = 1.6
export const HORIZONTAL_CLEARANCE = 1.2

/** A checkpoint every Nth section, not on every one. */
export const CHECKPOINT_EVERY_SECTIONS = 3

/** How far pads sit from the tower axis. Sections are built inside this band. */
export const SHAFT_MIN_RADIUS = 6
export const SHAFT_MAX_RADIUS = 17

/** Difficulty curve, evaluated at t = (round - 1) / (TOTAL_ROUNDS - 1). */
export function curve(round: number) {
  const t = Math.min(1, Math.max(0, (round - 1) / (TOTAL_ROUNDS - 1)))
  const lerp = (a: number, b: number) => a + (b - a) * t

  return {
    t,
    /** Tower of Hell style: a round is a stack of self-contained sections. */
    sections: Math.round(lerp(5, 10)),
    /** Pads per section, before the section's own shape decides the rest. */
    sectionLength: Math.round(lerp(4, 7)),
    padSize: lerp(2.8, 1.9),
    /**
     * The gap between pad EDGES - this is the distance actually jumped.
     * Centre-to-centre was the wrong thing to tune: with 3.2m pads a 4.2m
     * centre distance leaves a 1m gap, which reads as platforms touching.
     */
    jumpGap: lerp(2.4, 3.6),
    rise: lerp(0.9, 1.1),
    spinnerSpeed: 50 + round * 8,
    spinnerReach: lerp(2.4, 3.8),
    moverSpeed: 1.2 + round * 0.2,
    moverReach: lerp(2, 3.4),
    /** Share of sections that get a hazard on top of their own shape. */
    hazardChance: lerp(0.2, 0.8)
  }
}
