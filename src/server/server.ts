import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import {
  BOARD_SIZE,
  FINISH_RADIUS,
  PAD_RADIUS,
  GATE_DIR_X,
  GATE_DIR_Z,
  GATE_WIDTH,
  GATE_X,
  GATE_Z,
  RANKING_SECONDS,
  RANKING_SIZE,
  HEARTBEAT_SECONDS,
  STATS_FLUSH_SECONDS,
  COIN_RADIUS,
  GHOST_MAX_SAMPLES,
  GHOST_SAMPLE_SECONDS,
  WALL_SIZE,
  CHECKPOINT_POINTS,
  COIN_POINTS,
  SUMMIT_POINTS,
  PICKUP_GRACE,
  PICKUP_RADIUS,
  PLATE_RISE_RATE,
  PLATE_FALL_RATE
} from '../game/config'
import { buildTower, checkpointAltitudes } from '../game/layout'
import { room } from '../shared/messages'
import {
  Board,
  LeverState,
  PairBoard,
  Ranking,
  Ghost,
  Wall,
  PointsBoard,
  Haul,
  ServerHeartbeat,
  ShortcutState,
  TandemState
} from '../shared/schemas'

const STORAGE_KEY = 'obby.board.v2'
const PAIRS_KEY = 'obby.pairs.v1'
const PLAYER_KEY = 'obby.stats.v1'
const WALL_KEY = 'obby.wall.v1'
const HAUL_KEY = 'obby.haul.v1'
const POINTS_KEY = 'obby.points.v1'

type Scorer = { name: string; points: number }

type StoredHaul = { version: 1; coins: number }

/**
 * The recorded climb, kept in its own key.
 *
 * Everything else on this server was persisted and the ghost was not, which
 * meant the feature did not exist for the one player who matters most: the
 * server sleeps two minutes after the last person leaves, and the path lives
 * only in a synced component, so the FIRST visitor of the day - somebody
 * arriving at an empty world, exactly the case the ghost was built for - was
 * always the one person guaranteed to climb alone.
 *
 * Same class of bug as the coins that vanished on every sleep, and found the
 * same way: by asking what survives a restart instead of what works while the
 * server happens to be up.
 */
const GHOST_KEY = 'obby.ghost.v1'

type StoredGhost = { version: 1; name: string; seconds: number; path: number[] }

type Entry = { name: string; seconds: number }

/** Versioned from day one: storage outlives deploys, so old shapes will turn up. */
type PlayerStats = {
  version: number
  bestSeconds: number
  climbs: number
  /**
   * The highest this player has ever stood, in metres.
   *
   * Points used to come only from coins and summits, so a climber who fought
   * two thirds of the way up and never topped out scored nothing for it -
   * "points should count even if you do not reach the finish", and they are
   * right: the tower asks for a climb and then paid only for finishing it.
   *
   * A high-water mark rather than a tally of checkpoints banked. Counting
   * every banking would pay again for the same first ledge on every attempt;
   * counting the highest point ever reached pays once for ground genuinely
   * gained, and cannot be farmed by falling off on purpose.
   */
  bestHeight?: number
  /**
   * Indices of the optional pickups this player has ever found.
   *
   * Kept for good rather than per climb: the whole point of an optional
   * collection is that you can be missing pieces of it and come back. Written
   * on a find, which is at most PICKUP_COUNT writes in a player's lifetime -
   * nowhere near the storage write cap.
   */
  found?: number[]
}

/** Loaded once per player per session, then kept in memory. */
const stats = new Map<string, PlayerStats>()

/** Addresses are all the engine gives the server; names come from `hello`. */
const names = new Map<string, string>()

/**
 * When each player crossed the start line, by the server's clock.
 *
 * Timing everyone from the round's own start punishes anyone who walked into
 * the World halfway through it - and the scene has to work for people
 * arriving at any moment. The server watches the gate itself rather than
 * taking a client's word for when it started, since a client that reported
 * late would be handing itself a better time.
 */
const startedClimb = new Map<string, number>()

let state = engine.addEntity()
let board: Entry[] = []
let pairs: Entry[] = []

/**
 * Who you rode the tandem plate with, for the climb you are on right now.
 *
 * Written only when the plate reaches FULL lift, because that is the moment
 * two people actually got each other somewhere - standing on it together for
 * an instant is not cooperation. Cleared when the climb ends or is abandoned,
 * so a partnership cannot be banked and cashed in on a later solo run.
 */
const rodeWith = new Map<string, string>()

/**
 * The tower, generated once. It never changes, so regenerating it inside a
 * per-frame watcher was pure waste - buildTower() walks 132 pads.
 */
const tower = buildTower()

/** Who has taken the ante this climb. Cleared when their climb ends. */
const tookCoin = new Set<string>()

/** Climbers the server has invited to upload a path, because they lead today. */
const pendingGhost = new Map<string, { name: string; seconds: number }>()

/** Who last stood on the crown, newest first. Not sorted by time - see Wall. */
let wall: Entry[] = []

