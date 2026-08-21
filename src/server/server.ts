import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import {
  BOARD_SIZE,
  FINISH_RADIUS,
  RANKING_SECONDS,
  RANKING_SIZE,
  HEARTBEAT_SECONDS,
  ROUND_SECONDS,
  TOTAL_ROUNDS
} from '../game/config'
import { buildLayout } from '../game/layout'
import { room } from '../shared/messages'
import { Board, Ranking, RoundState, ServerHeartbeat } from '../shared/schemas'

const STORAGE_KEY = 'obby.board.v1'
const PLAYER_KEY = 'obby.stats.v1'

type Entry = { name: string; seconds: number; round: number }

/** Versioned from day one: storage outlives deploys, so old shapes will turn up. */
type PlayerStats = { version: number; bestSeconds: number; climbs: number }

/** Loaded once per player per session, then kept in memory. */
const stats = new Map<string, PlayerStats>()

/** Addresses are all the engine gives the server; names come from `hello`. */
const names = new Map<string, string>()

let state = engine.addEntity()
let board: Entry[] = []
let heartbeatTimer = 0
let rankingTimer = 0

export async function startServer() {
  state = engine.addEntity()

  RoundState.create(state, { round: 1, startedAt: Date.now(), endsAt: Date.now() + ROUND_SECONDS * 1000 })
  // Pulse once here so the first client to arrive does not wait a full interval
  // before it can tell the server is alive.
  ServerHeartbeat.create(state, { at: Date.now() })
  Board.create(state, { names: [], seconds: [], rounds: [] })
  Ranking.create(state, { names: [], heights: [] })

  // Only the server calls syncEntity in an authoritative scene.
  syncEntity(state, [
    RoundState.componentId,
    ServerHeartbeat.componentId,
    Board.componentId,
    Ranking.componentId
  ])

  await restoreBoard()

  room.onMessage('claimFinish', (data, context) => {
    if (!context) return
    handleClaim(data.round, data.name, context.from)
  })

  room.onMessage('hello', (data, context) => {
    if (!context) return
    names.set(context.from.toLowerCase(), data.name.slice(0, 24) || 'Guest')
    void sendStats(context.from)
  })

  engine.addSystem(serverSystem)
  console.log('[SERVER] obby ready, round 1')
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
  rankingTimer += dt
  if (rankingTimer >= RANKING_SECONDS) {
    rankingTimer = 0
    publishRanking()
  }

  const current = RoundState.getOrNull(state)
  if (!current) return
  if (Date.now() < current.endsAt) return

  advance(current.round)
}

/**
 * A claim is only ever a claim. The server finds where the finish pad of that
 * round actually is - using the same deterministic generator the clients run -
 * reads the player's verified position, and decides for itself.
 */
function handleClaim(round: number, name: string, from: string) {
  const current = RoundState.getOrNull(state)
  if (!current || round !== current.round) return

  const position = playerPosition(from)
  if (!position) return

  const finish = finishOf(current.round)
  if (!finish) return
  if (Vector3.distance(position, finish) > FINISH_RADIUS) {
    console.log('[SERVER] rejected finish claim from ' + from + ': too far from the pad')
    return
  }

  const seconds = (Date.now() - current.startedAt) / 1000
  board.unshift({ name: name.slice(0, 24) || 'Guest', seconds, round: current.round })
  board = board.slice(0, BOARD_SIZE)
  publishBoard()

  room.send('roundWon', { name, seconds })
  advance(current.round)
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

  climbers.sort((a, b) => b.height - a.height)
  const top = climbers.slice(0, RANKING_SIZE)

  const view = Ranking.getMutable(state)
  view.names = top.map((climber) => climber.name)
  view.heights = top.map((climber) => Math.round(climber.height))
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

function finishOf(round: number): Vector3 | null {
  const pad = buildLayout(round).pads.find((candidate) => candidate.kind === 'finish')
  return pad ? Vector3.create(pad.x, pad.y, pad.z) : null
}

function advance(from: number) {
  const next = from >= TOTAL_ROUNDS ? 1 : from + 1
  const now = Date.now()
  const current = RoundState.getMutable(state)
  current.round = next
  current.startedAt = now
  current.endsAt = now + ROUND_SECONDS * 1000
  console.log('[SERVER] round ' + next + ' started')
}

function publishBoard() {
  const view = Board.getMutable(state)
  view.names = board.map((entry) => entry.name)
  view.seconds = board.map((entry) => entry.seconds)
  view.rounds = board.map((entry) => entry.round)
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

/** Written only when a round is won, never per tick: storage writes are capped. */
async function persistBoard() {
  const ok = await Storage.set<Stored>(STORAGE_KEY, { version: 1, board })
  if (!ok) console.log('[SERVER] board did not persist')
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
    publishBoard()
    console.log('[SERVER] restored ' + board.length + ' board entries')
  } catch (error) {
    console.log('[SERVER] stored board unreadable, starting empty: ' + error)
  }
}
