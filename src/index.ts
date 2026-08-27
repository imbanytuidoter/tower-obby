import {
  Billboard,
  BillboardMode,
  engine,
  Entity,
  InputAction,
  inputSystem,
  Material,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer, isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
// Static, never lazy: registerMessages and defineComponent must both run
// during module load, before the engine seals.
// Static, and before anything that reaches into it. esbuild wraps modules in
// lazy __esm initializers because the server branch is imported dynamically,
// and build.ts calling placeProp() ran before props.ts had initialised -
// "placeProp is not defined" at runtime, with a clean type-check. Third time
// this exact trap has bitten; naming it here so the next reader sees it.
import './game/props'
import { room } from './shared/messages'
import {
  Board,
  PointsBoard,
  Ghost,
  Wall,
  Haul,
  protectServerState,
  LeverState,
  Ranking,
  ServerHeartbeat,
  ShortcutState,
  TandemState
} from './shared/schemas'
import {
  CELEBRATION_SECONDS,
  CHECKPOINT_TOUCH_MARGIN,
  COIN_BOB,
  COIN_BOB_RATE,
  COIN_SPIN,
  CROWN_SPIN,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  FALL_GRACE,
  FINISH_TOUCH_RISE,
  FORK_PROMPT_RANGE,
  GATE_DIR_X,
  GATE_DIR_Z,
  GATE_WIDTH,
  GATE_X,
  GATE_Z,
  GHOST_MAX_SAMPLES,
  GHOST_SAMPLE_SECONDS,
  HAZARD_HALF_WIDTH,
  HEARTBEAT_SECONDS,
  LOBBY_SPAWN_X,
  LOBBY_SPAWN_Z,
  LOBBY_Y,
  PAD_RADIUS,
  PICKUP_PROMPT_RANGE,
  PICKUP_RADIUS,
  PROMPT_RANGE,
  RESPAWN_COOLDOWN,
  RESPAWN_LIFT
} from './game/config'
import {
  activateCheckpoint,
  assertDecorIsQuiet,
  bandFor,
  PARKED_Y,
  buildWorld,
  clearWorld,
  paintCrumbled,
  paintCrumbling,
  paintPad,
  PAD_TOP,
  sectionAccent,
  setShortcutOpen,
  World
} from './game/build'
import { legendCoin, setHaul } from './game/legend'
import { crownHalo, lightTheCrown, setCrownRoll, setGreeting } from './game/build'
import { applyFairness, freezeAfterFall } from './game/fairness'
import { formatTime } from './game/format'
import { buildTower } from './game/layout'
import {
  buildPlaza,
  flickerFlames,
  decorSystem,
  GATE_LOOK,
  refreshBoard,
  showBoard,
  showClimbers,
  showTowerRecord
} from './game/plaza'
import { fadeForest, play, setupSound } from './game/sound'
import { announce, completeRound, Phase, prepareRound, run, startClock, tickAnnouncement } from './game/state'
import { setupUi } from './ui'

let world: World | null = null

/** The replayed path and the mote that walks it. Empty until a record exists. */
let ghostPath: number[] = []
let ghostMote: Entity | null = null
let ghostLabel: Entity | null = null
let wallStamp = ''
let haulShown = -1

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
  assertDecorIsQuiet()
  applyFairness()

  const layout = buildTower()
  buildPlaza()
  setupSound()
  setupUi({ next: () => {}, retry: retryClimb, restart: retryClimb })
  buildTheTower()

  engine.addSystem(celebrationSystem, 1, 'celebrationSystem')
  engine.addSystem(flickerFlames, 1, 'flickerFlames')
  engine.addSystem(hazardSystem, 1, 'hazardSystem')
  engine.addSystem(runSystem, 2, 'runSystem')
  engine.addSystem(decorSystem, 3, 'decorSystem')
  engine.addSystem(sharedRoundSystem, 4, 'sharedRoundSystem')
  engine.addSystem(helloSystem, 5, 'helloSystem')
  engine.addSystem(ghostSystem, 6, 'ghostSystem')

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
    // Everyone in the world sees the crown go off, not just the climber. The
    // point of one shared tower is that somebody else's summit is an event.
    celebrate()
  })

  // Somebody emptied the tower. Announced with the summit's sound, because it
  // is the only note in this scene's vocabulary that means an achievement -
  // the sixteenth coin used to play the same blip as a checkpoint.
  room.onMessage('collected', (data) => {
    announce(data.name + ' has found every coin in the tower', 6)
    play('finish')
  })

  // The server verified the player actually reached the coin. Nothing is
  // spent yet - the token is held until they decide it is worth using.
  room.onMessage('token', (data) => {
    run.token = 1
    run.tokenSkipsTo = data.skipsToCheckpoint
    if (world?.coin) {
      world.coin.taken = true
      Transform.getMutable(world.coin.entity).scale = Vector3.Zero()
    }
    play('checkpoint')
  })

  room.onMessage('pickups', (data) => {
    applyPickups([...data.found])
  })

  room.onMessage('stats', (data) => {
    run.personalBest = data.bestSeconds
    run.climbs = data.climbs
    applyPickups([...data.found])
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

    // The plate's height is the server's answer to "are two people aboard",
    // so the client only ever renders it - it never decides it.
    const tandem = TandemState.getOrNull(entity)
    if (tandem && world?.plate) {
      const transform = Transform.getMutable(world.plate.entity)
      transform.position.y = world.plate.baseY + tandem.lift * world.plate.rise
      run.plateRiders = tandem.riders
      run.plateLift = tandem.lift
    }

    /**
     * Sample COUNT was the only thing compared here, and it is not an identity.
     * The path is sampled on a fixed clock, so two climbs that take the same
     * time produce exactly the same number of samples - and a new record that
     * ties the old one to within half a second would be received by the server,
     * stored, synced, and then silently ignored by every client. The runner's
     * name and time are what actually changed; compare those.
     */
    const ghost = Ghost.getOrNull(entity)
    if (
      ghost &&
      (ghost.path.length !== ghostPath.length ||
        ghost.name !== run.ghostName ||
        ghost.seconds !== run.ghostSeconds)
    ) {
      ghostPath = [...ghost.path]
      ghostClock = 0
      run.ghostName = ghost.name
      run.ghostSeconds = ghost.seconds
      if (!ghostMote && ghostPath.length >= 6) ghostMote = createGhostMote()
      if (ghostLabel) {
        TextShape.getMutable(ghostLabel).text =
          ghost.name + '  ' + ghost.seconds.toFixed(1) + 's'
      }
    }

    // The crown's roll. Compared by content, not by length: the same ten
    // names in a new order is a real change - somebody climbed again - and
    // comparing counts would miss every one of those, which is the mistake
    // the ghost carried until it was measured.
    const crown = Wall.getOrNull(entity)
    if (crown) {
      const stamp = crown.names.join('') + '' + crown.seconds.join('')
      if (stamp !== wallStamp) {
        wallStamp = stamp
        setCrownRoll([...crown.names], [...crown.seconds])
      }
    }

    const grove = Haul.getOrNull(entity)
    if (grove && grove.coins !== haulShown) {
      haulShown = grove.coins
      setHaul(grove.coins)
      lightTheCrown(grove.coins)
    }

    const ranking = Ranking.getOrNull(entity)
    if (ranking) {
      run.ranking = ranking.names.map((name, index) => ({
        name,
        height: ranking.heights[index] ?? 0
      }))
      run.climbers = ranking.climbers
      showClimbers(ranking.heights.map((h) => h))
    }

    /**
     * The monument shows the ALL-TIME board now.
     *
     * It showed today's, on the reasoning that a daily list is something a
     * newcomer can actually win. What that meant in practice was a board that
     * emptied itself at midnight UTC: a player finished, showed a friend, and
     * by the time the friend looked the table was blank for everybody. Asked
     * for plainly - it should not reset at all.
     */
    const today = Board.getOrNull(entity)
    const allTime = Board.getOrNull(entity)
    if (today) {
      // The second half of the monument ranks lifetime points now, not pairs.
      const ranked = PointsBoard.getOrNull(entity)
      showBoard(
        today.names.map((name, index) => ({ name, seconds: today.seconds[index] ?? 0 })),
        (ranked?.names ?? []).map((name, index) => ({
          name,
          points: ranked?.points[index] ?? 0
        }))
      )
    }
    if (allTime) {
      run.towerRecord = allTime.seconds[0] ?? 0
      showTowerRecord(allTime.names[0] ?? '', allTime.seconds[0] ?? 0)
    }

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
  setGreeting(false)
  clearWorld(world)
  world = buildWorld(buildTower())
  prepareRound(world.checkpoints.length - 1, world.sectionNames)
  sendToLobby()
}

/** Reset your own attempt. The tower does not change; only your clock does. */
function retryClimb() {
  setGreeting(false)
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

/**
 * Puts every crumbling pad back, now, whatever state it was left in.
 *
 * The per-frame timer restores them four seconds after they drop, and a
 * player reported them gone for good - which means the state machine can get
 * stuck somewhere I have not found. A pad that never comes back is not a
 * difficulty spike, it is a wall: nobody behind you can pass, and neither can
 * you on your next attempt.
 *
 * So this does not try to be clever. Every respawn, every pad, back to solid.
 * If the timer works this changes nothing; if it stalls, the tower repairs
 * itself the moment anybody falls.
 */
export function restoreCrumblingPads() {
  if (!world) return
  for (const built of world.pads) {
    if (!built.pad.crumble || built.state === 'solid') continue
    MeshCollider.setBox(built.entity)
    paintPad(built.entity, built.pad)
    built.state = 'solid'
    built.timer = 0
  }
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
        paintCrumbling(built.entity)
      }
      continue
    }

    built.timer -= dt
    if (built.timer > 0) continue

    if (built.state === 'falling') {
      MeshCollider.deleteFrom(built.entity)
      paintCrumbled(built.entity)
      built.state = 'gone'
      built.timer = CRUMBLE_RESPAWN
    } else {
      MeshCollider.setBox(built.entity)
      // Just the pad. paintGlow used to run after this and overwrote it -
      // with the glow entity gone, "glow" aliased the pad itself, so a
      // respawned crumbling slab came back painted safe-cyan instead of
      // orange. That is the one pad where the colour has to be right.
      paintPad(built.entity, built.pad)
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
  spinPickups(dt)
  turnCrown(dt)
  fadeForest(player.y)
  noteForkChoice(player)
  reachForCoin(dt, player)
  reachForPickups(player)
  spendToken()
  rideThePlate(player)

  if (run.phase === Phase.Ready) {
    if (run.respawnCooldown <= 0 && crossedStartLine(player)) {
      startClock()
      play('start')
    }
  }
  if (run.phase !== Phase.Running) return

  run.time += dt
  sampleGhost(dt, player)

  for (let i = world.checkpoints.length - 1; i > run.checkpoint; i--) {
    const checkpoint = world.checkpoints[i]
    if (Math.abs(player.y - checkpoint.top.y) > 2) continue
    // The pad itself, not a circle around it. A radius wide enough to cover a
    // 4.6 m landing's corner is also wide enough to bank it from the pad next
    // door - MIN_PAD_SEPARATION is 3.4 - so it would hand out checkpoints to
    // players who never stood on them. A box test is exactly the shape of the
    // thing you are standing on, and needs no margin at all.
    const half = checkpoint.size / 2 + CHECKPOINT_TOUCH_MARGIN
    if (
      Math.abs(player.x - checkpoint.top.x) <= half &&
      Math.abs(player.z - checkpoint.top.z) <= half
    ) {
      run.checkpoint = i
      activateCheckpoint(checkpoint)
      play('checkpoint')

      // A checkpoint closes its section, so the next one starts here.
      const done = world.pads[checkpoint.padIndex].pad.section
      run.section = Math.min(done + 1, run.totalSections)
      run.sectionName = world.sectionNames[run.section - 1] ?? run.sectionName
      run.band = bandFor(run.section)
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
    // Offered unconditionally; the server keeps it only if this climb landed
    // on top of today's board, which is a decision a client must not make.
    if (run.path.length >= 12) room.send('ghostPath', { path: run.path })

    // The panel is optimistic, the sound is not: it plays when the server
    // confirms the finish over roundWon, so it can never celebrate a claim
    // that was rejected.
    const improved = run.personalBest === 0 || run.time < run.personalBest
    completeRound(improved)
    // Only for the climber who just arrived. The celebration at the crown is
    // world-wide on purpose - somebody else's summit is an event - but the
    // greeter's line is second person, and telling a spectator they made it
    // to the top is a lie the moment two people are in the scene.
    setGreeting(true)
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

/** A small gold light that walks the record run's path. */
function createGhostMote(): Entity {
  const mote = engine.addEntity()
  Transform.create(mote, {
    position: Vector3.create(0, -50, 0),
    scale: Vector3.create(0.55, 0.55, 0.55)
  })
  MeshRenderer.setSphere(mote)
  Material.setPbrMaterial(mote, {
    albedoColor: Color4.create(1, 0.85, 0.35, 0.75),
    emissiveColor: Color3.create(1, 0.78, 0.2),
    emissiveIntensity: 5
  })

  /**
   * The mote gets a name, because an anonymous light is scenery.
   *
   * A gold dot drifting up the tower reads as a decoration - which is what
   * every other floating light in this scene IS - and a player has no way to
   * learn otherwise. The HUD says who is being chased, but only if you look
   * away from the thing you are chasing. Put the name on the runner and the
   * mote stops being an effect and becomes a person who was here before you.
   *
   * The scale is the parent's inverse: the mote is 0.55, so the label would
   * inherit that shrink and be unreadable at the distance it matters.
   */
  const label = engine.addEntity()
  Transform.create(label, {
    parent: mote,
    position: Vector3.create(0, 1.5, 0),
    scale: Vector3.create(1 / 0.55, 1 / 0.55, 1 / 0.55)
  })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(label, {
    text: run.ghostName + '  ' + run.ghostSeconds.toFixed(1) + 's',
    fontSize: 1.1,
    textColor: Color4.create(1, 0.85, 0.4, 0.95),
    outlineColor: Color4.Black(),
    outlineWidth: 0.3
  })
  ghostLabel = label

  return mote
}

/**
 * Samples this climb's path, so a record run can be replayed for everyone.
 *
 * Two a second, capped, and thrown away if the climb does not end on top of
 * today's board - the server decides that, and only invites a path from the
 * climber it decided about.
 */
let ghostTimer = 0
function sampleGhost(dt: number, player: Vector3) {
  ghostTimer -= dt
  if (ghostTimer > 0) return
  ghostTimer = GHOST_SAMPLE_SECONDS
  if (run.path.length >= GHOST_MAX_SAMPLES * 3) return
  run.path.push(player.x, player.y, player.z)
}

/**
 * Replays the day's fastest climb as a mote of light moving up the tower.
 *
 * Not an avatar - an avatar reads as a player you can talk to, and this one
 * cannot answer. A light on the route says "somebody did this, faster than
 * you" and nothing else, which is exactly what it is for.
 */
let ghostClock = 0
function ghostSystem(dt: number) {
  if (ghostPath.length < 6 || !ghostMote) return

  ghostClock += dt
  const frames = ghostPath.length / 3
  // N samples describe N-1 intervals, not N. Spanning the loop over `frames`
  // gave the walk one interval more than the path has, so for the last half
  // second `f` ran past 1 and the mote extrapolated PAST the final sample -
  // sailing off the top of the route at climbing speed before snapping back
  // to the bottom. The clamp on `i` kept the reads in bounds, which is why it
  // never threw; it just drew a path nobody climbed.
  const span = (frames - 1) * GHOST_SAMPLE_SECONDS
  const t = (ghostClock % span) / GHOST_SAMPLE_SECONDS
  const i = Math.min(frames - 2, Math.floor(t))
  const f = t - i

  const transform = Transform.getMutable(ghostMote)
  transform.position.x = ghostPath[i * 3] + (ghostPath[i * 3 + 3] - ghostPath[i * 3]) * f
  transform.position.y = ghostPath[i * 3 + 1] + (ghostPath[i * 3 + 4] - ghostPath[i * 3 + 1]) * f + 1
  transform.position.z = ghostPath[i * 3 + 2] + (ghostPath[i * 3 + 5] - ghostPath[i * 3 + 2]) * f
}

/**
 * Delivers whoever is aboard when the plate finishes its lift.
 *
 * The plate rising is the shared signal - two people made it move, and
 * everyone can see that. The arrival is a placement rather than a ride,
 * deliberately: the docs do not state whether a player standing on a moving
 * MeshCollider is carried with it, the physics forces that would do the job
 * are local-only and unsynced, and this is the one mechanic in the game that
 * cannot be tested without a second person. Guessing at undocumented physics
 * in something unverifiable is how a mechanic ships broken.
 */
/**
 * What the lever says to whoever is standing on it.
 *
 * The same gap the tandem plate had: a co-op mechanic whose whole point is
 * that somebody gave something up, with nothing telling that person it
 * worked. The pad turns green under their feet, but the beam they stopped is
 * in the next zone where they cannot see it.
 */
function leverPrompt(player: Vector3): string {
  if (!world) return ''

  for (const lever of world.levers) {
    const at = Transform.getOrNull(lever.pad)
    if (!at) continue
    if (
      horizontalDistance(player, at.position) < PAD_RADIUS &&
      Math.abs(player.y - at.position.y) < 3
    ) {
      return 'HOLDING THE BEAM FOR EVERYONE  -  YOU ARE NOT CLIMBING'
    }
  }
  return ''
}

/**
 * What a coin says when you get near one.
 *
 * "COINS 0/8" in the corner tells a new player that eight of something exist
 * and nothing else - not what they are, not that they are optional, not that
 * going for one costs time. The judging criteria name onboarding explicitly
 * and this is the only mechanic in the tower with no in-world explanation.
 *
 * Said once, near the thing, in the line that is already there.
 */
function pickupPrompt(player: Vector3): string {
  if (!world) return ''

  for (const pickup of world.pickups) {
    if (pickup.taken) continue
    const at = Vector3.create(pickup.def.x, pickup.def.y, pickup.def.z)
    if (Vector3.distance(player, at) > PICKUP_PROMPT_RANGE) continue
    return 'A COIN, OFF THE ROUTE  -  YOURS TO KEEP, COSTS YOU TIME'
  }
  return ''
}

/**
 * What the tandem plate says to whoever is standing on it.
 *
 * The rider count was travelling all the way from the server into
 * `run.plateRiders` and then being displayed nowhere, which is the same
 * anti-pattern this project has hit before: a number computed, synced, and
 * never shown. Standing on the plate alone produced no feedback at all - it
 * simply did not move, and nothing said why.
 *
 * This is the one mechanic in the tower that cannot be solved by skill, so it
 * is the one that most needs to say what it is waiting for.
 */
function platePrompt(player: Vector3): string {
  const plate = world?.plate
  if (!plate) return ''

  const deck = plate.baseY + run.plateLift * plate.rise
  const aboard =
    Math.abs(player.x - plate.x) < plate.size / 2 + 0.4 &&
    Math.abs(player.z - plate.z) < plate.size / 2 + 0.4 &&
    Math.abs(player.y - deck) < 2.4
  if (!aboard) return ''

  if (run.plateRiders >= 2) {
    return run.plateLift >= 0.98
      ? 'HOLD ON'
      : 'RISING TOGETHER  ' + Math.round(run.plateLift * 100) + '%'
  }
  return 'THIS PLATE NEEDS TWO  -  WAITING FOR SOMEBODY'
}

function rideThePlate(player: Vector3) {
  const plate = world?.plate
  if (!plate || run.plateLift < 0.98 || run.respawnCooldown > 0) return

  const deck = plate.baseY + plate.rise
  const aboard =
    Math.abs(player.x - plate.x) < plate.size / 2 + 0.4 &&
    Math.abs(player.z - plate.z) < plate.size / 2 + 0.4 &&
    Math.abs(player.y - deck) < 2.4
  if (!aboard) return

  run.respawnCooldown = RESPAWN_COOLDOWN
  play('checkpoint')
  void movePlayerTo({
    newRelativePosition: plate.landing,
    cameraTarget: Vector3.create(plate.landing.x, plate.landing.y, plate.landing.z + 1)
  })
}

/**
 * Claims the ante when the player gets to it.
 *
 * The client only ever says "I am here" - the server knows where the coin
 * hangs, reads the player's engine-verified position and decides. Throttled,
 * because standing next to it would otherwise send one claim per frame.
 */
let coinTimer = 0
/**
 * Touch a pickup to claim it. The client only ASKS - the server checks the
 * distance itself, because a client that could name its own pickups could
 * name all eight from the lobby.
 *
 * Deliberately not gated on Phase.Running: these are worth collecting on a
 * stroll as much as on a timed climb, and the clock has no opinion about them.
 */
function reachForPickups(player: Vector3) {
  if (!world) return

  for (let i = 0; i < world.pickups.length; i++) {
    const pickup = world.pickups[i]
    if (pickup.taken) continue
    const at = Vector3.create(pickup.def.x, pickup.def.y, pickup.def.z)
    if (Vector3.distance(player, at) > PICKUP_RADIUS) continue
    const sentAt = pendingPickups.get(i)
    if (sentAt !== undefined && Date.now() - sentAt < PICKUP_RETRY_MS) continue

    // Marked as sent only once it HAS been sent. Marking first meant a touch
    // that happened while the room was still connecting was recorded as
    // pending and never retried - the pickup became uncollectable for the
    // rest of the session, silently.
    //
    // A synced room is not a woken server: the room can be connected while
    // the server is still cold-starting, and anything sent into that window
    // is dropped without a trace. serverAlive is the heartbeat, which is the
    // only thing that actually knows.
    if (!isStateSyncronized() || !run.serverAlive) continue
    room.send('takePickup', { index: i })
    pendingPickups.set(i, Date.now())
  }
}

/**
 * Turns and floats every uncollected coin.
 *
 * One system, not eight tweens: eight Tween components restarted on a loop is
 * eight component writes a frame, and this is the same arithmetic done once
 * against a shared clock. Taken coins are skipped - their entity is gone.
 *
 * The bob is deliberately small. A coin that swings a metre is a coin whose
 * pickup radius no longer matches where it looks like it is, and that reads as
 * the game refusing a touch that clearly connected.
 */
let coinPhase = 0

function spinPickups(dt: number) {
  coinPhase += dt

  // The legend's sample turns on the same clock as the real ones. Two coins
  // spinning at different rates would say they are two different objects,
  // which is the opposite of what a legend is for.
  if (legendCoin) {
    const sample = Transform.getMutableOrNull(legendCoin)
    if (sample) sample.rotation = Quaternion.fromEulerDegrees(90, coinPhase * COIN_SPIN, 0)
  }

  if (!world) return

  for (const pickup of world.pickups) {
    if (pickup.taken) continue
    const transform = Transform.getMutableOrNull(pickup.entity)
    if (!transform) continue

    transform.rotation = Quaternion.fromEulerDegrees(90, coinPhase * COIN_SPIN, 0)
    transform.position.y = pickup.def.y + Math.sin(coinPhase * COIN_BOB_RATE) * COIN_BOB
  }
}

/**
 * The halo over the crown turns.
 *
 * Slower than the coins on purpose. A coin spins to be NOTICED - it is asking
 * to be taken. The halo is already yours by the time you can see it turning,
 * so it only has to look ceremonial, and anything quick up there reads as a
 * hazard in a game that has spent seventy metres teaching that moving things
 * hurt.
 */
let crownPhase = 0

function turnCrown(dt: number) {
  if (!crownHalo) return
  crownPhase += dt
  const halo = Transform.getMutableOrNull(crownHalo)
  if (halo) halo.rotation = Quaternion.fromEulerDegrees(0, crownPhase * CROWN_SPIN, 0)
}

/**
 * The burst at the crown.
 *
 * Driven by one system rather than a tween per shard: fourteen tweens started
 * at the same instant is fourteen components written in one frame, and the
 * shards only move for under two seconds.
 */
let celebrationTimer = 0

export function celebrate() {
  celebrationTimer = CELEBRATION_SECONDS
}

function celebrationSystem(dt: number) {
  if (!world || celebrationTimer <= 0) return

  celebrationTimer -= dt
  // world.finish is the walking surface of the crown, already PAD_TOP up.
  const finish = world.finish
  const done = celebrationTimer <= 0
  // 0 at the moment of the summit, 1 when the burst is over.
  const t = 1 - Math.max(0, celebrationTimer) / CELEBRATION_SECONDS

  for (let i = 0; i < world.celebration.length; i++) {
    const transform = Transform.getMutableOrNull(world.celebration[i])
    if (!transform) continue

    if (done) {
      transform.position.y = PARKED_Y
      continue
    }

    const angle = (i / world.celebration.length) * Math.PI * 2
    const reach = 1.2 + t * 5.5
    // Thrown up and falling back: the arc is what reads as a burst rather
    // than as a ring of boxes sliding outward.
    const lift = 6.5 * t - 7.5 * t * t
    transform.position.x = finish.x + Math.cos(angle) * reach
    transform.position.z = finish.z + Math.sin(angle) * reach
    transform.position.y = finish.y + 0.6 + lift
    transform.rotation = Quaternion.fromEulerDegrees(t * 320, (angle * 180) / Math.PI, t * 210)
  }
}

/** Asked for but not yet confirmed, so one touch does not send every frame. */
/**
 * Coins claimed but not yet answered for, with the moment each was sent.
 *
 * This was a plain Set, and an entry never left it. The server drops a claim
 * in silence on three paths - it cannot read the player's position yet, the
 * claim is out of range by its own reckoning, or the message was sent while
 * the server was still cold-starting and never arrived at all - and it
 * answers only on success. So one unlucky touch made that coin UNCOLLECTABLE
 * for the rest of the session, with the coin still hanging there in plain
 * sight. Exactly the failure the comment in reachForPickups describes; the
 * marking order was fixed, this cause was not.
 *
 * Re-sending is safe by construction: handlePickup rejects an index the
 * player already owns, so a retry can never pay twice.
 */
const pendingPickups = new Map<number, number>()

/** How long a claim waits for an answer before the touch may be retried. */
const PICKUP_RETRY_MS = 2000

/**
 * The server's answer: everything this player has ever found. Hides them, and
 * hides them again on a later visit without the player touching anything.
 */
function applyPickups(found: number[]) {
  if (!world) return
  // Anything new since the last answer was taken JUST NOW, on this climb, and
  // is what the run is scored on. Counted from the delta rather than from a
  // separate counter, because the server's list is the only thing that knows
  // for certain which coins are already spent.
  const gained = found.length - run.pickupsFound
  if (gained > 0 && run.pickupsFound > 0) run.pickupsThisRun += gained

  run.pickupsFound = found.length
  run.pickupsTotal = world.pickups.length

  for (const index of found) {
    const pickup = world.pickups[index]
    if (!pickup || pickup.taken) continue
    pickup.taken = true
    // Parked under the floor rather than removed: the tower is rebuilt only
    // on a reload, and a removed entity cannot come back for the next visitor
    // sharing this client.
    const transform = Transform.getMutableOrNull(pickup.entity)
    if (transform) transform.position.y = -50
    play('checkpoint')
  }
}

function reachForCoin(dt: number, player: Vector3) {
  if (!world?.coin || world.coin.taken || run.token > 0) return

  // Real elapsed time, not an assumed 30 fps. The client renders at whatever
  // rate the device manages - a phone under load runs slower and would have
  // throttled this to a crawl, a fast machine would have sped it up.
  coinTimer -= dt
  if (coinTimer > 0) return

  if (horizontalDistance(player, world.coin.at) < 2 && Math.abs(player.y - world.coin.at.y) < 2.5) {
    coinTimer = 0.5
    room.send('claimCoin', {})
  }
}

/**
 * E spends the token: it lifts the player to the checkpoint the coin paid
 * for, skipping what is between.
 *
 * There is no legend and no tutorial for this. The button does nothing until
 * a token is held and the prompt appears the moment one is - the control
 * teaches itself by going live, which is the only way to teach a button on a
 * phone without spending one of four HUD lines on it.
 */
function spendToken() {
  if (run.token <= 0 || !world) return
  // E, not 1.
  //
  // The design pass put this on button 1, but Decentraland's own mobile
  // guidance says not to: IA_ACTION_3 to IA_ACTION_6 sit behind a secondary
  // menu on the phone HUD and are "not easily reachable during gameplay".
  // IA_PRIMARY is the E button, always on screen, and this is the only thing
  // in the game bound to it - so the control still teaches itself by lighting
  // up when a token is held and doing nothing otherwise.
  if (!inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return

  const index = Math.min(run.tokenSkipsTo, world.checkpoints.length - 1)
  const target = world.checkpoints[index]
  if (!target) return

  // Only ever forwards. Spending it after climbing past the checkpoint it
  // buys used to consume the token AND teleport the player back down to the
  // ring they were standing above, losing everything since - a reward that
  // punished you for earning it early. Held instead, and the prompt says so.
  if (index <= run.checkpoint) return

  run.token = 0
  run.checkpoint = index
  activateCheckpoint(target)
  play('checkpoint')
  sendToCheckpoint()
}

/**
 * Records which arm of a fork the player actually took.
 *
 * Standing on a pad is the answer - there is nothing to press and nothing to
 * confirm. Recorded once per fork per run, because a player who steps back
 * onto the other arm has still committed to the first one they landed on.
 */
function noteForkChoice(player: Vector3) {
  if (!world || run.phase !== Phase.Running) return

  for (const fork of world.forks) {
    if (run.choices.some((choice) => choice.zone === fork.zone)) continue

    const standingOn = (indices: number[]) =>
      indices.some((index) => {
        const built = world?.pads[index]
        if (!built) return false
        const pad = built.pad
        return (
          Math.abs(player.y - (pad.y + PAD_TOP)) < 1.4 &&
          Math.abs(player.x - pad.x) < pad.size / 2 + 0.4 &&
          Math.abs(player.z - pad.z) < pad.size / 2 + 0.4
        )
      })

    if (standingOn(fork.bold)) {
      run.choices.push({ zone: fork.zone, bold: true, delta: -fork.saves })
      play('checkpoint')
    } else if (standingOn(fork.safe)) {
      run.choices.push({ zone: fork.zone, bold: false, delta: fork.saves })
    }
  }
}

/** Approach hints: what happens next, shown just before it happens. */
function updatePrompt(player: Vector3) {
  if (!world) {
    run.prompt = ''
    return
  }

  // What you are STANDING on comes first and is not gated on a phase. Holding
  // a lever is a favour to other people whether or not your own clock is
  // running, and the plate does not care either.
  const standing = leverPrompt(player) || platePrompt(player)
  if (standing !== '') {
    run.prompt = standing
    return
  }

  if (run.phase === Phase.Ready) {
    // A coin can be taken on a wander as well as on a timed climb, so its
    // explanation cannot live only in the Running branch.
    const idleCoin = pickupPrompt(player)
    if (idleCoin !== '') {
      run.prompt = idleCoin
      return
    }

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

    // After everything you can be STANDING on. Being on a lever or a plate is
    // a thing you are doing; a coin four metres away is a thing you could do,
    // and the first should not be talked over by the second.
    const coin = pickupPrompt(player)
    if (coin !== '') {
      run.prompt = coin
      return
    }

    if (run.token > 0) {
      const index = Math.min(run.tokenSkipsTo, world.checkpoints.length - 1)
      run.prompt =
        index > run.checkpoint
          ? 'PRESS E TO SPEND THE COIN AND SKIP AHEAD'
          : 'YOU CLIMBED PAST WHAT THE COIN BUYS'
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
  // Every fall repairs the tower. A crumbling pad that stays down is a wall
  // for everybody behind you, and for you on the next attempt.
  restoreCrumblingPads()
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