/** Coins given to the grove by everybody, ever. Nothing resets it. */
let haul = 0

/** Lifetime points, best per player. Coins found once each, plus summits. */
let scorers: Scorer[] = []
/**
 * Players whose in-memory stats have run ahead of what is on disk.
 *
 * The documented rule is that live state lives in memory and storage is
 * written at meaningful checkpoints, never per change.
 */
const dirtyStats = new Set<string>()

/**
 * The shared count rides the same debounced flush as the player stats.
 *
 * It was written inside persistBoard, which only runs on a FINISH - so a
 * player who collected coins and left without summiting handed the grove
 * nothing that survived the server going to sleep. That is the third time
 * this scene has lost state by writing it on the wrong event: the coins
 * themselves, then the ghost, now this. The rule that keeps falling over is
 * always the same one - persist where the value CHANGES, not where some
 * other value happens to be saved.
 */
let haulDirty = false

/**
 * The points board is written on the same debounced flush as everything else.
 *
 * It used to write inside rankScorer, which runs when a player crosses a
 * checkpoint altitude, picks up a coin, or finishes - so a busy tower fired a
 * storage write every few seconds per climber. Storage caps concurrent writes
 * and resolves the excess to `false` rather than throwing, and that call
 * discarded its result with `void`. The board that is meant to hold the best
 * scores OF ALL TIME would have stopped persisting under exactly the load it
 * exists for, and said nothing.
 */
let pointsDirty = false

/** Set when a leaderboard write fails, so the next flush tries it again. */
let boardsDirty = false
let flushTimer = 0

let heartbeatTimer = 0
let rankingTimer = 0

export async function startServer() {
  state = engine.addEntity()

  // Pulse once here so the first client to arrive does not wait a full interval
  // before it can tell the server is alive.
  ServerHeartbeat.create(state, { at: Date.now() })
  Board.create(state, { names: [], seconds: [] })
  PairBoard.create(state, { names: [], seconds: [] })
  Wall.create(state, { names: [], seconds: [] })
  PointsBoard.create(state, { names: [], points: [] })
  Haul.create(state, { coins: 0 })
  Ranking.create(state, { names: [], heights: [], climbers: 0 })
  ShortcutState.create(state, { open: false })
  LeverState.create(state, { halted: [] })
  TandemState.create(state, { lift: 0, riders: 0 })
  Ghost.create(state, { name: '', seconds: 0, path: [] })

  // Only the server calls syncEntity in an authoritative scene.
  syncEntity(state, [
    ServerHeartbeat.componentId,
    Board.componentId,
    PairBoard.componentId,
    Wall.componentId,
    PointsBoard.componentId,
    Haul.componentId,
    Ranking.componentId,
    ShortcutState.componentId,
    LeverState.componentId,
    TandemState.componentId,
    Ghost.componentId
  ])

  await restoreBoard()

  room.onMessage('claimFinish', (data, context) => {
    if (!context) return
    handleClaim(data.name, context.from)
  })

  // The coin is a claim like any other: the server knows where it hangs,
  // reads the player's verified position and decides. One per climb, and
  // only for somebody who actually crossed the gate.
  room.onMessage('claimCoin', (unused, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    if (!tower.coin || tookCoin.has(address)) return
    if (!startedClimb.has(address)) return

    const position = playerPosition(context.from)
    if (!position) return
    const at = Vector3.create(tower.coin.x, tower.coin.y, tower.coin.z)
    if (Vector3.distance(position, at) > COIN_RADIUS) {
      console.log('[SERVER] rejected coin claim from ' + context.from + ': too far')
      return
    }

    tookCoin.add(address)
    room.send('token', { skipsToCheckpoint: tower.coin.skipsToCheckpoint }, { to: [context.from] })
  })

  /**
   * A path arrives only from somebody who just took the top of today's board.
   * The server checks that itself rather than trusting the claim: `pendingGhost`
   * is set inside handleClaim and cleared here, so an unsolicited path is
   * dropped.
   */
  room.onMessage('ghostPath', (data, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    const pending = pendingGhost.get(address)
    if (!pending) return
    pendingGhost.delete(address)

    if (!Array.isArray(data.path) || data.path.length < 12 || data.path.length % 3 !== 0) return
    if (data.path.length > GHOST_MAX_SAMPLES * 3) return

    /**
     * Keep only the tail that the clock on THIS side actually timed.
     *
     * There are two independent clocks. The server times from the gate
     * crossing it saw itself, which is the number that reaches the board. The
     * client fills the path for as long as its own run phase lasts, and a
     * climber who crosses the gate, wanders, falls and finishes leaves those
     * two disagreeing - measured here at 349 samples, 174 seconds of path,
     * carrying a 6.2 second label. The mote then crawls the tower for three
     * minutes while the HUD advertises a six-second run.
     *
     * The last samples ARE the timed segment, so the tail is the honest part
     * of the recording and the rest is whatever happened before the stopwatch
     * started. Trimming it here is the one place both numbers exist together;
     * the client cannot do it, because the client does not know the time the
     * server recorded. Two samples of slack for the boundary.
     */
    const want = Math.ceil(pending.seconds / GHOST_SAMPLE_SECONDS) + 2
    const path = data.path.slice(Math.max(0, data.path.length - want * 3))
    if (path.length < 12 || path.length % 3 !== 0) return
    if (path.length < data.path.length) {
      console.log(
        '[SERVER] trimmed ghost path ' + data.path.length / 3 + ' -> ' + path.length / 3 +
          ' samples to match ' + pending.seconds.toFixed(1) + 's'
      )
    }

    const view = Ghost.getMutable(state)
    view.name = pending.name
    view.seconds = pending.seconds
    view.path = path
    console.log('[SERVER] ghost replaced by ' + pending.name + ' (' + pending.seconds.toFixed(1) + 's)')

    // Centimetres are all a translucent mote needs, and rounding here roughly
    // halves what goes into Storage.
    void saveGhost(
      pending.name,
      pending.seconds,
      path.map((v: number) => Math.round(v * 100) / 100)
    )
  })

  room.onMessage('takePickup', (data, context) => {
    if (!context) return
    void handlePickup(data.index, context.from)
  })

  room.onMessage('hello', (data, context) => {
    if (!context) return
    names.set(context.from.toLowerCase(), data.name.slice(0, 24) || 'Guest')
    void sendStats(context.from)
  })

  engine.addSystem(serverSystem)
  console.log('[SERVER] tower ready - ' + tower.pads.length + ' pads')
}

