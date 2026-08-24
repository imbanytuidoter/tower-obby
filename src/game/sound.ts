import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { FOREST_FADE_HEIGHT, FOREST_STEPS, FOREST_VOLUME } from './config'

/**
 * Short feedback sounds, taken from the Decentraland asset packs and stored in
 * assets/sounds. They play `global`, so the volume does not fall off with
 * distance: these are feedback about what just happened to you, not objects
 * in the world that you walk towards.
 */
export type Cue = 'start' | 'checkpoint' | 'fall' | 'finish'

const CLIPS: Record<Cue, { file: string; volume: number }> = {
  start: { file: 'assets/sounds/start.mp3', volume: 0.7 },
  checkpoint: { file: 'assets/sounds/checkpoint.mp3', volume: 0.8 },
  fall: { file: 'assets/sounds/fall.mp3', volume: 0.6 },
  finish: { file: 'assets/sounds/finish.mp3', volume: 0.8 }
}

const speakers = new Map<Cue, Entity>()

/**
 * The forest, heard from inside it.
 *
 * Global rather than spatial, with the volume driven by hand from the
 * player's height. AudioSource is spatial by default, but its falloff curve
 * is not documented anywhere - min and max distance are fields on AudioStream
 * and VideoPlayer, not on this - so relying on it would mean relying on
 * behaviour nobody wrote down, and the failure mode is silence.
 *
 * `volume` IS documented, so the fade is done there: birds at the clearing
 * floor, thinning as the climb rises out of the understory, and all but gone
 * at the crown. Which is what happens when you climb a tree.
 */
let forest: Entity | null = null

export function setupSound() {
  forest = engine.addEntity()
  Transform.create(forest, { position: Vector3.create(0, 0, 0) })
  AudioSource.create(forest, {
    audioClipUrl: 'assets/sounds/forest.mp3',
    playing: true,
    loop: true,
    volume: FOREST_VOLUME,
    global: true
  })

  for (const cue of Object.keys(CLIPS) as Cue[]) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(0, 0, 0) })
    AudioSource.create(entity, {
      audioClipUrl: CLIPS[cue].file,
      playing: false,
      loop: false,
      volume: CLIPS[cue].volume,
      global: true
    })
    speakers.set(cue, entity)
  }
}

/**
 * Rewinds to the start before playing. Without resetting currentTime a cue
 * that fires twice in a row is silent the second time, because the clip is
 * already sitting at its end.
 */
export function play(cue: Cue) {
  const entity = speakers.get(cue)
  if (!entity) return

  const source = AudioSource.getMutable(entity)
  source.playing = false
  source.currentTime = 0
  source.playing = true
}


/**
 * Thins the birdsong with altitude. Called from the client's frame system.
 *
 * Quantised to a few steps rather than written every frame: AudioSource is a
 * synced component, and a volume rewritten sixty times a second is sixty
 * component writes a second for something an ear cannot hear changing.
 */
let lastStep = -1

export function fadeForest(playerY: number) {
  if (!forest) return

  const t = Math.min(1, Math.max(0, playerY / FOREST_FADE_HEIGHT))
  const step = Math.round((1 - t) * FOREST_STEPS)
  if (step === lastStep) return
  lastStep = step

  AudioSource.getMutable(forest).volume = (step / FOREST_STEPS) * FOREST_VOLUME
}
