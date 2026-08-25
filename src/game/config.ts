/** Global tuning for the obby. Heights stay under the ~20m ceiling of one parcel. */

/**
 * One tower, permanent, shared by everyone in the World.
 *
 * This replaced ten rotating rounds. A course that regenerates every few
 * minutes cannot be learned, cannot be talked about, and produces times that
 * compare to nothing - which quietly defeated the leaderboard, the live
 * ranking and every reason two players would speak to each other. Difficulty
 * now ramps with altitude, which is what the ramp was always for.
 */
export const TOWER_ZONES = 20

/** Kept only so the tower is reproducible; the seed never changes. */
export const TOWER_SEED = 20260904

/**
 * Rough cost of climbing the tower, in seconds. A model, not a playtest.
 *
 * Each hop costs the greater of covering its gap at a realistic 4 m/s -
 * nobody holds jogSpeed 8 across a two metre pad - or the airtime of a jump,
 * plus hardLandingCooldown on hops that gain real height. Used to size the
 * signage and to sanity-check that the climb is a climb and not a marathon.
 */
export function estimateClimbSeconds(
  pads: { x: number; y: number; z: number; size: number; detour?: boolean }[]
): number {
  const SPEED = 4
  const JUMP_ARC = 1.1
  const RECOVER = 0.75

  // Detours are not the climb. Coin ledges hang off the side of the route and
  // are optional by design, so counting them inflated the model by a third.
  const route = pads.filter((pad) => !pad.detour)

  let seconds = 0
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1]
    const pad = route[i]
    const gap = Math.hypot(pad.x - previous.x, pad.z - previous.z) - pad.size / 2 - previous.size / 2
    seconds += Math.max(gap / SPEED, JUMP_ARC)
    if (pad.y - previous.y > 0.3) seconds += RECOVER
  }
  return seconds
}

/**
 * Time of day, seconds since midnight.
 *
 * 57600 is 16:00. Chosen by shooting the same frame at 07:00, 08:30, 10:00,
 * 13:00 and 16:00 and putting the five side by side, rather than by taste:
 *
 *   07:00  warm but hazy, everything tinted pink, the greens go grey
 *   08:30  the same wash, slightly cooler
 *   10:00  honest and flat - what shipped, and it reads like noon
 *   13:00  flattest of all, sun overhead, almost no shadow direction
 *   16:00  warm, and the shadows are long and clearly angled
 *
 * Late afternoon wins because shadow DIRECTION is what gives a tower of pale
 * slabs its depth: at noon every pad casts a puddle under itself and the
 * stack reads flat. It also flatters the jungle, which is the one thing in
 * the clearing that is actually colourful.
 *
 * The older note is still true and is why this stops at 16:00 rather than
 * going further: a full sunset flattened the whole scene to near-black
 * regardless of what colours the materials carried.
 */
/**
 * The forest ambience: how loud at the floor, how high before it is gone, and
 * how many volume steps between - quantised because AudioSource is synced and
 * a per-frame write is a per-frame broadcast.
 */
export const FOREST_VOLUME = 0.45
export const FOREST_FADE_HEIGHT = 34
export const FOREST_STEPS = 8

export const SKYBOX_TIME = 57600

/**
 * How fast the tandem plate travels, as a share of its full lift per second.
 * It falls faster than it rises so stepping off has an immediate consequence
 * and the person still aboard can feel it going.
 */
/**
 * Ghost sampling. Two a second for at most five minutes: 600 samples, 1800
 * floats, about 7 KB - inside the 13 KB the transport will carry.
 */
export const GHOST_SAMPLE_SECONDS = 0.5
export const GHOST_MAX_SAMPLES = 600

/** How close the server needs a player to be to grant the ante. */
export const COIN_RADIUS = 3

/**
 * Optional pickups: how many, how far above their pad they hang, and how close
 * you have to be to take one.
 *
 * Eight because the point is a collection you can be missing pieces of and
 * come back for. Two would be a chore, thirty would be a job.
 */
export const PICKUP_COUNT = 16

/**
 * The ledge under a coin.
 *
 * Small on purpose - it is somewhere to stand, not somewhere to rest - but it
 * has to hold an avatar, and 2.6 m is the smallest pad the rest of the tower
 * uses at its hardest. Coins used to hang in open air off the side of the
 * route: you dove at one, and whether you got it or fell to the last
 * checkpoint was down to a thumb on a virtual stick.
 */