/** Heartbeat and the round clock. Everything else is event driven. */
function serverSystem(dt: number) {
  heartbeatTimer += dt
  if (heartbeatTimer >= HEARTBEAT_SECONDS) {
    heartbeatTimer = 0
    ServerHeartbeat.getMutable(state).at = Date.now()
  }

  // Read with getOrNull. getMutableOrNull marks the component dirty on every
  // single frame, which re-broadcasts the whole round state ~30 times a second
  // to every player.
  // Every frame, unlike the ranking: sampling the gate once a second would
  // hand everyone up to a second of free time off their climb.
  watchGate()
  watchShortcutPads()
  watchLevers()
  watchPlate(dt)

  flushTimer += dt
  if (flushTimer >= STATS_FLUSH_SECONDS) {
    flushTimer = 0
    void flushStats()
  }

  rankingTimer += dt
  if (rankingTimer >= RANKING_SECONDS) {
    rankingTimer = 0
    publishRanking()
  }

}

/**
 * Nothing resets at midnight any more.
 *
 * The daily board emptied itself every UTC midnight, and so did the grove's
 * coin count with it. What that looked like from inside the game: a player
 * finished, went to show somebody, and the table was blank by the time they
 * came back - blank for everybody, with no explanation on the board itself.
 *
 * Asked for plainly: it should not reset. The monument ranks all time now,
 * both halves of it, and the day stamp is gone along with the reset it drove.
 */

/**
 * A claim is only ever a claim. The server knows where the crown is - it runs
 * the same deterministic generator the clients do - reads the player's
 * verified position, and decides for itself.
 */
function handleClaim(name: string, from: string) {
  const address = from.toLowerCase()

  // No gate crossing, no climb. This also stops a repeat claim from the same
  // standing position: the crossing is cleared the moment a summit lands, so
  // a second claim has nothing to time from.
  const began = startedClimb.get(address)
  if (began === undefined) return

  const position = playerPosition(from)
  if (!position) return

  const finish = finishOf()
  if (!finish) return
  if (Vector3.distance(position, finish) > FINISH_RADIUS) {
    console.log('[SERVER] rejected finish claim from ' + from + ': too far from the crown')
    return
  }

  const seconds = (Date.now() - began) / 1000
  const entry: Entry = { name: name.slice(0, 24) || 'Guest', seconds }

  // Fastest first on both boards - one tower means one number to beat, which
  // is the entire reason the rotating rounds had to go.
  const record = board.length === 0 || seconds < board[0].seconds
  board = [...board, entry].sort((a, b) => a.seconds - b.seconds).slice(0, BOARD_SIZE)

  // The crown's list is the one place a slow climber can appear, so it is
  // ordered by WHEN and not by how fast. One row per person: without the
  // filter a single player practising fills all ten and the wall stops being
  // a record of anybody having been here but them.
  wall = [entry, ...wall.filter((seen) => seen.name !== entry.name)].slice(0, WALL_SIZE)
  publishBoard()

  // A pair time is the point of the whole game, so it gets its own board.
  // The partner's name comes from the server's own name map, never from the
  // claiming client - otherwise anyone could type a stranger onto a record.
  const partner = rodeWith.get(address)
  if (partner) {
    const together: Entry = {
      name: entry.name + '  +  ' + (names.get(partner) ?? 'Guest'),
      seconds
    }
    pairs = [...pairs, together].sort((a, b) => a.seconds - b.seconds).slice(0, BOARD_SIZE)
  }

  // They have to walk back through the gate to start another climb.
  startedClimb.delete(address)
  tookCoin.delete(address)
  rodeWith.delete(address)

  // Only the day's leader gets asked for a path, so the ghost is always the
  // run people are actually chasing.
  // The ghost follows the ALL-TIME leader now that there is no daily board.
  if (board.length > 0 && board[0] === entry) {
    pendingGhost.set(address, { name: entry.name, seconds })
  }

  room.send('summit', { name, seconds, record })
  void persistBoard()
  void recordClimb(from, seconds)
}

