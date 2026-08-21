import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

/**
 * The round everyone is climbing. The tower is generated from the round
 * number alone and the generator is deterministic, so broadcasting this one
 * integer is enough for every player to build the identical course.
 */
export const RoundState = engine.defineComponent('obby::roundState', {
  round: Schemas.Int,
  /** Server clock, milliseconds. Timestamps need Int64, not Number. */
  startedAt: Schemas.Int64,
  endsAt: Schemas.Int64
})

/**
 * Kept apart from RoundState on purpose: a component is sent whole on every
 * change, and this one ticks every couple of seconds.
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
  heights: Schemas.Array(Schemas.Float)
})

/**
 * Whether the co-op bypass is currently open. The server decides: a client
 * cannot be trusted to say two people are standing on two pads.
 */
export const ShortcutState = engine.defineComponent('obby::shortcut', {
  open: Schemas.Boolean
})

/** Best times of the current session, newest winner first. */
export const Board = engine.defineComponent('obby::board', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float),
  rounds: Schemas.Array(Schemas.Int)
})

/**
 * Only the server may write any of this. Guarded by isServer() because
 * validateBeforeChange has no meaning on a client and errors there.
 */
export function protectServerState() {
  if (!isServer()) return

  const serverOnly = (value: { senderAddress: string }) =>
    value.senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID.toLowerCase()

  RoundState.validateBeforeChange(serverOnly)
  Ranking.validateBeforeChange(serverOnly)
  ShortcutState.validateBeforeChange(serverOnly)
  ServerHeartbeat.validateBeforeChange(serverOnly)
  Board.validateBeforeChange(serverOnly)
}
