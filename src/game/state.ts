import { CHECKPOINT_POINTS, COIN_POINTS, SUMMIT_POINTS } from './config'
export enum Phase {
  Ready = 'ready',
  Running = 'running',
  RoundDone = 'roundDone',
  AllDone = 'allDone'
}

export const run = {
  phase: Phase.Ready as Phase,
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
  /** Which of the four bands the climber is in. Replaces a tutorial panel. */
  band: 'UNDERSTORY',
  /** Optional pickups: how many this player has ever found, out of how many. */
  pickupsFound: 0,
  pickupsTotal: 0,
  /**
   * Coins banked during THIS climb, as opposed to ever.
   *
   * Separate because the two answer different questions: the lifetime count
   * is what the collection is worth, and this is what the run is worth. A
   * player who has all sixteen still scores nothing extra for a lap.
   */
  pickupsThisRun: 0,
  /** Filled from the server-owned component. */
  serverAlive: false,
  /** Fastest climb today, and the fastest anyone has ever done it. */
  dailyBest: 0,
  towerRecord: 0,
  /** Restored from the server's per-player storage, survives everything. */
  personalBest: 0,
  climbs: 0,
  /** Who is highest in the tower right now, straight from the server. */
  ranking: [] as { name: string; height: number }[],
  /** Everyone in the World, including those below the top three. */
  climbers: 0,
  /** How many of the two co-op pads are occupied, server-counted. */
  shortcutHeld: 0,
  /** How many people are standing on the tandem plate right now. */
  plateRiders: 0,
  /** How far the plate has lifted, 0 to 1, from the server. */
  plateLift: 0,
  /**
   * The skip token, granted by the server when it verifies you reached the
   * coin. Held, not spent, until the player decides where it is worth using.
   */
  token: 0,
  tokenSkipsTo: 0,
  /** This climb's path, sampled for the ghost. */
  path: [] as number[],
  /** Who set the ghost, and in what time. */
  ghostName: '',
  ghostSeconds: 0,
  /**
   * The decisions this run made, in the order they were made.
   *
   * A time on its own says nothing about how it was earned. Naming the
   * choices back at the finish - "played it safe, +3.7s" - is what turns a
   * result into a reason to climb again.
   */
  choices: [] as { zone: number; bold: boolean; delta: number }[],
  /** A line about something another player just did. Fades on its own. */
  announcement: '',
  announcementFor: 0
}

/**
 * What this attempt is worth so far.
 *
 * Checkpoints count every climb because banking one is the thing a beginner
 * can actually do; coins count only the ones taken on THIS run, so a player
 * who already owns all sixteen gains nothing for walking past them; and the
 * summit lands once, at the end.
 */
export function runScore(): number {
  return (
    run.checkpoint * CHECKPOINT_POINTS +
    run.pickupsThisRun * COIN_POINTS +
    (run.phase === Phase.RoundDone || run.phase === Phase.AllDone ? SUMMIT_POINTS : 0)
  )
}

/**
 * Everything this wallet has ever earned.
 *
 * Derived from the two numbers the server already persists rather than kept
 * as a third: a stored total is a number that can drift out of step with the
 * things it is supposed to total, and this one cannot.
 */
export function lifetimeScore(): number {
  return run.pickupsFound * COIN_POINTS + run.climbs * SUMMIT_POINTS
}

export function prepareRound(totalCheckpoints: number, sections: string[]) {
  run.phase = Phase.Ready
  run.time = 0
  run.falls = 0
  run.checkpoint = 0
  run.totalCheckpoints = totalCheckpoints
  run.respawnCooldown = 0
  run.lastWasBest = false
  run.pickupsThisRun = 0
  run.prompt = ''
  run.section = 1
  run.totalSections = sections.length
  run.sectionName = sections[0] ?? ''
  run.choices = []
  run.token = 0
  run.tokenSkipsTo = 0
  run.path = []
}

export function startClock() {
  run.phase = Phase.Running
}

export function completeRound(wasBest: boolean) {
  run.lastWasBest = wasBest
  run.phase = Phase.RoundDone
}

/** Shows a line about someone else for a few seconds, then clears itself. */
export function announce(text: string, seconds = 5) {
  run.announcement = text
  run.announcementFor = seconds
}

export function tickAnnouncement(dt: number) {
  if (run.announcementFor <= 0) return
  run.announcementFor -= dt
  if (run.announcementFor <= 0) run.announcement = ''
}