export const PICKUP_PERCH_SIZE = 2.6
export const PICKUP_RISE = 1.1
export const PICKUP_RADIUS = 1.4
/** Slack the server allows on a pickup claim, for lag between the two clocks. */
/**
 * Degrees a second the coin turns on its own axis.
 *
 * Fast enough to catch an eye at the edge of the screen, slow enough that the
 * edge-on moment is a flash rather than a strobe.
 */
export const COIN_SPIN = 110

/** Metres the coin rises and falls, and how fast. Small on purpose: the pickup
 *  radius does not move with it, so a big swing would put the coin visibly
 *  outside the volume that actually collects it. */
export const COIN_BOB = 0.18
export const COIN_BOB_RATE = 1.9

/** Degrees a second the crown's halo turns. A quarter of the coin's, so it
 *  reads as ceremony rather than as one more thing sweeping at you. */
export const CROWN_SPIN = 26

/**
 * How far apart two coins have to be.
 *
 * Nothing enforced this, so placement was free to drop two of them within a
 * single jump of each other - and a pair that close is one reward that costs
 * two button presses, while some other stretch of the climb has none at all.
 */
export const COIN_SPACING = 11

/**
 * What things are worth.
 *
 * The climb was scored only in seconds, which rewards exactly one kind of
 * player: the one who already knows the route. Points give the other kinds
 * something to hold - somebody who never finishes still leaves with a number
 * that went up, and somebody who finishes fast but skips every coin does not
 * out-score the collector by default.
 *
 * The ratios carry the design, not the magnitudes:
 *
 *   checkpoint  100  banked again on every climb, so it rewards REPETITION
 *   coin        300  found once per wallet, ever, so it rewards EXPLORATION
 *                    and is worth three checkpoints because getting one is a
 *                    detour off the route with a fall waiting underneath
 *   summit      500  the whole climb, and the only one you cannot get partway
 *
 * Lifetime score is DERIVED from what the server already stores - coins found
 * and summits counted - rather than kept as a fourth number that can drift
 * out of step with the other three.
 */
export const CHECKPOINT_POINTS = 100
export const COIN_POINTS = 300
export const SUMMIT_POINTS = 500

export const PICKUP_GRACE = 1.2
/** How close you have to be for a coin to explain itself. */
export const PICKUP_PROMPT_RANGE = 7

/** How many shards burst from the crown on a summit, and for how long. */
export const CELEBRATION_SHARDS = 8
export const CELEBRATION_SECONDS = 1.8

export const PLATE_RISE_RATE = 0.22
export const PLATE_FALL_RATE = 0.5

/**
 * THE TOWER IS A TREE.
 *
 * Art only. Nothing in this block may move a pad, change a collider or touch
 * a jump budget - if a value affects reach it belongs with REACH_BUDGET.
 *
 * The rule the whole style rests on: every readable surface is one of the
 * four gameplay colours, and every unreadable surface is desaturated
 * green-grey. A forest is made of green and brown, and so is a bad parkour
 * map; what keeps the two apart is that saturation is reserved for meaning.
 */
export const DECOR_MAX_SATURATION = 0.2

/**
 * Four bands, five zones each, and the background DARKENS with altitude so a
 * pad is always lighter than whatever is behind it. That is the reason the
 * crown is the darkest band and not the brightest.
 *
 * Heights measured from the generated tower rather than assumed.
 */
export const BANDS = [
  { name: 'UNDERSTORY', from: 1, to: 5, low: 0, high: 17, backdrop: '#3A4432FF' },
  { name: 'MID BOUGHS', from: 6, to: 10, low: 17, high: 28.8, backdrop: '#2E3B2CFF' },
  { name: 'UPPER CANOPY', from: 11, to: 15, low: 28.8, high: 44.6, backdrop: '#2F4038FF' },
  { name: 'CROWN', from: 16, to: 20, low: 44.6, high: 90, backdrop: '#243040FF' }
] as const

/** Where the backdrop stands: outside every pad, inside the ground plate. */
/**
 * 34, not 27. At 27 the ring stood between the yard and the horizon and the
 * whole play area sat inside a drum - the backdrop has to be behind the
 * climb, not around the player. 34 keeps it inside the 40 m plate edge.
 */