/**
 * A pickup claim, checked the same way a finish is: the server knows where
 * every pickup hangs, reads the player's verified position, and decides.
 *
 * Nothing about the climb depends on this. It does not gate the finish, it
 * does not appear on any board, and taking none of them is a complete way to
 * play the tower.
 */
async function handlePickup(index: number, from: string) {
  const address = from.toLowerCase()
  const pickup = tower.pickups[index]
  if (!pickup) return

  const position = playerPosition(from)
  if (!position) return

  const at = Vector3.create(pickup.x, pickup.y, pickup.z)
  if (Vector3.distance(position, at) > PICKUP_RADIUS + PICKUP_GRACE) {
    console.log('[SERVER] rejected pickup ' + index + ' from ' + from + ': too far')
    return
  }

  const mine = await loadStats(address)
  const found = mine.found ?? []
  if (found.includes(index)) return

  found.push(index)
  mine.found = found

  /**
   * The shared count moves on a FIRST find, which is the only kind there is.
   *
   * A coin is remembered against the player forever, so a climber returning
   * to a tower they have already stripped adds nothing here - by design, and
   * worth saying out loud: today's haul is what NEW hands brought in, not a
   * measure of traffic. That is why the target is exactly one player's worth
   * (see HAUL_TARGET) rather than a number scaled to a crowd nobody can
   * promise will show up.
   */
  rankScorer(names.get(address) ?? 'Guest', mine)

  haul += 1
  haulDirty = true
  Haul.getMutable(state).coins = haul

  /**
   * A collection you can finish, and nothing happened when you finished it.
   *
   * Sixteen coins, a counter in the corner, and the sixteenth played the same
   * blip as the first. The tower asked for a thing and never acknowledged
   * being given it.
   *
   * Broadcast rather than answered privately, for the same reason a summit is:
   * it is one of the very few things one player can learn about another in a
   * world they are probably alone in. It can fire at most once per player -
   * every coin is already found by the time the count is reached, so no
   * further claim from them gets this far.
   */
  if (found.length >= tower.pickups.length) {
    room.send('collected', { name: names.get(address) ?? 'Guest' })
    console.log('[SERVER] ' + address + ' has found every coin')
  }

  // Answered BEFORE the write. A storage call that stalls must not hold up
  // the one piece of feedback the player is waiting for; the find is already
  // true in memory, and the write is what makes it survive a restart.
  room.send('pickups', { found }, { to: [from] })

  // Marked for a later write instead of written here.
  //
  // A write per find looked fine and was not: collecting eight in a row fires
  // eight Storage.set calls inside a couple of seconds, the isolate's
  // in-flight host-call cap swallows the excess, and Storage.set returns false
  // rather than throwing. Nothing on the server or the client notices - the
  // counter is served from memory, so it keeps saying 8/8 - and the loss only
  // shows the next time the server actually restarts. Found by reading the
  // storage file and seeing no `found` key at all.
  dirtyStats.add(address)
  console.log('[SERVER] ' + address + ' found pickup ' + index + ' (' + found.length + ' total)')
}

/**
 * Who is highest right now, read straight from the engine. This is the whole
 * social hook: you can see the people you are racing without asking them.
 */
function publishRanking() {
  const climbers: { name: string; height: number }[] = []
  const present = new Set<string>()

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address.toLowerCase()
    present.add(address)

    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    climbers.push({
      name: names.get(address) ?? 'Guest',
      height: transform.position.y
    })

    // The ranking already reads every player's height every tick, so the
    // high-water mark costs nothing extra. Re-ranked only when a new
    // checkpoint altitude is actually cleared, not on every centimetre.
    const mine = stats.get(address)
    if (mine && transform.position.y > (mine.bestHeight ?? 0)) {
      const before = scoreOf(mine)
      mine.bestHeight = transform.position.y
      dirtyStats.add(address)
      if (scoreOf(mine) !== before) rankScorer(names.get(address) ?? 'Guest', mine)
    }
  }

  // This server stays up as long as anyone is in the World, so anything keyed
  // by visitor has to be dropped when they go, or it grows for days.
  forget(names, present)
  forget(stats, present)
  forget(startedClimb, present)
  forgetSet(tookCoin, present)
  forget(pendingGhost, present)

  climbers.sort((a, b) => b.height - a.height)
  const top = climbers.slice(0, RANKING_SIZE)

  const view = Ranking.getMutable(state)
  view.names = top.map((climber) => climber.name)
  view.heights = top.map((climber) => Math.round(climber.height))
  view.climbers = climbers.length
}

