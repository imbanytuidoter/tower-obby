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
  PLATE_RISE_RATE,
  PLATE_FALL_RATE
} from '../game/config'
import { buildTower } from '../game/layout'
import { room } from '../shared/messages'
import {
  Board,
  DailyBoard,
  LeverState,
  Ranking,
  ServerHeartbeat,
  ShortcutState,
  TandemState
} from '../shared/schemas'

const STORAGE_KEY = 'obby.board.v2'
const DAILY_KEY = 'obby.daily.v1'
const PLAYER_KEY = 'obby.stats.v1'

type Entry = { name: string; seconds: number }

/** Whole days since the epoch, UTC. The daily board resets when this changes. */
function utcDay(at: number): number {
  return Math.floor(at / 86400000)
}

/** Versioned from day one: storage outlives deploys, so old shapes will turn up. */
type PlayerStats = { version: number; bestSeconds: number; climbs: number }

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
let daily: Entry[] = []

/**
 * The tower, generated once. It never changes, so regenerating it inside a
 * per-frame watcher was pure waste - buildTower() walks 132 pads.
 */
const tower = buildTower()
let heartbeatTimer = 0
let rankingTimer = 0

export async function startServer() {
  state = engine.addEntity()

  // Pulse once here so the first client to arrive does not wait a full interval
  // before it can tell the server is alive.
  ServerHeartbeat.create(state, { at: Date.now() })
  Board.create(state, { names: [], seconds: [] })
  DailyBoard.create(state, { names: [], seconds: [], day: utcDay(Date.now()) })
  Ranking.create(state, { names: [], heights: [], climbers: 0 })
  ShortcutState.create(state, { open: false })
  LeverState.create(state, { halted: [] })
  TandemState.create(state, { lift: 0, riders: 0 })

  // Only the server calls syncEntity in an authoritative scene.
  syncEntity(state, [
    ServerHeartbeat.componentId,
    Board.componentId,
    DailyBoard.componentId,
    Ranking.componentId,
    ShortcutState.componentId,
    LeverState.componentId,
    TandemState.componentId
  ])

  await restoreBoard()

  room.onMessage('claimFinish', (data, context) => {
    if (!context) return
    handleClaim(data.name, context.from)
  })

  room.onMessage('hello', (data, context) => {
    if (!context) return
    names.set(context.from.toLowerCase(), data.name.slice(0, 24) || 'Guest')
    void sendStats(context.from)
  })

  engine.addSystem(serverSystem)
  console.log('[SERVER] tower ready - ' + buildTower().pads.length + ' pads')
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

  rankingTimer += dt
  if (rankingTimer >= RANKING_SECONDS) {
    rankingTimer = 0
    publishRanking()
  }

  rolloverDailyBoard()
}

/**
 * Midnight UTC empties the daily board. Checked every frame because the server
 * can stay up for days, so a rollover will land mid-session.
 */
function rolloverDailyBoard() {
  const view = DailyBoard.getOrNull(state)
  if (!view) return

  const today = utcDay(Date.now())
  if (view.day === today) return

  daily = []
  const mutable = DailyBoard.getMutable(state)
  mutable.names = []
  mutable.seconds = []
  mutable.day = today
  console.log('[SERVER] daily board reset for day ' + today)
  void Storage.set(DAILY_KEY, JSON.stringify({ day: today, entries: [] }))
}

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
  daily = [...daily, entry].sort((a, b) => a.seconds - b.seconds).slice(0, BOARD_SIZE)
  publishBoard()

  // They have to walk back through the gate to start another climb.
  startedClimb.delete(address)

  room.send('summit', { name, seconds, record })
  void persistBoard()
  void recordClimb(from, seconds)
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
  }

  // This server stays up as long as anyone is in the World, so anything keyed
  // by visitor has to be dropped when they go, or it grows for days.
  forget(names, present)
  forget(stats, present)
  forget(startedClimb, present)

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
    if (startedClimb.has(address)) continue

    const transform = Transform.getOrNull(entity)
    if (transform) noteGateCrossing(address, transform.position)
  }
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

  // Written only on a real change: this runs every frame and a component write
  // re-broadcasts to every client.
  if (Math.abs(next - view.lift) > 0.002 || view.riders !== aboard.size) {
    const mutable = TandemState.getMutable(state)
    mutable.lift = next
    mutable.riders = aboard.size
  }
}

