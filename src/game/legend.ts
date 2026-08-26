/**
 * The legend, standing beside the leaderboard.
 *
 * Every object in this scene carries its meaning in its colour and its shape,
 * and that system works - once you know it. The first person to play the
 * deployed build asked what the crystals were for and tried to pick one up,
 * which is the honest verdict on a language nobody published: a teal shard on
 * a checkpoint is a marker to whoever built it and a missed collectible to
 * everybody else.
 *
 * So the samples are the real primitives at small scale, not icons. A player
 * matches shape to shape and colour to colour, and that match survives the
 * walk up the tower; a paragraph of prose does not.
 */
import {
  engine,
  Entity,
  Material,
  MeshCollider,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import {
  GATE_DIR_X,
  GATE_DIR_Z,
  LOBBY_SPAWN_X,
  LOBBY_SPAWN_Z,
  LOBBY_X,
  LOBBY_Z,
  FOREST,
  PICKUP_COUNT,
  CHECKPOINT_POINTS,
  COIN_POINTS,
  SUMMIT_POINTS,
  BOARD_W,
  LEGEND_FORWARD,
  LEGEND_LATERAL,
  HAUL_TARGET
} from './config'
import { MEANING } from './palette'

const LEGEND_W = BOARD_W
const ROW_H = 0.9
const HEADER_H = 1.05
/**
 * The band under the last row: the crown's price, then the grove's count.
 *
 * It was 1.35 and held one line. The shared line went in underneath and
 * landed 4 cm off the bottom edge of the panel - measured off a screenshot,
 * not eyeballed - which is not a margin, it is a near miss. 1.95 is two lines
 * with room to breathe.
 */
const FOOTER_BAND = 1.95
const LEGEND_H = HEADER_H + 4 * ROW_H + FOOTER_BAND

/**
 * Derived so the board's FOOT stays put.
 *
 * It was the constant 3.1, which happened to equal this expression for the
 * old height and would have quietly stopped doing so the moment the board
 * grew: everything inside is laid out downwards from the top edge, so a
 * height change with a fixed centre moves the bottom into the ground rather
 * than making room at the bottom, which is where the room was needed.
 */
const LEGEND_FOOT = 0.1
const LEGEND_Y = LEGEND_FOOT + LEGEND_H / 2

/**
 * Moved out from under the torch.
 *
 * At 6.0 back and 6.0 to the side the nearest torch stood **0.14 m** from this
 * board's face - measured, not guessed - so the tripod grew straight through
 * the panel and sat on top of the sample column. The leaderboard plants a
 * torch and a gold post at each of its own shoulders, and this board was
 * parked on one of them.
 *
 * At 4.0 back and 8.2 to the side the nearest of those four props is 2.81 m
 * away, and the board's ROTATED corners reach 8.16 m and 6.95 m from the lobby
 * centre against a 10 m half-width. Still behind the spawn, still turned
 * inward, still out of the sightline to the tower.
 */
// Both now live in config.ts, where layout.ts can see them - see the note
// there about the ferns that grew through this board.

/** The reader's side of the gate axis - same convention the board uses. */
const SIDE_OF_GATE_X = -GATE_DIR_Z
const SIDE_OF_GATE_Z = GATE_DIR_X

const LEGEND_X = LOBBY_X + GATE_DIR_X * LEGEND_FORWARD + SIDE_OF_GATE_X * LEGEND_LATERAL
const LEGEND_Z = LOBBY_Z + GATE_DIR_Z * LEGEND_FORWARD + SIDE_OF_GATE_Z * LEGEND_LATERAL

/**
 * Yaw that turns the READABLE face towards the spawn.
 *
 * The negations are the whole thing. Written as atan2(dx, dz) this comes out
 * exactly 180 degrees wrong, which puts the board's back to the reader and
 * every line of text INSIDE the slab - and a blank dark wall is precisely
 * what shipped. plaza.ts has always had it right; this file did not copy it.
 */
/**
 * SQUARE with the lobby, not aimed at the spawn.
 *
 * It used to turn to face whoever stands at the spawn, which put it 73 degrees
 * off the axis every other thing in this lobby is built on - the leaderboard,
 * the deck, the gate. From the one spot it was aimed at, it looked correct.
 * From everywhere else, including the place people actually walk up to it, it
 * stood at an angle to all its neighbours and read as knocked crooked.
 *
 * Reported twice. I answered both times with an explanation of why it was not
 * crooked, which was true about the geometry and useless about the complaint:
 * a board that looks wrong IS wrong. Parallel to the leaderboard it can only
 * ever look square, from any angle, because everything around it shares that
 * angle.
 */
const LEGEND_YAW = (Math.atan2(-GATE_DIR_X, -GATE_DIR_Z) * 180) / Math.PI

const FRONT_X = -Math.sin((LEGEND_YAW * Math.PI) / 180)
const FRONT_Z = -Math.cos((LEGEND_YAW * Math.PI) / 180)
const ACROSS_X = Math.cos((LEGEND_YAW * Math.PI) / 180)
const ACROSS_Z = -Math.sin((LEGEND_YAW * Math.PI) / 180)

/**
 * How far the flat samples lean back towards the reader.
 *
 * A pad is a flat slab, so on a vertical board it presents its edge and reads
 * as a coloured stripe - which teaches the wrong silhouette. Leaned most of
 * the way over it shows the face a player actually lands on, and keeps enough
 * edge to say "this thing has a thickness".
 */
const SAMPLE_TILT = -72

/**
 * The samples carry NO emissive at all.
 *
 * At 0.9 and 1.6 they came out mint, cream and pink - the hue washed off the
 * top and left a pastel. That is the same failure this scene has already had
 * on hazards, crumbling pads, the tandem plate and every gold beacon, and it
 * matters more here than anywhere: the board exists to teach the colour
 * language, so a sample that is not the real colour is worse than no sample.
 * The panel behind them is near black, which is all the contrast they need.
 */

const INK = Color4.create(0.13, 0.16, 0.24, 1)
const DIM = Color4.create(0.62, 0.7, 0.8, 1)

/** A point on the legend face: `out` towards the reader, `across` to their right. */
function onFace(out: number, across: number): { x: number; z: number } {
  return {
    x: LEGEND_X + FRONT_X * out + ACROSS_X * across,
    z: LEGEND_Z + FRONT_Z * out + ACROSS_Z * across
  }
}

/**
 * The coin sample turns with the real ones, so the row shows the behaviour and
 * not just the silhouette. A still gold disc on a board is the same thing the
 * tower's coins used to be, and being still is most of why they read as decor.
 */
export let legendCoin: Entity | null = null

/** The shared line: how many coins the grove has been given today. */
export let legendHaul: Entity | null = null

export function setHaul(coins: number) {
  if (!legendHaul) return
  const shape = TextShape.getMutableOrNull(legendHaul)
  if (!shape) return
  shape.text =
    coins >= HAUL_TARGET
      ? 'THE GROVE HAS ALL ' + HAUL_TARGET + ' TODAY. THE CROWN IS LIT'
      : 'GIVEN TO THE GROVE TODAY:  ' + coins + ' OF ' + HAUL_TARGET
}

/**
 * One row per thing a player can be confused by, in the order they meet it.
 *
 * `sample` builds the REAL primitive - same mesh, same albedo, same emissive
 * pulled from the same palette - so the row and the tower cannot drift apart
 * the way a hand-drawn icon would.
 */
const ROWS: {
  name: string
  note: string
  tone: string
  sample: (at: Vector3, rotation: Quaternion) => void
}[] = [
  {
    name: 'CHECKPOINT',
    /**
     * The price is on the same line as the thing.
     *
     * The HUD grew a SCORE line and nothing in the world said where the
     * number came from - a player watched it jump by 100 and had to guess.
     * The board already names every object; naming what each one is WORTH
     * costs no extra material and puts the answer where the question is.
     */
    note: 'ROUND AND CYAN. FALL, YOU RESTART HERE.  ' + CHECKPOINT_POINTS + ' POINTS',
    tone: MEANING.safe,
    sample: (at, rotation) => {
      const e = engine.addEntity()
      Transform.create(e, {
        position: at,
        rotation: Quaternion.multiply(rotation, Quaternion.fromEulerDegrees(SAMPLE_TILT, 0, 0)),
        scale: Vector3.create(0.6, 0.1, 0.6)
      })
      MeshRenderer.setCylinder(e)
      Material.setPbrMaterial(e, {
        albedoColor: Color4.fromHexString(MEANING.safe),
        emissiveColor: Color3.fromHexString(MEANING.safe),
        emissiveIntensity: 0,
        castShadows: false
      })
    }
  },
  {
    name: 'COIN',
    // Read from PICKUP_COUNT, never typed out.
    //
    // This line has now been wrong twice: it said EIGHT after the count went
    // to twelve, and TWELVE after it went to sixteen. A board whose whole job
    // is to explain the game cannot be a place where the game's own numbers
    // go stale, and a hand-written number in a legend is a promise to forget.
    note:
      'OPTIONAL. ' + PICKUP_COUNT + ' UP THERE, YOURS FOR GOOD.  ' +
      COIN_POINTS + ' POINTS',
    tone: MEANING.goal,
    sample: (at) => {
      const e = engine.addEntity()
      Transform.create(e, {
        position: at,
        rotation: Quaternion.fromEulerDegrees(90, 0, 0),
        scale: Vector3.create(0.44, 0.08, 0.44)
      })
      MeshRenderer.setCylinder(e)
      Material.setPbrMaterial(e, {
        albedoColor: Color4.fromHexString(MEANING.goal),
        emissiveColor: Color3.fromHexString(MEANING.goal),
        emissiveIntensity: 0,
        metallic: 0.6,
        roughness: 0.25,
        castShadows: false
      })
      legendCoin = e
    }
  },
  {
    name: 'CRUMBLING PAD',
    note: 'RUST ORANGE. IT DROPS A SECOND AFTER YOU LAND',
    // No price: you do not earn anything for surviving one, and pretending
    // otherwise would make the board a scoreboard instead of a legend.
    tone: MEANING.unstable,
    sample: (at, rotation) => {
      const e = engine.addEntity()
      Transform.create(e, {
        position: at,
        rotation: Quaternion.multiply(rotation, Quaternion.fromEulerDegrees(SAMPLE_TILT, 0, 0)),
        scale: Vector3.create(0.58, 0.12, 0.58)
      })
      MeshRenderer.setBox(e)
      Material.setPbrMaterial(e, {
        albedoColor: Color4.fromHexString(MEANING.unstable),
        emissiveColor: Color3.fromHexString(MEANING.unstable),
        emissiveIntensity: 0,
        castShadows: false
      })
    }
  },
  {
    name: 'SWEEPING BEAM',
    note: 'RED MEANS PAIN. IT PUTS YOU BACK A CHECKPOINT',
    tone: MEANING.hurts,
    sample: (at, rotation) => {
      const e = engine.addEntity()
      Transform.create(e, { position: at, rotation, scale: Vector3.create(0.78, 0.13, 0.13) })
      MeshRenderer.setBox(e)
      Material.setPbrMaterial(e, {
        albedoColor: Color4.fromHexString(MEANING.hurts),
        emissiveColor: Color3.fromHexString(MEANING.hurts),
        emissiveIntensity: 0,
        castShadows: false
      })
    }
  },
]

export function createLegend() {
  const rotation = Quaternion.fromEulerDegrees(0, LEGEND_YAW, 0)

  // Every layer is pushed clear of the one behind it, for the same reason the
  // leaderboard is: two surfaces sharing a plane z-fight and flicker.
  /**
   * The frame sits in the panel's OWN depth, not behind it.
   *
   * It used to be a slab centred 0.07 back, whose visible border ring was
   * therefore 0.11 m behind the face it framed. Head-on that is invisible.
   * Walk up to the board from the side - which is how everybody reaches it,
   * because it is turned to face the spawn - and the two layers slide apart:
   * the border goes fat on one edge and vanishes on the other, and the whole
   * thing reads as a sign someone knocked crooked. That is what a player
   * photographed and called crooked, and they were right about the symptom.
   *
   * Centred on the panel and made thicker instead, the border ring lands 0.02
   * behind the face rather than 0.11 - the same 5x cut in apparent shift, for
   * no extra material and no z-fighting.
   */
  const backing = engine.addEntity()
  Transform.create(backing, {
    position: Vector3.create(LEGEND_X, LEGEND_Y, LEGEND_Z),
    rotation,
    scale: Vector3.create(LEGEND_W + 0.22, LEGEND_H + 0.22, 0.10)
  })
  MeshRenderer.setBox(backing)
  Material.setPbrMaterial(backing, {
    albedoColor: Color4.fromHexString(FOREST.bark),
    metallic: 0,
    roughness: 0.9
  })

  const face = engine.addEntity()
  Transform.create(face, {
    position: Vector3.create(LEGEND_X, LEGEND_Y, LEGEND_Z),
    rotation,
    scale: Vector3.create(LEGEND_W, LEGEND_H, 0.14)
  })
  MeshRenderer.setBox(face)
  MeshCollider.setBox(face)
  Material.setPbrMaterial(face, { albedoColor: INK, metallic: 0, roughness: 0.95 })

  const headerY = LEGEND_Y + LEGEND_H / 2 - HEADER_H / 2 - 0.12
  const headerPos = onFace(0.09, 0)
  const headerBar = engine.addEntity()
  Transform.create(headerBar, {
    position: Vector3.create(headerPos.x, headerY, headerPos.z),
    rotation,
    scale: Vector3.create(LEGEND_W - 0.3, HEADER_H, 0.04)
  })
  MeshRenderer.setBox(headerBar)
  Material.setPbrMaterial(headerBar, {
    albedoColor: Color4.fromHexString(FOREST.canopyNear),
    emissiveColor: Color3.create(0.06, 0.14, 0.08),
    emissiveIntensity: 0.6,
    metallic: 0,
    roughness: 0.95
  })

  const heading = engine.addEntity()
  const headingPos = onFace(0.17, 0)
  Transform.create(heading, {
    position: Vector3.create(headingPos.x, headerY, headingPos.z),
    rotation
  })
  TextShape.create(heading, {
    text: 'WHAT YOU ARE LOOKING AT',
    fontSize: 3.2,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  // The crown has no sample on this board - it is the thing you are climbing
  // towards, not an object you meet on the way - so its price goes in a line
  // of its own under the rows.
  const footerY = headerY - HEADER_H / 2 - ROW_H * (ROWS.length + 0.35)
  const footerPos = onFace(0.17, -(LEGEND_W / 2 - 0.75))
  const footer = engine.addEntity()
  Transform.create(footer, {
    position: Vector3.create(footerPos.x, footerY, footerPos.z),
    rotation
  })
  TextShape.create(footer, {
    text: 'REACH THE CROWN:  ' + SUMMIT_POINTS + ' POINTS',
    fontSize: 1.5,
    textColor: Color4.fromHexString(MEANING.goal),
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_LEFT
  })

  /**
   * The one line on this board that is not about you.
   *
   * It sits under the footer rather than in the HUD on purpose. A permanent
   * HUD row is the thing this scene has already been told twice to stop doing
   * on a phone, and a shared counter is not something anybody needs while they
   * are mid-jump - it is something to read in the lobby, on the board that
   * already explains what a coin is.
   */
  const haulLine = engine.addEntity()
  const haulPos = onFace(0.17, -(LEGEND_W / 2 - 0.75))
  Transform.create(haulLine, {
    position: Vector3.create(haulPos.x, footerY - 0.62, haulPos.z),
    rotation
  })
  TextShape.create(haulLine, {
    text: '',
    fontSize: 1.35,
    textColor: DIM,
    outlineColor: Color4.Black(),
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_LEFT
  })
  legendHaul = haulLine

  const firstRowY = headerY - HEADER_H / 2 - ROW_H * 0.65
  const sampleAcross = -(LEGEND_W / 2 - 0.75)
  const textAcross = -(LEGEND_W / 2 - 1.55)

  /**
   * A recessed lane for the sample column.
   *
   * The samples were floating against the same flat panel as the text, at the
   * very edge of it, and the beam - the widest of them - looked like it was
   * hanging off the board. A darker inset behind them costs one material and
   * does two jobs: it gives the column a defined left margin, and it separates
   * the objects from the words so the eye reads two columns instead of one
   * ragged one.
   */
  const lanePos = onFace(0.05, sampleAcross)
  const lane = engine.addEntity()
  Transform.create(lane, {
    position: Vector3.create(lanePos.x, firstRowY - (ROWS.length - 1) * ROW_H / 2, lanePos.z),
    rotation,
    scale: Vector3.create(1.34, ROWS.length * ROW_H + 0.24, 0.04)
  })
  MeshRenderer.setBox(lane)
  Material.setPbrMaterial(lane, {
    albedoColor: Color4.create(0.07, 0.09, 0.14, 1),
    metallic: 0,
    roughness: 1,
    castShadows: false
  })

  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i]
    const y = firstRowY - i * ROW_H

    // Proud of the face, but not so proud it leaves the board.
    //
    // Flush against the panel the disc read as a painted dot - the exact
    // failure this board exists to fix, reproduced on the board itself - so it
    // was pushed out to 0.55. That overshot. The sample column sits at the far
    // left margin, and 0.55 of relief seen from 55 degrees off-axis throws it
    // 0.79 m sideways: past the panel edge at 2.8, hanging in open air. Every
    // approach to this board is off-axis, because it is turned towards the
    // spawn and reached from the lobby.
    //
    // 0.32 keeps the relief that makes a solid read solid and holds the swing
    // to 0.46 m, which stays on the panel from any angle a player can stand at.
    const at = onFace(0.32, sampleAcross)
    row.sample(Vector3.create(at.x, y, at.z), rotation)

    const textPos = onFace(0.17, textAcross)

    const name = engine.addEntity()
    Transform.create(name, {
      position: Vector3.create(textPos.x, y + 0.19, textPos.z),
      rotation
    })
    TextShape.create(name, {
      text: row.name,
      fontSize: 1.9,
      textColor: Color4.fromHexString(row.tone),
      outlineColor: Color4.Black(),
      outlineWidth: 0.25,
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT
    })

    const note = engine.addEntity()
    Transform.create(note, {
      position: Vector3.create(textPos.x, y - 0.19, textPos.z),
      rotation
    })
    TextShape.create(note, {
      text: row.note,
      fontSize: 1.35,
      textColor: DIM,
      outlineColor: Color4.Black(),
      outlineWidth: 0.2,
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT
    })
  }
}