/**
 * A lever pad stops its section's beam while anybody stands on it.
 *
 * Unlike the bypass this is not gated on two people: one player can hold it for
 * everyone else, and a player alone can still beat the beam by timing it. It is
 * a favour you can do for strangers, not a lock.
 */
function watchLevers() {
  const view = LeverState.getOrNull(state)
  if (!view) return

  const levers = tower.levers
  if (levers.length === 0) {
    if (view.halted.length > 0) LeverState.getMutable(state).halted = []
    return
  }

  const halted: number[] = []
  for (const lever of levers) {
    for (const [entity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const transform = Transform.getOrNull(entity)
      if (transform && near(transform.position, lever)) {
        halted.push(lever.section)
        break
      }
    }
  }

  // Only write when it actually changed: this runs every frame.
  const same = halted.length === view.halted.length && halted.every((s, i) => s === view.halted[i])
  if (!same) LeverState.getMutable(state).halted = halted
}

/**
 * The bypass opens only while two DIFFERENT people hold the two pads.
 *
 * The server does this itself from engine-read positions. TriggerArea is a
 * client-side collision feature and the headless server has no renderer, so a
 * trigger could only ever be a hint from a client - and this is exactly the
 * kind of state a client would want to lie about.
 */
function watchShortcutPads() {
  const shortcut = tower.shortcut
  const view = ShortcutState.getOrNull(state)
  if (!shortcut || !view) {
    if (view && view.open) ShortcutState.getMutable(state).open = false
    return
  }

  let onA: string | null = null
  let onB: string | null = null

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    const address = identity.address.toLowerCase()
    if (!onA && near(transform.position, shortcut.padA)) onA = address
    else if (!onB && near(transform.position, shortcut.padB)) onB = address
  }

  const open = onA !== null && onB !== null && onA !== onB
  const held = (onA !== null ? 1 : 0) + (onB !== null ? 1 : 0)
  // Written only on a change: this runs every frame, and a component write
  // re-broadcasts the whole thing to every client.
  if (view.open !== open || view.held !== held) {
    const mutable = ShortcutState.getMutable(state)
    mutable.open = open
    mutable.held = held
  }
}

function near(position: Vector3, pad: { x: number; y: number; z: number }): boolean {
  return Math.hypot(position.x - pad.x, position.z - pad.z) < PAD_RADIUS && Math.abs(position.y - pad.y) < 3
}

/** Watches every player for the moment they step past the start line. */
function watchGate() {
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address.toLowerCase()
    const transform = Transform.getOrNull(entity)
    if (!transform) continue

    if (startedClimb.has(address)) {
      abandonIfBackAtTheStart(address, transform.position)
      continue
    }

    noteGateCrossing(address, transform.position)
  }
}

/**
 * Walking back behind the gate abandons the climb, and the next crossing
 * starts a fresh one.
 *
 * Without this a retry was timed from the FIRST gate crossing: the client
 * reset its own clock and sent the player to the lobby, the server kept the
 * original stamp, and the board recorded a time that included the attempt
 * they gave up on. The HUD and the leaderboard disagreed, and the leaderboard
 * was the one that was wrong.
 *
 * Decided from the player's engine-verified position rather than from a
 * message, so a client cannot abandon a climb it is losing and quietly keep
 * the better start time.
 */
function abandonIfBackAtTheStart(address: string, position: Vector3) {
  const dx = position.x - GATE_X
  const dz = position.z - GATE_Z
  if (dx * GATE_DIR_X + dz * GATE_DIR_Z > -1) return

  startedClimb.delete(address)
  tookCoin.delete(address)
  // The partnership belongs to the climb, not to the player: walking back
  // through the gate must not carry a pair credit into the next attempt.
  rodeWith.delete(address)
}

/** Records the first moment a player is past the gate plane, inside its width. */
function noteGateCrossing(address: string, position: Vector3) {
  if (startedClimb.has(address)) return

  const dx = position.x - GATE_X
  const dz = position.z - GATE_Z
  if (dx * GATE_DIR_X + dz * GATE_DIR_Z <= 0) return
  if (Math.abs(dx * -GATE_DIR_Z + dz * GATE_DIR_X) > GATE_WIDTH) return

  startedClimb.set(address, Date.now())
}

/** Drops cache entries for players who have left. */
function forget<T>(cache: Map<string, T>, present: Set<string>) {
  if (cache.size <= present.size) return
  for (const address of cache.keys()) {
    if (!present.has(address)) cache.delete(address)
  }
}

/** Same prune, for the caches that only need membership. */
function forgetSet(cache: Set<string>, present: Set<string>) {
  if (cache.size <= present.size) return
  for (const address of cache) {
    if (!present.has(address)) cache.delete(address)
  }
}

/** Server-verified position: read from the engine, never from the client. */
function playerPosition(address: string): Vector3 | null {
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address.toLowerCase() !== address.toLowerCase()) continue
    const transform = Transform.getOrNull(entity)
    return transform ? transform.position : null
  }
  return null
}

