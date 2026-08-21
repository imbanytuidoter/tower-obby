import { engine, MeshCollider, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import {
  CHECKPOINT_RADIUS,
  GATE_DIR_X,
  GATE_DIR_Z,
  GATE_WIDTH,
  GATE_X,
  GATE_Z,
  LOBBY_X,
  LOBBY_Y,
  LOBBY_Z,
  PROMPT_RANGE,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  FALL_GRACE,
  HAZARD_HALF_WIDTH,
  RESPAWN_COOLDOWN,
  RESPAWN_LIFT,
  TOTAL_ROUNDS
} from './game/config'
import {
  activateCheckpoint,
  buildWorld,
  clearWorld,
  paintCrumbled,
  paintGlow,
  paintPad,
  PAD_TOP,
  sectionAccent,
  World
} from './game/build'
import { buildLayout } from './game/layout'
import { submit } from './game/leaderboard'
import { buildPlaza, decorSystem, GATE_LOOK, refreshBoard } from './game/plaza'
import { play, setupSound } from './game/sound'
import { completeRound, Phase, prepareRound, run, startClock } from './game/state'
import { setupUi } from './ui'

let world: World | null = null

export function main() {
  buildPlaza()
  setupSound()
  setupUi({ next: nextRound, retry: retryRound, restart: restartAll })
  loadRound(1)

  engine.addSystem(hazardSystem, 1, 'hazardSystem')
  engine.addSystem(runSystem, 2, 'runSystem')
  engine.addSystem(decorSystem, 3, 'decorSystem')
}

function loadRound(round: number) {
  clearWorld(world)
  world = buildWorld(buildLayout(round))
  prepareRound(round, world.checkpoints.length - 1, world.sectionNames)
  // A round begins in the lobby, facing the gate the player has to walk
  // through. That crossing is what starts the clock.
  sendToLobby()
}

function nextRound() {
  if (run.round >= TOTAL_ROUNDS) return
  loadRound(run.round + 1)
}

function retryRound() {
  loadRound(run.round)
}

function restartAll() {
  loadRound(1)
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

  if (Math.abs(player.y - world.finish.y) < 1.6 && horizontalDistance(player, world.finish) <= 1.8) {
    const improved = submit(run.round, run.time, run.falls)
    refreshBoard()
    completeRound(improved)
    play('finish')
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
        ? 'ROUND ' + run.round + ' OF ' + TOTAL_ROUNDS + '  -  cross the START line to begin'
        : ''
    return
  }

  if (run.phase === Phase.Running) {
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
  sendToCheckpoint()
}

/** Drops the player back in the lobby, looking at the leaderboard. */
function sendToLobby() {
  run.respawnCooldown = RESPAWN_COOLDOWN
  void movePlayerTo({
    newRelativePosition: Vector3.create(LOBBY_X, LOBBY_Y + 1.2, LOBBY_Z),
    cameraTarget: GATE_LOOK
  })
}

function sendToCheckpoint(lookAt?: Vector3) {
  if (!world) return
  const checkpoint = world.checkpoints[run.checkpoint] ?? world.checkpoints[0]
  run.respawnCooldown = RESPAWN_COOLDOWN

  // Face the next pad, so a respawn never drops the player looking backwards.
  const ahead = world.pads[checkpoint.padIndex + 1]
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