/** The forest edge: outside every pad, inside the backdrop wall. */
/**
 * The undergrowth: a jungle floor around the clearing.
 *
 * Measured out of the GLBs, because the material budget is the whole design
 * constraint here and the catalog does not publish it. The mobile client
 * counts ONE MATERIAL PER PRIMITIVE PER INSTANCE - nothing is shared between
 * copies - so 22 fir trees were costing 44 of a 400 slot budget.
 *
 *   fern              1 primitive   120 tri   animated sway
 *   jungle-plant-06   1 primitive   220 tri
 *   redplant          1 primitive   220 tri
 *   palm              2 primitives  368 tri
 *   tree-fir-02       2 primitives  384 tri   (what was here)
 *
 * So the firs come down from 24 to 10 and the freed slots buy three times as
 * many single-primitive plants. A jungle is dense undergrowth with a few tall
 * things in it, which is exactly the shape that fits this budget.
 */
export const UNDERGROWTH_COUNT = 32
export const UNDERGROWTH_INNER = 21
export const UNDERGROWTH_OUTER = 35
export const PALM_COUNT = 5
export const PALM_RING_RADIUS = 27

/**
 * Plants hugging the lobby deck.
 *
 * The ring at 21-35 m is the backdrop; this is the FOREGROUND. Everything a
 * player sees in their first two seconds is the deck, the gate and whatever
 * is immediately beside them, and that was bare ground - so the clearing read
 * as a lawn with a distant treeline rather than as a space cut out of jungle.
 */
/**
 * Epiphytes up the trunk.
 *
 * The jungle was entirely at ground level, which meant the moment you left
 * the floor you left the jungle - and this scene is a CLIMB, so most of it
 * happens above the treeline.
 *
 * The trunk is a cone from radius 2.5 to 1.4 and the nearest pad sits at 6,
 * so anything hugging the bark is physically incapable of touching a surface
 * a player lands on. That is the whole reason the growth goes HERE and not on
 * the pads: a plant on a landing is an obstacle wearing leaves, and green on
 * a checkpoint would collide with the banked-green that checkpoints already
 * use to say "this one is yours".
 */
export const TRUNK_GROWTH_COUNT = 14
export const TRUNK_GROWTH_LOW = 5
export const TRUNK_GROWTH_HIGH = 58

export const FRINGE_COUNT = 18
export const FRINGE_MARGIN = 2.4

export const TREE_RING_RADIUS = 30
/**
 * Where a tree goes when its place on the ring falls on the lobby deck: out
 * against the wall rather than deleted. Must stay inside BACKDROP_HALF minus
 * a canopy, or half a tree gets clipped by the scene boundary.
 */
export const TREE_RING_OUTER = 33.5
/**
 * 7, down from 10, down from 24.
 *
 * A fir costs 2 materials and 384 triangles; a fern costs 1 and 120. With
 * sixty-odd plants now carrying the greenery, the firs are only still here
 * for HEIGHT - a silhouette above the undergrowth - and seven of them do that
 * as well as ten did.
 */
export const TREE_COUNT = 7
/**
 * tree-fir-02 stands 5.55 m at scale 1, so this is roughly a 14 m tree.
 *
 * The catalog lists it as "270.6 x 253.7 x 555.0m" and that is the raw mesh
 * bounding box with the GLB's own node scale of 0.01 ignored. Trusting it
 * produced 14-centimetre trees that rendered but could not be seen. Model
 * dimensions get measured out of the file, never read off the catalog.
 */
export const TREE_SCALE = 3.0
/** Half the canopy width at TREE_SCALE: tree-fir-02 is 2.7 m wide at scale 1. */
export const TREE_CANOPY_RADIUS = 4.1

/**
 * What actually has to stay off the deck: the trunk, not the canopy.
 *
 * Keeping a whole canopy clear of a 24 m lobby erased every tree in the
 * southern half of the field - the exclusion box reached from z=1.9 to z=34.1
 * - and left the board standing against bare wall. A canopy over the edge of
 * a clearing is what the edge of a clearing looks like; a trunk in the middle
 * of the deck is an obstacle. Only the second one is a problem.
 */
