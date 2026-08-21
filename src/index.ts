import { engine, MeshCollider, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer, isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
// Static, never lazy: registerMessages and defineComponent must both run
// during module load, before the engine seals.
import { room } from './shared/messages'
import {
  Board,
  DailyBoard,
  protectServerState,
  LeverState,
  Ranking,
  ServerHeartbeat,
  ShortcutState
} from './shared/schemas'
import {
  CHECKPOINT_RADIUS,
  GATE_DIR_X,
  GATE_DIR_Z,
  GATE_WIDTH,
  GATE_X,
  GATE_Z,
  LOBBY_SPAWN_X,
  LOBBY_SPAWN_Z,
  LOBBY_Y,
  PAD_RADIUS,
  PROMPT_RANGE,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  FALL_GRACE,
  FINISH_TOUCH_RISE,
  HAZARD_HALF_WIDTH,
  RESPAWN_COOLDOWN,
  RESPAWN_LIFT,
  HEARTBEAT_SECONDS
} from './game/config'
import {
  activateCheckpoint,
  buildWorld,
  clearWorld,
  paintCrumbled,
  paintCrumbling,
  paintGlow,
  paintPad,
  PAD_TOP,
  sectionAccent,
  setShortcutOpen,
  World
} from './game/build'
import { applyFairness, freezeAfterFall } from './game/fairness'
import { formatTime } from './game/format'
import { buildTower } from './game/layout'
import { buildPlaza, decorSystem, GATE_LOOK, refreshBoard, showBoard } from './game/plaza'
import { play, setupSound } from './game/sound'
import { announce, completeRound, Phase, prepareRound, run, startClock, tickAnnouncement } from './game/state'
import { setupUi } from './ui'

let world: World | null = null

export function main() {
  protectServerState()

  if (isServer()) {
    // Only the server branch may pull in @dcl/sdk/server, and it defines no
    // components of its own, so importing it after the seal is safe.
    import('./server/server')
      .then((module) => module.startServer())
      .catch((error) => console.log('[SERVER] failed to start: ' + error))
    return
  }

  startClient()
}

function startClient() {
  applyFairness()

  // Built once and shared: the plaza needs the opening jump to size the
  // warm-up pad, and buildWorld needs the whole thing.
  const layout = buildTower()
  const firstPad = layout.pads[1]
  const fromPad = layout.pads[firstPad ? firstPad.fromIndex : 0] ?? layout.pads[0]
  buildPlaza({
    gap:
      firstPad && fromPad
        ? Math.hypot(firstPad.x - fromPad.x, firstPad.z - fromPad.z) -
          (firstPad.size + fromPad.size) / 2
        : 2,
    size: fromPad ? fromPad.size : 3
  })
  setupSound()
  setupUi({ next: () => {}, retry: retryClimb, restart: retryClimb })
  buildTheTower()

  engine.addSystem(hazardSystem, 1, 'hazardSystem')
  engine.addSystem(runSystem, 2, 'runSystem')
  engine.addSystem(decorSystem, 3, 'decorSystem')
  engine.addSystem(sharedRoundSystem, 4, 'sharedRoundSystem')
  engine.addSystem(helloSystem, 5, 'helloSystem')

  // Somebody else topping out ends the round for everyone. Without this the
  // tower simply vanishes and you are back in the lobby with no explanation.
  // The round keeps running after somebody tops out, so this is news about a
  // rival rather than a signal that everything is over. Saying which place
  // they took is what makes a second and third summit worth chasing.
  // Every summit is announced to the whole World, wherever the listener is on
  // the tower. It is the cheapest possible proof that the place is inhabited.
  room.onMessage('summit', (data) => {
    announce(
      data.record
        ? data.name + ' set a new tower record - ' + formatTime(data.seconds)
        : data.name + ' reached the crown in ' + formatTime(data.seconds)
    )
    play('finish')
  })

  room.onMessage('stats', (data) => {
    run.personalBest = data.bestSeconds
    run.climbs = data.climbs
    greeted = true
  })
}


/**
 * Asks the server for this player's saved record, and keeps asking.
 *
 * A message sent before the room is synced is silently dropped, and a cold
 * server takes ~15s to boot, so a single send on startup would leave a player
 * who arrived first with no record at all.
 */
let greeted = false
let helloTimer = 0

function helloSystem(dt: number) {
  if (greeted) return

  helloTimer -= dt
  if (helloTimer > 0) return
  helloTimer = 2

  if (!isStateSyncronized()) return
  const profile = getPlayer()
  room.send('hello', { name: profile?.name ?? 'Guest' })
}

/**
 * The server owns which round everyone is on. The tower generator is
 * deterministic, so a single integer is enough for every player to build the
 * identical course - no geometry is ever sent over the wire.
 */
/** Sections whose beam is held still by somebody on a lever pad. */
let haltedSections: number[] = []

let lastHeartbeatValue = 0
let lastHeartbeatSeenAt = 0

/**
 * Reads the one entity the server owns. ServerHeartbeat is the anchor now
 * that there is no RoundState: it is the component every shared-state client
 * needs anyway, and it is present from the server's first frame.
 */
function sharedRoundSystem(dt: number) {
  tickAnnouncement(dt)

  for (const [entity] of engine.getEntitiesWith(ServerHeartbeat)) {
    const beat = ServerHeartbeat.getOrNull(entity)
    if (beat && beat.at !== lastHeartbeatValue) {
      lastHeartbeatValue = beat.at
      // Client-observed time, not the server's stamp: a stale snapshot from a
      // server run that already ended must not read as alive.
      lastHeartbeatSeenAt = Date.now()
    }

    run.serverAlive = Date.now() - lastHeartbeatSeenAt < HEARTBEAT_SECONDS * 3000

    const levers = LeverState.getOrNull(entity)
    haltedSections = levers ? levers.halted : []

    const bypass = ShortcutState.getOrNull(entity)
    run.shortcutHeld = bypass ? bypass.held : 0
    if (bypass && world?.shortcut) setShortcutOpen(world.shortcut, bypass.open)

    const ranking = Ranking.getOrNull(entity)
    if (ranking) {
      run.ranking = ranking.names.map((name, index) => ({
        name,
        height: ranking.heights[index] ?? 0
      }))
      run.climbers = ranking.climbers
    }

    // Today's board is the one on the monument. The all-time list is the
    // trophy cabinet; the daily list is the thing a newcomer can actually win.
    const today = DailyBoard.getOrNull(entity)
    const allTime = Board.getOrNull(entity)
    if (today) {
      showBoard(today.names.map((name, index) => ({ name, seconds: today.seconds[index] ?? 0 })))
      run.dailyBest = today.seconds[0] ?? 0
    }
    if (allTime) run.towerRecord = allTime.seconds[0] ?? 0

    return
  }

  run.serverAlive = false
}

/**
 * Built once, at startup, and never rebuilt.
 *
 * The tower is permanent now, so there is no round to load and nothing to
 * tear down. Everyone in the World is standing on the same geometry from the
 * moment they arrive until they leave.
 */
function buildTheTower() {
  clearWorld(world)
  world = buildWorld(buildTower())
  prepareRound(world.checkpoints.length - 1, world.sectionNames)
  sendToLobby()
}

/** Reset your own attempt. The tower does not change; only your clock does. */
function retryClimb() {
  prepareRound(world ? world.checkpoints.length - 1 : 0, world ? world.sectionNames : [])
  sendToLobby()
}

function playerPosition(): Vector3 | null {
  const transform = Transform.getOrNull(engine.PlayerEntity)
  return transform ? transform.position : null
}

function horizontalDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * A hazard only bites when it is at body height. Clearing it with a jump
 * lifts the player's feet above the bar, which is the whole game.
 */
function atBodyHeight(playerY: number, hazardY: number): boolean {
  return playerY > hazardY - 1 && playerY < hazardY + 0.35
}

function hazardSystem(dt: number) {
  if (!world) return
  const player = playerPosition()
  const live = player && run.phase === Phase.Running && run.respawnCooldown <= 0

  for (const spinner of world.spinners) {
    // Somebody is holding this section's lever: the beam stops, and stops
    // hurting. Both must be true or the invisible half keeps killing people.
    const held =
      spinner.def.leverSection !== undefined && haltedSections.indexOf(spinner.def.leverSection) >= 0
    if (held) continue

    spinner.angle = (spinner.angle + spinner.def.speed * dt) % 360
    Transform.getMutable(spinner.entity).rotation = Quaternion.fromEulerDegrees(0, spinner.angle, 0)

    if (!live || !player) continue
    if (spinnerHits(spinner.def.x, spinner.def.y, spinner.def.z, spinner.def.length, spinner.angle, player)) {
      die()
      return
    }
  }

  for (const mover of world.movers) {
    mover.clock += dt * mover.def.speed
    const offset = Math.sin(mover.clock) * mover.def.range
    const transform = Transform.getMutable(mover.entity)
    transform.position.x = mover.def.x + (mover.def.axis === 'x' ? offset : 0)
    transform.position.y = mover.def.y + (mover.def.axis === 'y' ? offset : 0)
    transform.position.z = mover.def.z + (mover.def.axis === 'z' ? offset : 0)

    if (!live || !player) continue
    if (moverHits(transform.position, mover.def.sizeX, mover.def.sizeZ, player)) {
      die()
      return
    }
  }

  updateCrumblingPads(dt, player)
}

function spinnerHits(x: number, y: number, z: number, length: number, angle: number, player: Vector3): boolean {
  if (!atBodyHeight(player.y, y)) return false

  const dx = player.x - x
  const dz = player.z - z
  const radians = (angle * Math.PI) / 180
  const sin = Math.sin(radians)
  const cos = Math.cos(radians)

  // The beam's length sits on its local X axis, which a yaw of t maps to
  // (cos t, -sin t) in world space. Measuring the long axis along (sin, cos)
  // put the hit box at right angles to the bar you can actually see.
  const along = Math.abs(dx * cos - dz * sin)
  if (along > length / 2) return false

  return Math.abs(dx * sin + dz * cos) < HAZARD_HALF_WIDTH
}

function moverHits(position: Vector3, sizeX: number, sizeZ: number, player: Vector3): boolean {
  if (!atBodyHeight(player.y, position.y)) return false
  return Math.abs(player.x - position.x) < sizeX / 2 + 0.35 && Math.abs(player.z - position.z) < sizeZ / 2 + 0.35
}

function updateCrumblingPads(dt: number, player: Vector3 | null) {
  if (!world) return

  for (const built of world.pads) {
    if (!built.pad.crumble) continue

    if (built.state === 'solid') {
      if (!player) continue
      const standing =
        Math.abs(player.y - (built.pad.y + PAD_TOP)) < 1 &&
        Math.abs(player.x - built.pad.x) < built.pad.size / 2 + 0.3 &&
        Math.abs(player.z - built.pad.z) < built.pad.size / 2 + 0.3
      if (standing) {
        built.state = 'falling'
        built.timer = CRUMBLE_DELAY
        paintCrumbling(built.entity, built.glow)
      }
      continue
    }

    built.timer -= dt
    if (built.timer > 0) continue

    if (built.state === 'falling') {
      MeshCollider.deleteFrom(built.entity)
      paintCrumbled(built.entity, built.glow)
      built.state = 'gone'
      built.timer = CRUMBLE_RESPAWN
    } else {
      MeshCollider.setBox(built.entity)
      paintPad(built.entity, built.pad)
      paintGlow(built.glow, sectionAccent(built.pad.section))
      built.state = 'solid'
    }
  }
}

function runSystem(dt: number) {
  if (!world) return
  const player = playerPosition()
  if (!player) return

  if (run.respawnCooldown > 0) run.respawnCooldown -= dt

  updatePrompt(player)

  if (run.phase === Phase.Ready) {
    if (run.respawnCooldown <= 0 && crossedStartLine(player)) {
      startClock()
      play('start')
    }
  }
  if (run.phase !== Phase.Running) return

  run.time += dt

  for (let i = world.checkpoints.length - 1; i > run.checkpoint; i--) {
    const checkpoint = world.checkpoints[i]
    if (Math.abs(player.y - checkpoint.top.y) > 2) continue
    if (horizontalDistance(player, checkpoint.top) <= CHECKPOINT_RADIUS) {
      run.checkpoint = i
      activateCheckpoint(checkpoint)
      play('checkpoint')

      // A checkpoint closes its section, so the next one starts here.
      const done = world.pads[checkpoint.padIndex].pad.section
      run.section = Math.min(done + 1, run.totalSections)
      run.sectionName = world.sectionNames[run.section - 1] ?? run.sectionName
      break
    }
  }

  if (
    Math.abs(player.y - world.finish.y) < FINISH_TOUCH_RISE &&
    horizontalDistance(player, world.finish) <= world.finishReach
  ) {
    // Claim it and let the server decide. It re-derives the finish pad from the
    // round number and checks our verified position before crediting anything.
    const profile = getPlayer()
    room.send('claimFinish', { name: profile?.name ?? 'Guest' })

    // The panel is optimistic, the sound is not: it plays when the server
    // confirms the finish over roundWon, so it can never celebrate a claim
    // that was rejected.
    const improved = run.personalBest === 0 || run.time < run.personalBest
    completeRound(improved)
    return
  }

  const active = world.checkpoints[run.checkpoint].top
  if (run.respawnCooldown <= 0 && player.y < active.y - FALL_GRACE) die()
}

/** True once the player is past the gate plane and inside its width. */
function crossedStartLine(player: Vector3): boolean {
  const dx = player.x - GATE_X
  const dz = player.z - GATE_Z
  const ahead = dx * GATE_DIR_X + dz * GATE_DIR_Z
  if (ahead <= 0) return false

  const lateral = Math.abs(dx * -GATE_DIR_Z + dz * GATE_DIR_X)
  return lateral < GATE_WIDTH
}

/**
 * What the co-op pad has to say, if the player is standing on one.
 *
 * The pad already carries a sign, but a sign cannot tell you that somebody is
 * on the other pad right now, waiting. That is the whole point of the
 * mechanic, and it is invisible without the server's count - which is why
 * `held` is broadcast separately from `open`.
 */
function shortcutPrompt(player: Vector3): string {
  if (!world?.shortcut) return ''

  const onPad = [world.shortcut.padA, world.shortcut.padB].some((entity) => {
    const at = Transform.getOrNull(entity)
    if (!at) return false
    return (
      horizontalDistance(player, at.position) < PAD_RADIUS &&
      Math.abs(player.y - at.position.y) < 3
    )
  })
  if (!onPad) return ''

  if (run.shortcutHeld >= 2) return 'SHORTCUT OPEN - GO'
  return 'WAITING FOR A SECOND CLIMBER ON THE OTHER PAD'
}

/** Approach hints: what happens next, shown just before it happens. */
function updatePrompt(player: Vector3) {
  if (!world) {
    run.prompt = ''
    return
  }

  if (run.phase === Phase.Ready) {
    const distance = Math.sqrt((player.x - GATE_X) ** 2 + (player.z - GATE_Z) ** 2)
    run.prompt =
      distance < PROMPT_RANGE
        ? 'CROSS THE LINE TO START YOUR CLIMB'
        : ''
    return
  }

  if (run.phase === Phase.Running) {
    const coop = shortcutPrompt(player)
    if (coop !== '') {
      run.prompt = coop
      return
    }

    const distance = horizontalDistance(player, world.finish)
    const climb = world.finish.y - player.y
    run.prompt = distance < PROMPT_RANGE && climb < 6 ? 'FINISH LINE AHEAD' : ''
    return
  }

  run.prompt = ''
}

function die() {
  run.falls += 1
  play('fall')
  freezeAfterFall()
  sendToCheckpoint()
}

/** Drops the player back in the lobby, looking at the leaderboard. */
function sendToLobby() {
  run.respawnCooldown = RESPAWN_COOLDOWN
  void movePlayerTo({
    newRelativePosition: Vector3.create(LOBBY_SPAWN_X, LOBBY_Y + 1.2, LOBBY_SPAWN_Z),
    cameraTarget: GATE_LOOK
  })
}

function sendToCheckpoint(lookAt?: Vector3) {
  if (!world) return
  const checkpoint = world.checkpoints[run.checkpoint] ?? world.checkpoints[0]
  run.respawnCooldown = RESPAWN_COOLDOWN

  // Face the next pad, so a respawn never drops the player looking backwards.
  // Same class of mistake as the finish gate, though measured as harmless
  // today: no checkpoint currently sits on a branch. Following the route
  // rather than the array keeps it that way by construction.
  const ahead =
    world.pads.find((built) => built.pad.fromIndex === checkpoint.padIndex) ??
    world.pads[checkpoint.padIndex + 1]
  const cameraTarget =
    lookAt ??
    (ahead
      ? Vector3.create(ahead.pad.x, ahead.pad.y + 1.6, ahead.pad.z)
      : Vector3.create(checkpoint.top.x, checkpoint.top.y + 1.6, checkpoint.top.z))

  void movePlayerTo({
    newRelativePosition: Vector3.create(checkpoint.top.x, checkpoint.top.y + RESPAWN_LIFT, checkpoint.top.z),
    cameraTarget
  })
}
