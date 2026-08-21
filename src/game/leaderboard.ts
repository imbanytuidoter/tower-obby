import { getPlayer } from '@dcl/sdk/players'
import { TOTAL_ROUNDS } from './config'

export type Entry = {
  round: number
  time: number
  falls: number
  name: string
}

/**
 * This player's own best per round, used for the HUD's BEST line.
 *
 * The shared leaderboard is server-owned and lives in the Board component -
 * it is not maintained here. An earlier version broadcast records over
 * MessageBus, which constructs at module scope and throws
 * "RemoteError: not implemented" on the headless server.
 */
const best = new Map<number, Entry>()

export function playerName(): string {
  const player = getPlayer()
  if (!player || !player.name) return 'Guest'
  return player.name
}

/** Stores a personal result. Returns true if it beat this player's own best. */
export function submit(round: number, time: number, falls: number): boolean {
  return record({ round, time, falls, name: playerName() })
}

function record(entry: Entry): boolean {
  const current = best.get(entry.round)
  if (current && current.time <= entry.time) return false
  best.set(entry.round, entry)
  return true
}

export function bestFor(round: number): Entry | undefined {
  return best.get(round)
}

/** One row per round, always all TOTAL_ROUNDS of them so the board keeps its shape. */
export function rows(): { round: number; entry: Entry | undefined }[] {
  const list: { round: number; entry: Entry | undefined }[] = []
  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    list.push({ round, entry: best.get(round) })
  }
  return list
}

export function clearedRounds(): number {
  return best.size
}

/** Total of every cleared round, or null until all of them are done. */
export function totalTime(): number | null {
  if (best.size < TOTAL_ROUNDS) return null
  let sum = 0
  for (const entry of best.values()) sum += entry.time
  return sum
}