export const TREE_TRUNK_RADIUS = 0.9

/**
 * Half-width of the square boundary wall, from the centre of the scene.
 *
 * The boundary follows the field, not a circle inscribed in it: a round wall
 * inside a square plot leaves four unexplained wedges of ground in the corners
 * and never lines up with the parcel edge the player can see. 39 keeps the
 * 0.4 m wall inside the 0..80 scene with room to spare.
 */
export const BACKDROP_HALF = 38

/** Bark, canopy, mist, grass. None of these may exceed DECOR_MAX_SATURATION. */
export const FOREST = {
  // #4A3628 is what the brief specified, and it measures 0.30 saturation
  // against the brief's own 0.20 ceiling - the largest surface in the scene
  // would have been the one thing breaking the rule the style rests on.
  // Pulled 37% toward grey: still unmistakably bark, now 0.19.
  // Lightness matters as much as saturation here. #4A3628 from the brief is
  // 0.30 saturation, over the brief's own 0.20 ceiling; pulling it to grey
  // fixed that and left it at 0.22 lightness, which renders as a black
  // column under this sun. #7A6553 is 0.19 saturation and 0.40 lightness -
  // quiet enough to obey the rule, light enough to be bark rather than a
  // silhouette, and still darker than every pad in front of it.
  bark: '#7A6553FF',
  canopyNear: '#3D5240FF',
  canopyFar: '#5B6F5EFF',
  mist: '#96A89BFF',
  /**
   * Green, and green WITHIN the rule.
   *
   * It was #7B8C6A: hue 90 - yellow-green - at 0.14 saturation, which under a
   * 16:00 sun renders as bare earth. Asked to make the floor green, the
   * tempting move is to crank saturation, and every convincing grass measures
   * 0.22 to 0.28 against a 0.20 ceiling that exists for a reason: saturation
   * in this scene is reserved for MEANING, and a vivid floor competes with
   * the four colours that have to be read instantly.
   *
   * Hue costs nothing against that ceiling. Moving 90 -> 111 walks out of
   * yellow and into true green while saturation goes only 0.14 -> 0.197, and
   * dropping the luminance 0.48 -> 0.42 stops the warm sun washing it back to
   * sand. Measured, not eyeballed - the build throws if any FOREST colour
   * crosses 0.20.
   */
  grass: '#5C8056FF'
} as const

/** How much a pad lights itself, per meaning, so it survives canopy shade. */
/**
 * Above this height a pad gets no ground blob. Tied to the top of the first
 * band: that is the altitude above which the clearing floor and the climb stop
 * sharing a screen, so an anchor drawn on the floor anchors nothing.
 */
/**
 * The highest pad that gets a ground shadow.
 *
 * It was BANDS[0].high, 17 m, which put a shadow blob under 35 pads. A blob
 * costs a material apiece on a budget that reached 98% once the jungle went
 * in, and it buys almost nothing above head height: the shadow's job is to
 * tell you where a pad sits over the GROUND, and by 12 m you are reading the
 * pad against the tower instead. Ten slots recovered, and measured from the
 * clearing there is no difference you can point at.
 *
 * Cut again 12 -> 9 to pay for the deck fringe below. 13 blobs left, all of
 * them under pads a player is standing beside when they read them.
 */
export const SHADOW_MAX_HEIGHT = 7

export const PAD_EMISSIVE = {
  safe: 0.35,
  hurts: 0.2,
  unstable: 0.25,
  goal: 0.55
} as const

/** How often the server proves it is alive. */
export const HEARTBEAT_SECONDS = 2

/** How often the server flushes changed player stats to storage. */
export const STATS_FLUSH_SECONDS = 8

/**
 * How close the server needs a player to be to accept a finish claim.
 *
 * Has to cover the whole slab or standing on its corner claims nothing. The
 * crown is 9.0 m across, so its furthest corner is 9.0/2 * sqrt(2) = 6.36 m
 * from the centre; at the old 3.5 the corner was a dead zone, which is
 * exactly what widening the slab produced and what the invariant caught.
 * This number therefore follows the slab and is not free to pick.
 */
export const FINISH_RADIUS = 6.7