/** Where the crown is. One tower, so this never changes. */
function finishOf(): Vector3 | null {
  const pad = tower.pads.find((candidate) => candidate.kind === 'finish')
  return pad ? Vector3.create(pad.x, pad.y, pad.z) : null
}

/**
 * The plate rises only with two DIFFERENT people aboard, and sinks the moment
 * it is down to one. It moves at a fixed rate rather than snapping, so a
 * climber can see it responding to the person who just stepped on.
 */
function watchPlate(dt: number) {
  const plate = tower.plate
  const view = TandemState.getOrNull(state)
  if (!plate || !view) return

  const aboard = new Set<string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const transform = Transform.getOrNull(entity)
    if (!transform) continue
    const deck = plate.y + view.lift * plate.rise
    if (
      Math.abs(transform.position.x - plate.x) < plate.size / 2 + 0.4 &&
      Math.abs(transform.position.z - plate.z) < plate.size / 2 + 0.4 &&
      Math.abs(transform.position.y - deck) < 2.2
    ) {
      aboard.add(identity.address.toLowerCase())
    }
  }

  const target = aboard.size >= 2 ? 1 : 0
  const speed = target > view.lift ? PLATE_RISE_RATE : PLATE_FALL_RATE
  const next = Math.max(0, Math.min(1, view.lift + Math.sign(target - view.lift) * speed * dt))

  // Full lift with two aboard is the moment the partnership is earned.
  if (next >= 1 && aboard.size >= 2) {
    const riders = [...aboard]
    for (const rider of riders) {
      const partner = riders.find((other) => other !== rider)
      if (partner) rodeWith.set(rider, partner)
    }
  }

  // Written only on a real change: this runs every frame and a component write
  // re-broadcasts to every client.
  if (Math.abs(next - view.lift) > 0.002 || view.riders !== aboard.size) {
    const mutable = TandemState.getMutable(state)
    mutable.lift = next
    mutable.riders = aboard.size
  }
}

function publishBoard() {
  const together = PairBoard.getMutable(state)
  together.names = pairs.map((entry) => entry.name)
  together.seconds = pairs.map((entry) => entry.seconds)

  const all = Board.getMutable(state)
  all.names = board.map((entry) => entry.name)
  all.seconds = board.map((entry) => entry.seconds)


  Haul.getMutable(state).coins = haul

  const ranked = PointsBoard.getMutable(state)
  ranked.names = scorers.map((entry) => entry.name)
  ranked.points = scorers.map((entry) => entry.points)

  const crown = Wall.getMutable(state)
  crown.names = wall.map((entry) => entry.name)
  crown.seconds = wall.map((entry) => entry.seconds)
}

/**
 * A player's own history. This is the reason to come back: the shared board
 * resets with the world, a personal best does not.
 */
async function sendStats(address: string) {
  const mine = await loadStats(address)
  room.send(
    'stats',
    { bestSeconds: mine.bestSeconds, climbs: mine.climbs, found: mine.found ?? [] },
    { to: [address] }
  )
}

/**
 * Addresses arrive with inconsistent casing, so every cache key is lowered at
 * the boundary. Mixing the two spellings meant the ranking prune deleted stats
 * on every tick while the cache itself never hit.
 */
async function loadStats(rawAddress: string): Promise<PlayerStats> {
  const address = rawAddress.toLowerCase()
  const cached = stats.get(address)
  if (cached) return cached

  /**
   * Rebuilt from the stored record FIELD BY FIELD used to be the shape of
   * this, and that is what lost the coins: the reader copied bestSeconds and
   * climbs, `found` was added to the type later, and nobody came back here.
   * Every cold start then handed out a record with no coins and the next
   * write persisted that over the real list.
   *
   * Starting from the stored object and repairing it means a field added to
   * PlayerStats survives by default. Forgetting to ADD a line can no longer
   * silently delete a player's data; the worst a future field can do is
   * arrive unvalidated.
   */
  let fresh: PlayerStats = { version: 1, bestSeconds: 0, climbs: 0 }
  try {
    const stored = decoded<PlayerStats>(await Storage.player.get<unknown>(rawAddress, PLAYER_KEY))
    if (stored && stored.version === 1) {
      fresh = { ...stored, version: 1 }
      if (typeof fresh.bestSeconds !== 'number') fresh.bestSeconds = 0
      if (typeof fresh.climbs !== 'number') fresh.climbs = 0
      fresh.found = Array.isArray(fresh.found)
        ? fresh.found.filter((n) => typeof n === 'number')
        : undefined
    }
  } catch (error) {
    console.log('[SERVER] stats unreadable for ' + address + ': ' + error)
  }

  stats.set(address, fresh)
  return fresh
}

/**
 * Writes every player whose stats have moved since the last flush.
 *
 * One write per player per interval, however many coins they picked up in it.
 * A failed write leaves the player marked, so the next flush tries again
 * rather than losing the find silently.
 */
