import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { TOTAL_ROUNDS } from './game/config'
import { formatTime } from './game/format'
import { Phase, run } from './game/state'

type Handlers = { next: () => void; retry: () => void; restart: () => void }

let handlers: Handlers = { next: () => {}, retry: () => {}, restart: () => {} }

/**
 * Phones get their own layout, not a shrunk desktop one: fewer lines, larger
 * type, and controls sized for a thumb. Resolved once - the platform cannot
 * change mid-session.
 */
let compact = false

export function setupUi(next: Handlers) {
  handlers = next
  compact = isMobile()

  // The mobile client's own canvas is 1600x720; matching it keeps these pixel
  // values meaning the same thing on both platforms.
  ReactEcsRenderer.setUiRenderer(uiRoot, {
    virtualWidth: compact ? 1600 : 1920,
    virtualHeight: compact ? 720 : 1080
  })
}

const PANEL = Color4.create(0.02, 0.03, 0.06, 0.82)
const NEON = Color4.create(0.3, 0.95, 1, 1)
const GOLD = Color4.create(1, 0.82, 0.25, 1)
const DIM = Color4.create(1, 1, 1, 0.5)
const WARN = Color4.create(1, 0.45, 0.4, 1)

/** Everything that differs between a phone and a monitor lives here. */
const style = () => ({
  edge: compact ? 16 : 28,
  hudWidth: compact ? 430 : 400,
  clock: compact ? 58 : 46,
  line: compact ? 26 : 22,
  title: compact ? 46 : 62,
  body: compact ? 24 : 21,
  banner: compact ? 30 : 30,
  buttonHeight: compact ? 116 : 84,
  buttonWidth: compact ? 380 : 300,
  buttonText: compact ? 34 : 30
})

/** mm:ss for the shared round clock. */
const countdown = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  const rest = whole % 60
  return Math.floor(whole / 60) + ':' + (rest < 10 ? '0' + rest : rest)
}

const uiRoot = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
    {hud()}
    {!run.serverAlive && wakingBanner()}
    {run.prompt !== '' && promptBanner()}
    {run.phase === Phase.Ready && readyPanel()}
    {(run.phase === Phase.RoundDone || run.phase === Phase.AllDone) && clearedPanel()}
  </UiEntity>
)

const button = (text: string, onClick: () => void, color: Color4 = NEON) => {
  const s = style()
  return (
    <UiEntity
      uiTransform={{
        width: s.buttonWidth,
        height: s.buttonHeight,
        margin: { top: 16 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color }}
      onMouseDown={onClick}
    >
      <Label value={text} fontSize={s.buttonText} color={Color4.Black()} />
    </UiEntity>
  )
}

/**
 * Four lines on a phone, five on a monitor. Falls and checkpoints share a row
 * on mobile - a climb needs the screen more than the statistics do.
 */
const hud = () => {
  const s = style()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: s.edge, left: s.edge },
        width: s.hudWidth,
        flexDirection: 'column',
        padding: compact ? 14 : 18
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label
        value={'ROUND ' + run.round + ' / ' + TOTAL_ROUNDS}
        fontSize={s.line}
        color={GOLD}
        textAlign="middle-left"
      />
      <Label value={formatTime(run.time)} fontSize={s.clock} color={NEON} textAlign="middle-left" />
      <Label
        value={'SECTION ' + run.section + '/' + run.totalSections + '   FALLS ' + run.falls}
        fontSize={s.line}
        color={Color4.White()}
        textAlign="middle-left"
      />
      <Label
        value={'ALL END IN ' + countdown(run.roundEndsIn)}
        fontSize={s.line}
        color={run.roundEndsIn < 30 ? WARN : NEON}
        textAlign="middle-left"
      />
      <Label
        value={
          'BEST ' +
          (run.personalBest > 0 ? formatTime(run.personalBest) : '--:--.--') +
          (run.climbs > 0 ? '   CLIMBS ' + run.climbs : '')
        }
        fontSize={s.line}
        color={DIM}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

/**
 * A cold server takes about 15 seconds to boot and swallows anything sent
 * before it is up, so say so rather than letting the scene look broken.
 */
const wakingBanner = () => {
  const s = style()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: 90,
        position: { top: compact ? 200 : 300 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{ height: 80, minWidth: 520, alignItems: 'center', justifyContent: 'center', padding: 22 }}
        uiBackground={{ color: PANEL }}
      >
        <Label value="Waking the server up..." fontSize={s.banner} color={GOLD} />
      </UiEntity>
    </UiEntity>
  )
}

/** Contextual line near a gate. Sits low so it never covers the climb. */
const promptBanner = () => {
  const s = style()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: 90,
        position: { bottom: compact ? 210 : 170 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          height: 80,
          minWidth: compact ? 520 : 620,
          alignItems: 'center',
          justifyContent: 'center',
          padding: { left: 32, right: 32 }
        }}
        uiBackground={{ color: PANEL }}
      >
        <Label value={run.prompt} fontSize={s.banner} color={GOLD} />
      </UiEntity>
    </UiEntity>
  )
}

/**
 * The briefing. On a phone it is three lines and nothing else - the gate says
 * START, the board shows the times, and a wall of text on a small screen is
 * the fastest way to lose someone in the first ten seconds.
 */
const readyPanel = () => {
  const s = style()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: compact ? { bottom: s.edge, left: s.edge } : { top: 150, right: 40 },
        width: compact ? 560 : 520,
        flexDirection: 'column',
        padding: compact ? 18 : 24
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label value="CLIMB THE TOWER" fontSize={s.title * 0.6} color={NEON} textAlign="middle-left" />
      <Label
        value={
          compact
            ? '\nWalk through the START gate.\nCyan rings save your progress.\nRed hurts. Orange crumbles.'
            : '\nWalk through the START gate to begin.\n\n' +
              'Cyan rings save your progress.\n' +
              'Red beams and bars knock you back.\n' +
              'Orange pads crumble under you.\n' +
              'No gliding and no double jump: everyone climbs the same way.'
        }
        fontSize={s.body}
        color={Color4.White()}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}

/** Shown after a finish, until the server rolls everyone into the next round. */
const clearedPanel = () => {
  const s = style()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: compact ? 620 : 780,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: compact ? 22 : 30
        }}
        uiBackground={{ color: PANEL }}
      >
        <Label value="TOP OF THE TOWER" fontSize={s.title * 0.75} color={GOLD} />
        <Label value={formatTime(run.time)} fontSize={s.clock} color={NEON} />
        <Label
          value={(run.lastWasBest ? 'Your best yet.   ' : '') + 'Falls: ' + run.falls}
          fontSize={s.body}
          color={Color4.White()}
        />
        <Label value="Everyone starts the next round together." fontSize={s.body} color={DIM} />
        {button('CLIMB AGAIN', handlers.retry, GOLD)}
      </UiEntity>
    </UiEntity>
  )
}