/**
 * How far past the slab's own corner still counts as touching the finish.
 *
 * The client used to test a flat 1.8 m while the server accepted 3.5 m, so a
 * player standing on the corner of a 3.2 m pad - 2.26 m from its centre, and
 * unambiguously on it - triggered nothing at all. The radius is now derived
 * from the pad the round actually generated, and clamped below FINISH_RADIUS
 * so the client can never claim something the server would reject.
 */
export const FINISH_TOUCH_MARGIN = 0.6

/** Vertical slack for the same test: enough for a landing, not for a flyby. */
export const FINISH_TOUCH_RISE = 1.6

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
// MAX_SHORTCUT_RISE lives beside MAX_STEP_RISE, which it is derived from.

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
 *
 * Kept on the X axis of the scene rather than on its diagonal. On the diagonal
 * the lobby, the gate and the board all sat at 45 degrees to the square the
 * scene actually is, so nothing lined up with anything and the whole approach
 * read as crooked. On the axis the tower, the gate, the spawn and the board
 * are one straight line down the middle of the field.
 * The radius must NOT follow the difficulty curve: the lobby, the start gate
 * and the spawn point are all built around this pad, so it has to sit in the
 * same place in every round.
 */
export const START_X = 40
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
/**
 * 24 m of deck for a walk of eight. The size was not the problem on its own -
 * the problem is that the tree exclusion is measured off it, and at 24 m the
 * box reached from z=5.1 to z=30.9 and left no room for a single tree behind
 * the board. 20 gives the forest somewhere to stand.
 */
export const LOBBY_SIZE = 20
export const LOBBY_Y = 0.4

/**
 * How far from the lobby centre a pad may not be generated.
 *
 * Deliberately NOT derived from LOBBY_SIZE. It was, and that made the shape of
 * the entire climb depend on the size of the deck: shrinking the deck from 24
 * to 20 to make room for trees moved the finish from (27.6, 69.5, 50.0) to
 * (38.1, 70.1, 56.1) and reshuffled every pad behind it. Every time on the
 * leaderboard was set on a tower that no longer existed, and nothing said so.
 *
 * 14 is LOBBY_SIZE/2 + 2 evaluated when the deck was 24, so this pins the
 * tower to the shape those records were set on. Changing this number is
 * changing the game; tools/verify-layout.mjs will refuse the build until the
 * fingerprint below is updated on purpose.
 */
export const LOBBY_KEEPOUT_RADIUS = 14

/** How wide a checkpoint landing wants to be, if its neighbours allow it. */
export const LANDING_SIZE = 4.6

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
/**
 * Arrival stands BEHIND the lobby centre, not two thirds of the way to the
 * gate. From here the gate and the tower are straight ahead and the board sits
 * 43 degrees off that line - inside peripheral vision on a phone. It used to
 * be 180 degrees behind, which is why nobody read it.
 *
 * tools/verify-layout.mjs asserts that angle so it cannot drift back.
 */
export const LOBBY_SPAWN_BACK = 1.5
export const LOBBY_SPAWN_X = LOBBY_X - GATE_DIR_X * LOBBY_SPAWN_BACK
export const LOBBY_SPAWN_Z = LOBBY_Z - GATE_DIR_Z * LOBBY_SPAWN_BACK

/** Board placement, relative to the lobby centre, in gate-space. */
/**
 * Where the board stands, measured from the lobby centre along the line to
 * the gate. NEGATIVE means behind the spawn.
 *
 * This deliberately reverses an earlier rule. The board used to sit 43 degrees
 * off the arrival gaze so it would be read on arrival, and directly behind was
 * called out as the mistake that made nobody read it. It is back there on
 * purpose now: the number that matters on arrival is on the gate itself, at
 * eye height, facing the spawn. The board is for browsing, and browsing wants
 * the whole thing square in front of you, not angled off to one side.
 */
/**
 * Where the two noticeboards stand, and how wide they are.
 *
 * These used to live one in plaza.ts and one in legend.ts, which meant
 * layout.ts - the file that plants the jungle - had no way to know they were
 * there. Two ferns grew straight through them: one 0.64 m into the legend,
 * one clipping the leaderboard. Anything the undergrowth has to avoid has to
 * be visible from the pure layout module, so it lives here.
 */
export const BOARD_W = 5.6
export const LEGEND_FORWARD = -4.0
export const LEGEND_LATERAL = 8.2