function publishBoard() {
  const all = Board.getMutable(state)
  all.names = board.map((entry) => entry.name)
  all.seconds = board.map((entry) => entry.seconds)

  const today = DailyBoard.getMutable(state)
  today.names = daily.map((entry) => entry.name)
  today.seconds = daily.map((entry) => entry.seconds)
}

/**
 * A player's own history. This is the reason to come back: the shared board
 * resets with the world, a personal best does not.
 */
async function sendStats(address: string) {
  const mine = await loadStats(address)
  room.send('stats', { bestSeconds: mine.bestSeconds, climbs: mine.climbs }, { to: [address] })
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

  const fresh: PlayerStats = { version: 1, bestSeconds: 0, climbs: 0 }
  try {
    const stored = await Storage.player.get<PlayerStats>(rawAddress, PLAYER_KEY)
    if (stored && stored.version === 1 && typeof stored.bestSeconds === 'number') {
      fresh.bestSeconds = stored.bestSeconds
      fresh.climbs = typeof stored.climbs === 'number' ? stored.climbs : 0
    }
  } catch (error) {
    console.log('[SERVER] stats unreadable for ' + address + ': ' + error)
  }

  stats.set(address, fresh)
  return fresh
}

/** Written on a finish only - one write per climb, never per tick. */
async function recordClimb(address: string, seconds: number) {
  const mine = await loadStats(address)

  mine.climbs += 1
  if (mine.bestSeconds === 0 || seconds < mine.bestSeconds) mine.bestSeconds = seconds

  const ok = await Storage.player.set<PlayerStats>(address, PLAYER_KEY, mine)
  if (!ok) console.log('[SERVER] stats did not persist for ' + address)

  room.send('stats', { bestSeconds: mine.bestSeconds, climbs: mine.climbs }, { to: [address] })
}

type Stored = { version: number; board: Entry[] }
type StoredDaily = { version: number; day: number; board: Entry[] }

/** Written only when a round is won, never per tick: storage writes are capped. */
async function persistBoard() {
  const ok = await Storage.set<Stored>(STORAGE_KEY, { version: 1, board })
  if (!ok) console.log('[SERVER] all-time board did not persist')

  // Kept in its own key with the day stamped on it, so a server that boots
  // the next morning restores an empty board rather than yesterday's times.
  const okDaily = await Storage.set<StoredDaily>(DAILY_KEY, {
    version: 1,
    day: utcDay(Date.now()),
    board: daily
  })
  if (!okDaily) console.log('[SERVER] daily board did not persist')
}

/**
 * Parsed defensively and versioned from day one: storage survives redeploys,
 * so a future shape change will meet data written by an older build.
 */
async function restoreBoard() {
  try {
    const stored = await Storage.get<Stored>(STORAGE_KEY)
    if (!stored || stored.version !== 1 || !Array.isArray(stored.board)) return

    board = stored.board
      .filter((entry) => typeof entry?.name === 'string' && typeof entry?.seconds === 'number')
      .slice(0, BOARD_SIZE)
    console.log('[SERVER] restored ' + board.length + ' all-time entries')
  } catch (error) {
    console.log('[SERVER] stored board unreadable, starting empty: ' + error)
  }

  try {
    const stored = await Storage.get<StoredDaily>(DAILY_KEY)
    if (stored && stored.version === 1 && Array.isArray(stored.board)) {
      if (stored.day === utcDay(Date.now())) {
        daily = stored.board
          .filter((entry) => typeof entry?.name === 'string' && typeof entry?.seconds === 'number')
          .slice(0, BOARD_SIZE)
        console.log('[SERVER] restored ' + daily.length + " of today's entries")
      } else {
        console.log('[SERVER] stored daily board is from another day, starting empty')
      }
    }
  } catch (error) {
    console.log('[SERVER] stored daily board unreadable: ' + error)
  }

  const view = DailyBoard.getOrNull(state)
  if (view) DailyBoard.getMutable(state).day = utcDay(Date.now())
  publishBoard()
}
