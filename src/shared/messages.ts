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
    /** Cosmetic only - it labels a row on the board, it never sets a score. */
    name: Schemas.String
  }),
  /**
   * Somebody has found every coin in the tower. Announced to everyone.
   *
   * A summit is the loud event; this is the quiet one, and it is the only
   * thing here that rewards exploring rather than climbing fast. Fires at
   * most once per player - by the time the count is reached every coin is
   * already spent for them, so no later claim gets far enough to send it.
   */
  collected: Schemas.Map({
    name: Schemas.String
  }),
  /** Somebody reached the crown. Announced to everyone, wherever they are. */
  summit: Schemas.Map({
    name: Schemas.String,
    seconds: Schemas.Float,
    /** True when this climb is the fastest anyone has ever done it. */
    record: Schemas.Boolean
  }),
  /** "I am standing at the coin." The server checks where the player is. */
  claimCoin: Schemas.Map({}),
  /** Server grants the skip token, and says which checkpoint it is worth. */
  token: Schemas.Map({
    skipsToCheckpoint: Schemas.Int
  }),
  /**
   * The path of a climb, sent once when it lands on the board. Flat floats
   * rather than Vector3s: a 200-second run at two samples a second is 1200
   * numbers, about 4.8 KB, comfortably inside the 13 KB message ceiling.
   */
  ghostPath: Schemas.Map({
    path: Schemas.Array(Schemas.Float)
  }),
  /** "I have arrived, send me my saved record." */
  hello: Schemas.Map({
    /** Cosmetic label for the live ranking; the server has only addresses. */
    name: Schemas.String
  }),
  /**
   * "I touched pickup number n." The server checks the distance itself, the
   * same way it checks a finish - a client that could name its own pickups
   * could name all eight from the lobby.
   */
  takePickup: Schemas.Map({
    index: Schemas.Int
  }),
  /**
   * Which pickups this player has ever found. Sent on arrival and after each
   * one, so a returning player sees the ones they are still missing.
   */
  pickups: Schemas.Map({
    found: Schemas.Array(Schemas.Int)
  }),
  /**
   * Sent back to that one player: their history, restored from storage.
   *
   * The pickup list rides along here rather than in its own handshake message.
   * It had one, answered once to `hello` with no retry, and a single dropped
   * packet left the player with no counter and no way to ask again. This one
   * is already retried until it arrives.
   */
  stats: Schemas.Map({
    bestSeconds: Schemas.Float,
    climbs: Schemas.Int,
    found: Schemas.Array(Schemas.Int)
  })
})