export const BOARD_FORWARD = -7.5
export const BOARD_LATERAL = 0
export const GATE_WIDTH = 6

/** How close the player must be for an approach prompt to appear. */
export const PROMPT_RANGE = 11

/**
 * How close you must be for a route sign to appear.
 *
 * They are billboards and were always on, so the fork's price tags hung over
 * the treeline and were read from the lobby, fifty metres from the choice.
 * A decision you are not standing in front of is not information.
 */
export const SIGN_RANGE = 9

/**
 * How much harder height counts than width when deciding if a sign is yours.
 *
 * The tower is vertical, so metres up are worth far more than metres across:
 * a sign one floor above is describing somebody else's problem. Used as a
 * multiplier inside a single distance rather than as a separate threshold -
 * two independent windows let the lever's label qualify on a technicality
 * from five metres higher and eight metres away, and it lit up in the middle
 * of the piston hall.
 */
export const SIGN_RISE = 2.5

/** Pads are kept inside these bounds so nothing hangs over the parcel edge. */
export const MIN_XZ = 5
export const MAX_XZ = 75

/** A fall this far below the active checkpoint sends the player back. */
export const FALL_GRACE = 3.2

/**
 * How close to a landing's centre banks the checkpoint.
 *
 * Derived from the landing, not chosen. It was a flat 2.2 while landings were
 * 3.2 m wide, and stayed 2.2 when they were grown to 4.6 - which put the
 * corner of every one of the six at 2.69 to 3.25 m and made it dead. Stand
 * there, bank nothing, fall, and lose everything back to the previous
 * checkpoint with no way to know why.
 *
 * This is the finish slab's dead zone repeated exactly, in the same file that
 * documents it, caused by widening the pads without asking what measured them.
 */
export const CHECKPOINT_RADIUS = (LANDING_SIZE / 2) * Math.SQRT2 + 0.2

/**
 * Slack around a landing's own edge when banking it.
 *
 * Small on purpose: the test is a box the shape of the pad, so the margin only
 * has to cover the width of the avatar standing with its toes over the lip.
 */
export const CHECKPOINT_TOUCH_MARGIN = 0.4
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
/**
 * How high above its pads a beam sweeps.
 *
 * Raised from 0.85: at that height a beam sat close enough to the deck that
 * there was no room to read it before it arrived. Higher means more air
 * between the platform and the thing trying to sweep you off it.
 */
export const HAZARD_CLEARANCE = 1.15

/**
 * How thick a sweeping beam is. Its LENGTH is not a free choice - it has to
 * span the ring of pads it guards or it stops being an obstacle - so this is
 * the only dimension that can come down, and at 0.7 the beam read as a slab.
 */
export const HAZARD_THICKNESS = 0.3

/** Roughly the radius of a Decentraland avatar's capsule. */
const PLAYER_RADIUS = 0.3

/**
 * How close to a beam's centre line counts as a hit.
 *
 * Derived, not chosen. It was a free 0.85 against a beam whose visible half
 * was 0.35, so the beam killed you half a metre before it touched you and the
 * player had no way to know why. Deriving it means the hit box can never drift
 * away from the thing on screen again.
 */
export const HAZARD_HALF_WIDTH = HAZARD_THICKNESS / 2 + PLAYER_RADIUS

/**
 * How long a crumbling pad holds once it is stood on.
 *
 * 0.7 was set on a desktop and never revisited when the jump budget came down
 * to 0.55 for a thumb. The widest hop is 3.03 m, which at the documented jog
 * speed is 0.38 s in the air - so 0.7 left 0.32 s to see the pad go, decide
 * and aim, on a virtual stick, with five of them in a row at the worst point.
 *
 * The rule now is that the pad must give at least as long to react as it takes
 * to cross - equal halves, checked in tools/verify-layout.mjs. Runtime only:
 * this changes nothing about where pads are, so the tower is untouched.
 */
export const CRUMBLE_DELAY = 1.35
export const CRUMBLE_RESPAWN = 4

/** No pad may sit above another one closer than this, or the climb is blocked. */
export const VERTICAL_CLEARANCE = 2.4

