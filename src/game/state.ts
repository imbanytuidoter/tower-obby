import { TOTAL_ROUNDS } from './config'

export enum Phase {
  Ready = 'ready',
  Running = 'running',
  RoundDone = 'roundDone',
  AllDone = 'allDone'
}

export const run = {
  phase: Phase.Ready as Phase,
  round: 1,
  time: 0,
  falls: 0,
  checkpoint: 0,
  totalCheckpoints: 0,
  respawnCooldown: 0,
  lastWasBest: false,
  /** Contextual line shown when the player nears a gate. Empty means hidden. */
  prompt: '',
  /** Which stacked section the player is climbing, and what it is called. */
  section: 1,
  totalSections: 1,
  sectionName: '',
  /** Shared-round facts, filled from the server-owned component. */
  serverAlive: false,
  roundEndsIn: 0,
  /** Restored from the server's per-player storage, survives everything. */
  personalBest: 0,
  climbs: 0
}

export function prepareRound(round: number, totalCheckpoints: number, sections: string[]) {
  run.phase = Phase.Ready
  run.round = round
  run.time = 0
  run.falls = 0
  run.checkpoint = 0
  run.totalCheckpoints = totalCheckpoints
  run.respawnCooldown = 0
  run.lastWasBest = false
  run.prompt = ''
  run.section = 1
  run.totalSections = sections.length
  run.sectionName = sections[0] ?? ''
}

export function startClock() {
  run.phase = Phase.Running
}

export function completeRound(wasBest: boolean) {
  run.lastWasBest = wasBest
  run.phase = run.round >= TOTAL_ROUNDS ? Phase.AllDone : Phase.RoundDone
}
