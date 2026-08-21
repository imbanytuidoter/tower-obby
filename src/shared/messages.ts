import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

/**
 * Client-to-server and server-to-client messages.
 *
 * registerMessages defines a component internally, so this module must be
 * reached by a static import before the engine seals. Never import it lazily.
 */
export const room = registerMessages({
  /**
   * "I am standing on the finish pad." The client never reports a time or a
   * position - the server reads the player's verified Transform itself and
   * decides whether the claim is true.
   */
  claimFinish: Schemas.Map({
    round: Schemas.Int,
    /** Cosmetic only - it labels a row on the board, it never sets a score. */
    name: Schemas.String
  }),
  /** Server tells everyone who closed the round out. */
  roundWon: Schemas.Map({
    name: Schemas.String,
    seconds: Schemas.Float
  }),
  /** "I have arrived, send me my saved record." */
  hello: Schemas.Map({
    ping: Schemas.Int
  }),
  /** Sent back to that one player: their history, restored from storage. */
  stats: Schemas.Map({
    bestSeconds: Schemas.Float,
    climbs: Schemas.Int
  })
})
