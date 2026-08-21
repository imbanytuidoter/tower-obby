import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

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

export function setupSound() {
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