/**
 * Recomputes one player's standing on the points board.
 *
 * Lifetime, not per run: every coin is worth its price once, every summit
 * worth its own. Checkpoints are deliberately absent - they are scored inside
 * a climb and reset with it, so counting them here would pay a player again
 * for ground they already banked.
 *
 * One row per name. A player who climbs twice replaces their own row rather
 * than filling the board with themselves, which is the same rule the crown's
 * wall of names uses and for the same reason.
 */
function scoreOf(mine: PlayerStats): number {
  const reached = checkpointAltitudes(tower).filter(
    (altitude) => (mine.bestHeight ?? 0) >= altitude - 1
  ).length
  return (
    (mine.found?.length ?? 0) * COIN_POINTS +
    mine.climbs * SUMMIT_POINTS +
    reached * CHECKPOINT_POINTS
  )
}

function rankScorer(name: string, mine: PlayerStats) {
  const points = scoreOf(mine)
  if (points <= 0) return
  const label = name.slice(0, 24) || 'Guest'
  scorers = [{ name: label, points }, ...scorers.filter((s) => s.name !== label)]
    .sort((a, b) => b.points - a.points)
    .slice(0, BOARD_SIZE)
  publishBoard()
  pointsDirty = true
}

async function flushStats() {
  if (haulDirty) {
    haulDirty = false
    const ok = await Storage.set<StoredHaul>(HAUL_KEY, {
      version: 1,
      coins: haul
    })
    // Left marked on failure, exactly like a player's stats, so the next
    // flush tries again instead of dropping the day's count in silence.
    if (!ok) {
      haulDirty = true
      console.log("[SERVER] today's haul did not persist, will retry")
    }
  }

  if (pointsDirty) {
    pointsDirty = false
    const ok = await Storage.set<{ version: 1; board: Scorer[] }>(POINTS_KEY, {
      version: 1,
      board: scorers
    })
    // Marked again on failure so the next flush retries, the same way the
    // haul and a player's own stats do.
    if (!ok) {
      pointsDirty = true
      console.log('[SERVER] points board did not persist, will retry')
    }
  }

  if (boardsDirty) {
    boardsDirty = false
    await persistBoard()
  }

  if (dirtyStats.size === 0) return
  const pending = [...dirtyStats]
  dirtyStats.clear()

  for (const address of pending) {
    const mine = stats.get(address)
    if (!mine) continue
    const ok = await Storage.player.set<PlayerStats>(address, PLAYER_KEY, mine)
    if (!ok) {
      console.log('[SERVER] stats did not persist for ' + address + ', will retry')
      dirtyStats.add(address)
    }
  }
}

/** Written on a finish only - one write per climb, never per tick. */
async function recordClimb(address: string, seconds: number) {
  const mine = await loadStats(address)

  mine.climbs += 1
  if (mine.bestSeconds === 0 || seconds < mine.bestSeconds) mine.bestSeconds = seconds
  rankScorer(names.get(address) ?? 'Guest', mine)

  const ok = await Storage.player.set<PlayerStats>(address, PLAYER_KEY, mine)
  if (!ok) {
    // A finish is the single most valuable write a player makes - the climb
    // count and the personal best both live in it. Retried, not just logged.
    dirtyStats.add(address)
    console.log('[SERVER] stats did not persist for ' + address + ', will retry')
  }

  room.send(
    'stats',
    { bestSeconds: mine.bestSeconds, climbs: mine.climbs, found: mine.found ?? [] },
    { to: [address] }
  )
}

/**
 * Storage returns exactly what was written, parsing nothing of its own - the
 * SDK's scene store hands back `data.value` untouched. The server always
 * writes objects, but `sdk-commands storage scene set` can only ever write a
 * STRING: its `--value` is a command-line argument, placed in the request body
 * verbatim. So any key repaired by hand from a terminal comes back as JSON
 * TEXT, every `stored.version !== 1` guard below rejects it, and the board
 * restores empty with no error anywhere.
 *
 * That is not hypothetical. Clearing one player from the leaderboard by hand
 * is what silently emptied the all-time board of its only surviving entry.
 * Accepting both shapes costs one branch and turns an out-of-band write back
 * into a repair instead of a way to erase a board.
 */
function decoded<T>(raw: unknown): T | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    } catch (error) {
      console.log('[SERVER] stored text is not JSON: ' + error)
      return null
    }
  }
  return (raw as T) ?? null
}

type Stored = { version: number; board: Entry[] }

/**
 * Written only when a round is won, never per tick: storage writes are capped.
 *
 * A win is nonetheless the busiest instant this server has - three board
 * writes here, the finisher's own stats, and any coin flush still pending -
 * which is precisely the burst that makes a capped write resolve to `false`.
 * Each failure used to be a log line and nothing else, so the run that earned
 * the record was the run most likely to lose it. Now a failure marks the
 * boards dirty and the next flush writes them again.
 */
