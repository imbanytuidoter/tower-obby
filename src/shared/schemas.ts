import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

/**
 * Proof the server is awake, and the anchor every client uses to find the
 * shared state entity. Its own component because it ticks every couple of
 * seconds and a component is re-sent whole on every change.
 */
export const ServerHeartbeat = engine.defineComponent('obby::heartbeat', {
  at: Schemas.Int64
})

/**
 * Who is highest in the tower right now. Rewritten about once a second, so it
 * is its own component - bundling it with the board would resend the board on
 * every tick.
 */
export const Ranking = engine.defineComponent('obby::ranking', {
  names: Schemas.Array(Schemas.String),
  heights: Schemas.Array(Schemas.Float),
  /**
   * Everyone in the World right now, not just the three shown. A player alone
   * on a tower has no way to tell whether the place is dead or whether the
   * others are simply below them, and that is the difference between staying
   * and leaving.
   */
  climbers: Schemas.Int
})

/**
 * Whether the co-op bypass is currently open. The server decides: a client
 * cannot be trusted to say two people are standing on two pads.
 */
export const ShortcutState = engine.defineComponent('obby::shortcut', {
  open: Schemas.Boolean,
  /**
   * How many of the two pads are occupied. `open` alone cannot distinguish
   * "nobody has found this" from "somebody is standing here waiting for you",
   * and only the second one is worth telling a player about.
   */
  held: Schemas.Int
})

/** Sections whose beam is currently held still by somebody on a lever pad. */
export const LeverState = engine.defineComponent('obby::levers', {
  halted: Schemas.Array(Schemas.Int)
})

/** The ten fastest climbs ever recorded on this tower. Survives restarts. */
export const Board = engine.defineComponent('obby::board', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float)
})

/**
 * The ten fastest climbs today, cleared at midnight UTC.
 *
 * The all-time board is unreachable for somebody who arrived an hour ago, and
 * a target nobody can hit is a target nobody looks at. A board that empties
 * every night is winnable tonight - which is the actual reason to come back
 * tomorrow.
 */
export const DailyBoard = engine.defineComponent('obby::daily', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float),
  /** UTC day number this board belongs to, so clients can spot a rollover. */
  day: Schemas.Int
})

/**
 * Only the server may write any of this. Guarded by isServer() because
 * validateBeforeChange has no meaning on a client and errors there.
 */
export function protectServerState() {
  if (!isServer()) return

  const serverOnly = (value: { senderAddress: string }) =>
    value.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()

  Ranking.validateBeforeChange(serverOnly)
  ShortcutState.validateBeforeChange(serverOnly)
  LeverState.validateBeforeChange(serverOnly)
  ServerHeartbeat.validateBeforeChange(serverOnly)
  Board.validateBeforeChange(serverOnly)
  DailyBoard.validateBeforeChange(serverOnly)
}
