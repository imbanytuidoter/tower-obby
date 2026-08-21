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

export function prepareRound(totalCheckpoints: number, sections: string[]) {
  run.phase = Phase.Ready
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
  run.choices = []
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