async function persistBoard() {
  let failed = false

  const ok = await Storage.set<Stored>(STORAGE_KEY, { version: 1, board })
  if (!ok) {
    failed = true
    console.log('[SERVER] all-time board did not persist, will retry')
  }

  const okWall = await Storage.set<Stored>(WALL_KEY, { version: 1, board: wall })
  if (!okWall) {
    failed = true
    console.log('[SERVER] crown wall did not persist, will retry')
  }

  const okPairs = await Storage.set<Stored>(PAIRS_KEY, { version: 1, board: pairs })
  if (!okPairs) {
    failed = true
    console.log('[SERVER] pair board did not persist, will retry')
  }

  boardsDirty = failed
}

/**
 * Parsed defensively and versioned from day one: storage survives redeploys,
 * so a future shape change will meet data written by an older build.
 */
async function restoreBoard() {
  try {
    const stored = decoded<Stored>(await Storage.get<unknown>(STORAGE_KEY))
    if (!stored || stored.version !== 1 || !Array.isArray(stored.board)) return

    board = stored.board
      .filter((entry) => typeof entry?.name === 'string' && typeof entry?.seconds === 'number')
      .slice(0, BOARD_SIZE)
    console.log('[SERVER] restored ' + board.length + ' all-time entries')
  } catch (error) {
    console.log('[SERVER] stored board unreadable, starting empty: ' + error)
  }


  try {
    const stored = decoded<Stored>(await Storage.get<unknown>(PAIRS_KEY))
    if (stored && stored.version === 1 && Array.isArray(stored.board)) {
      pairs = stored.board
        .filter((entry) => typeof entry?.name === 'string' && typeof entry?.seconds === 'number')
        .slice(0, BOARD_SIZE)
      console.log('[SERVER] restored ' + pairs.length + ' pair entries')
    }
  } catch (error) {
    console.log('[SERVER] stored pair board unreadable: ' + error)
  }

  try {
    const stored = decoded<{ version: number; board: Scorer[] }>(await Storage.get<unknown>(POINTS_KEY))
    if (stored && stored.version === 1 && Array.isArray(stored.board)) {
      scorers = stored.board
        .filter((e) => typeof e?.name === 'string' && typeof e?.points === 'number')
        .slice(0, BOARD_SIZE)
      console.log('[SERVER] restored ' + scorers.length + ' on the points board')
    }
  } catch (error) {
    console.log('[SERVER] stored points board unreadable: ' + error)
  }

  try {
    const stored = decoded<StoredHaul>(await Storage.get<unknown>(HAUL_KEY))
    if (stored && stored.version === 1 && typeof stored.coins === 'number') {
      // No day check any more. It used to drop the count whenever the server
      // first booted on a new date, which is the same silent midnight reset
      // the board had - just less visible, because nobody watches a number
      // going back to zero as closely as they watch their name leaving a list.
      haul = Math.max(0, Math.floor(stored.coins))
      console.log('[SERVER] restored ' + haul + ' coins given to the grove')
    }
  } catch (error) {
    console.log('[SERVER] stored haul unreadable: ' + error)
  }

  try {
    const stored = decoded<Stored>(await Storage.get<unknown>(WALL_KEY))
    if (stored && stored.version === 1 && Array.isArray(stored.board)) {
      wall = stored.board
        .filter((entry) => typeof entry?.name === 'string' && typeof entry?.seconds === 'number')
        .slice(0, WALL_SIZE)
      console.log('[SERVER] restored ' + wall.length + ' names on the crown')
    }
  } catch (error) {
    console.log('[SERVER] stored crown wall unreadable: ' + error)
  }

  await restoreGhost()

  publishBoard()
}

async function saveGhost(name: string, seconds: number, path: number[]) {
  const ok = await Storage.set<StoredGhost>(GHOST_KEY, { version: 1, name, seconds, path })
  if (!ok) console.log('[SERVER] ghost path did not persist')
}

/**
 * The stored ghost is NOT re-checked against today's board.
 *
 * It is invited from whoever takes the top of the day, so while the server is
 * up it does track today's leader - but a restored one may well be from
 * yesterday, and dropping it for that reason would put us straight back to an
 * empty world for the first arrival. So nothing here claims which board it
 * topped: the client shows the name and the time, which are true whenever the
 * run happened, and a climber gets somebody to chase either way.
 */
async function restoreGhost() {
  try {
    const stored = decoded<StoredGhost>(await Storage.get<unknown>(GHOST_KEY))
    if (!stored || stored.version !== 1) return
    if (typeof stored.name !== 'string' || typeof stored.seconds !== 'number') return
    if (!Array.isArray(stored.path)) return

    const path = stored.path.filter((v) => typeof v === 'number' && isFinite(v))
    if (path.length !== stored.path.length) return
    if (path.length < 12 || path.length % 3 !== 0) return
    if (path.length > GHOST_MAX_SAMPLES * 3) return

    const view = Ghost.getMutable(state)
    view.name = stored.name
    view.seconds = stored.seconds
    view.path = path
    console.log(
      '[SERVER] restored ghost: ' + stored.name + ' (' + stored.seconds.toFixed(1) + 's, ' +
        path.length / 3 + ' samples)'
    )
  } catch (error) {
    console.log('[SERVER] stored ghost unreadable: ' + error)
  }
}
