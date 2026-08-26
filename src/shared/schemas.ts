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

/**
 * The tandem plate: how far it has lifted, and how many are aboard.
 *
 * Server-owned for the same reason the bypass is - a client asked "are two
 * people standing here?" would be asked to report on somebody else, which is
 * exactly the question a client should never be trusted with.
 */
export const TandemState = engine.defineComponent('obby::tandem', {
  /** 0 to 1. Clients interpolate the plate's transform from this. */
  lift: Schemas.Float,
  riders: Schemas.Int
})

/**
 * The ghost: the path of today's fastest climb, replayed for everyone.
 *
 * "Your run becomes a lobby ghost, so leaving still leaves something behind."
 * It is stored flat - x, y, z, x, y, z - because an array of Vector3 costs
 * more to serialise than three floats do, and this component is written once
 * per record rather than per frame.
 */
export const Ghost = engine.defineComponent('obby::ghost', {
  name: Schemas.String,
  seconds: Schemas.Float,
  path: Schemas.Array(Schemas.Float)
})

/**
 * The last climbers to reach the crown, newest first.
 *
 * Not the fastest - that is what the two boards in the lobby are for. This is
 * who was HERE, which is the only list a slow player can ever appear on, and
 * the whole point of carrying it to the top is that you read it standing where
 * they stood.
 */
export const Wall = engine.defineComponent('obby::wall', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float)
})

/**
 * Coins given to the grove today, by everybody, together.
 *
 * The one number in this scene that nobody owns. Every other count is yours -
 * your time, your coins, your climbs - and a player alone reads all of them
 * as proof that they are alone. This one arrives already moved.
 */
export const Haul = engine.defineComponent('obby::haul', {
  coins: Schemas.Int
})

/**
 * Who has earned the most points, ever.
 *
 * The tower had one board and it ranked speed, which rewards exactly one way
 * to play: run it, run it faster. Coins and checkpoints were given prices and
 * then nothing kept score of them past the run that earned them - so the
 * collecting half of the game had no memory and no ladder.
 *
 * Points are lifetime: every coin found once, every summit reached. A player
 * who explores slowly can top this board without ever troubling the other one.
 */
export const PointsBoard = engine.defineComponent('obby::points', {
  names: Schemas.Array(Schemas.String),
  points: Schemas.Array(Schemas.Int)
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
 * The fastest climbs made as a PAIR.
 *
 * This is the board the game is actually about. The tandem plate only rises
 * with two different people standing on it, so a pair time is proof that two
 * strangers cooperated - which is the one thing a solo obby cannot record.
 * Names are stored already joined ("alice + bob") so the board stays a flat
 * pair of arrays like the other two and needs no extra schema.
 */
export const PairBoard = engine.defineComponent('obby::pairs', {
  names: Schemas.Array(Schemas.String),
  seconds: Schemas.Array(Schemas.Float)
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
  TandemState.validateBeforeChange(serverOnly)
  Ghost.validateBeforeChange(serverOnly)
  ServerHeartbeat.validateBeforeChange(serverOnly)
  Board.validateBeforeChange(serverOnly)
  DailyBoard.validateBeforeChange(serverOnly)
  PairBoard.validateBeforeChange(serverOnly)
  Wall.validateBeforeChange(serverOnly)
  PointsBoard.validateBeforeChange(serverOnly)
  Haul.validateBeforeChange(serverOnly)
}
