import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { Storage } from '@dcl/sdk/server'
import {
  BOARD_SIZE,
  FINISH_RADIUS,
  HEARTBEAT_SECONDS,
  ROUND_SECONDS,
  TOTAL_ROUNDS
} from '../game/config'
import { buildLayout } from '../game/layout'
import { room } from '../shared/messages'
import { Board, RoundState, ServerHeartbeat } from '../shared/schemas'

const STORAGE_KEY = 'obby.board.v1'

type Entry = { name: string; seconds: number; round: number }

let state = engine.addEntity()
let board: Entry[] = []
let heartbeatTimer = 0

export async function startServer() {
  state = engine.addEntity()

  RoundState.create(state, { round: 1, startedAt: Date.now(), endsAt: Date.now() + ROUND_SECONDS * 1000 })
  // Pulse once here so the first client to arrive does not wait a full interval
  // before it can tell the server is alive.
  ServerHeartbeat.create(state, { at: Date.now() })
  Board.create(state, { names: [], seconds: [], rounds: [] })

  // Only the server calls syncEntity in an authoritative scene.
  syncEntity(state, [RoundState.componentId, ServerHeartbeat.componentId, Board.componentId])

  await restoreBoard()

  room.onMessage('claimFinish', (data, context) => {
    if (!context) return
    handleClaim(data.round, data.name, context.from)
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

  const current = RoundState.getMutableOrNull(state)
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