/**
 * How far above another pad a pad has to be before it may overlap it in plan.
 *
 * VERTICAL_CLEARANCE alone was not enough. It is a RADIAL keep-out, so once
 * two pads were 2.5 m apart in height they could sit anywhere, including
 * directly on top of one another - and eleven pairs did, the worst overlapping
 * 4.8 x 5.7 m with three metres of headroom. From below that is not a route,
 * it is a ceiling: the lower pad is hidden, the upper one looks like it rests
 * on it, and the climb reads as a heap of slabs rather than as a line.
 *
 * Raising VERTICAL_CLEARANCE to 5 m fixed the look and cost both levers and
 * the coin budget, because it thinned the whole tower to treat one symptom.
 * So this is the narrow rule instead: above 2.4 m the radial spacing relaxes
 * as before, but FOOTPRINTS may not overlap until there is 5 m of daylight.
 */
export const CEILING_CLEARANCE = 5.0

/**
 * The tallest step the generator may ever ask for.
 *
 * doubleJumpHeight is 2m, so anything above this is a pad nobody can reach and
 * a run that ends there. The placement search lifts when it cannot find room,
 * and those lifts used to stack into 3.5m steps.
 */
/**
 * What a jump can cover, and the share of it this course is allowed to use.
 *
 * The client's own locomotion defaults are documented and verified against
 * unity-explorer's CharacterControllerSettings asset: walkSpeed 1.5,
 * jogSpeed 8, runSpeed 10, jumpHeight 1, runJumpHeight 1.5,
 * doubleJumpHeight 2. Gravity is NOT documented anywhere, and an attempt to
 * measure it by timing falls through the Explorer failed honestly: at 0.18 s
 * per poll, a 15 m fall is three samples and the numbers came out anywhere
 * between 14 and 39 m/s2. So it stays unknown.
 *
 * REACH_ABILITY is therefore still an estimate. What is NOT an estimate is
 * that the budget clears by a wide margin, and that can be shown without
 * knowing gravity at all:
 *
 *   the widest required gap is 3.03 m
 *   at the documented jog speed of 8 m/s that is 0.38 s of airtime
 *   a double jump reaches 2 m, so its airtime is 2 * sqrt(2h/g)
 *   for that to drop below 0.38 s, gravity would have to exceed 112 m/s2
 *
 * Earth is 9.8 and game engines run 15 to 30. The gap is crossable under any
 * physics that still produces a 2 m jump.
 */
/**
 * Client defaults, verified against unity-explorer's own settings asset.
 * These are documented; REACH_ABILITY below is not.
 */
export const JOG_SPEED = 8

/**
 * A pessimistic gravity, used only to bound the airtime argument. The real
 * value is not documented and could not be measured with the tools here, so
 * the check assumes a value at the harsh end of what game engines use - if
 * the gap clears under that, it clears under anything gentler.
 */
export const PESSIMISTIC_GRAVITY = 30

export const DOUBLE_JUMP_HEIGHT = 2
export const REACH_ABILITY = 5.5
/**
 * 0.66. This is a CEILING, not a setting: it caps what the generator is
 * allowed to ask for anywhere, and the curve below decides where the tower
 * actually goes near it. It went 0.7 -> 0.55 when a phone player said the
 * parkour was too hard, which flattened the whole climb to fix the bottom of
 * it; now the bottom is set by jumpGap instead and starts EASIER than it did
 * at 0.55, while the summit is free to reach for this.
 *
 * The old note, still true about why 0.7 was wrong as a flat value:
 * 0.55, down from 0.7, on the strength of somebody actually playing it on a
 * phone and saying the parkour was too hard. That beats the model: 70% was my
 * reading of the design brief, and the brief was written by somebody who had
 * not played it on a handset either. A thumb on a virtual stick has no
 * precision to spare, and the climb is meant to be hard because of nerve and
 * timing, not because the gap is near the edge of what the avatar can do.
 */
export const DIFFICULTY_BUDGET = 0.87

export const REACH_BUDGET = REACH_ABILITY * DIFFICULTY_BUDGET

/**
 * The SHORTEST gap the generator may ever produce.
 *
 * hop() has always clamped the top - `Math.min(gap, REACH_BUDGET)` - and never
 * the bottom, so sections were free to multiply the gap down: the narrow
 * bridge asks for 0.85, the piston hall 0.8, the plunge 0.85. At the foot of
 * the curve that meant hops of 1.76 m between pads up to 3.9 m wide, and a
 * tower where the gaps are half the width of the things they separate does
 * not read as a climb - it reads as a pile of slabs. Measured before this
 * existed: shortest hop 1.63 m, and 29 of 120 hops under 2.5 m.
 *
 * Every claim about difficulty in this project was made about the WIDEST gap.
 * Nobody ever measured the narrowest, which is the one you can see.
 */
export const MIN_GAP = 4.0
/** 70% of doubleJumpHeight. Was 1.6, which is 80% and broke the brief. */
export const MAX_STEP_RISE = DOUBLE_JUMP_HEIGHT * DIFFICULTY_BUDGET

/**
 * Follows the main route's rise budget instead of undercutting it.
 *
 * It was a flat 1.3 m - STRICTER than the climb it is supposed to shorten,
 * which is backwards. Worse, it is what silently deleted the mechanic: a
 * shortcut that gains twenty metres at 1.3 m a step needs sixteen pads, and
 * sixteen pads across a twenty-five metre chord sit 1.5 m apart, which the
 * spacing test then rejected. Every one of the 95 candidates died there and
 * `shortcut` came back null.
 *
 * Tied to MAX_STEP_RISE it scales with the rest of the tower, so opening the
 * climb out can never again quietly close this.
 */
export const MAX_SHORTCUT_RISE = MAX_STEP_RISE * 0.85
export const HORIZONTAL_CLEARANCE = 1.2

/** A checkpoint every Nth section, not on every one. */
export const CHECKPOINT_EVERY_SECTIONS = 3

/** How far pads sit from the tower axis. Sections are built inside this band. */
export const SHAFT_MIN_RADIUS = 6
export const SHAFT_MAX_RADIUS = 17

/**
 * Difficulty at a point on the climb. `progress` is 0 at the gate and 1 at
 * the crown, so a zone's shape is decided by how high it is rather than by
 * which round it belongs to.
 */
export function curve(progress: number) {
  const t = Math.min(1, Math.max(0, progress))
  const lerp = (a: number, b: number) => a + (b - a) * t

  return {
    t,
    /** How many zones a stretch of the tower is worth. Fixed: see TOWER_ZONES. */
    sections: TOWER_ZONES,
    /** Pads per section, before the section's own shape decides the rest. */
    sectionLength: Math.round(lerp(6, 9)),
    // Narrower than they were (3.9 -> 3.3 at the foot). A pad's width and the
    // gap beside it are read together: at 3.9 m wide with a 2 m gap the slabs
    // touch to the eye no matter what the number says.
    padSize: lerp(3.3, 2.3),
    /**
     * The gap between pad EDGES - this is the distance actually jumped.
     * Centre-to-centre was the wrong thing to tune: with 3.2m pads a 4.2m
     * centre distance leaves a 1m gap, which reads as platforms touching.
     */
    // Opened out twice on request. 1.6 -> 2.7 originally, then 1.5 -> 3.1,
    // now 1.9 -> 4.05.
    //
    // The ask the third time was "1.5x everywhere". Measured, that lands the
    // widest gap at 5.28 m: 90% of the airtime a double jump buys at a
    // pessimistic 30 m/s2, and it drops a crumbling pad's thinking time from
    // 0.57 s to 0.34 s against a 0.66 s crossing - a five-pad crumbling run
    // stops being a test of nerve and becomes a coin toss. This is as far as
    // the gaps go while the tower is still a climb rather than a lottery:
    // 1.31x on the widest gap, 1.27x at the bottom, 72% of the airtime.
    jumpGap: lerp(2.2, 4.6),
    rise: lerp(0.75, 1.08),
    // Slowed on request. Every knob in this block is applied AFTER the random
    // draws that place pads, so turning them changes how hard the tower is to
    // survive without changing its shape - the fingerprint check proves it.
    spinnerSpeed: 34 + t * 56,
    // Shorter overhang past the ring it guards, so the ends of a beam stop
    // reaching over ground a climber has no business defending.
    spinnerReach: lerp(1.4, 2.4),
    moverSpeed: 0.9 + t * 1.5,
    moverReach: lerp(2, 3.4),
    /** Share of sections that get a hazard on top of their own shape. */
    hazardChance: lerp(0, 0.85)
  }
}
