import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { TOTAL_ROUNDS } from './game/config'
import { formatTime } from './game/format'
import { bestFor, totalTime } from './game/leaderboard'
import { Phase, run } from './game/state'
import { themeFor } from './game/theme'

type Handlers = { next: () => void; retry: () => void; restart: () => void }

let handlers: Handlers = { next: () => {}, retry: () => {}, restart: () => {} }

export function setupUi(next: Handlers) {
  handlers = next
  ReactEcsRenderer.setUiRenderer(uiRoot, { virtualWidth: 1920, virtualHeight: 1080 })
}

const PANEL = Color4.create(0.02, 0.03, 0.06, 0.78)
const NEON = Color4.create(0.3, 0.95, 1, 1)
const GOLD = Color4.create(1, 0.82, 0.25, 1)
const DIM = Color4.create(1, 1, 1, 0.45)

const uiRoot = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
    {hud()}
    {run.prompt !== '' && promptBanner()}
    {run.phase === Phase.Ready && readyOverlay()}
    {run.phase === Phase.RoundDone && roundDoneOverlay()}
    {run.phase === Phase.AllDone && allDoneOverlay()}
  </UiEntity>
)

const button = (text: string, onClick: () => void, color: Color4 = NEON) => (
  <UiEntity
    uiTransform={{
      width: 300,
      height: 84,
      margin: { top: 18, left: 10, right: 10 },
      alignItems: 'center',
      justifyContent: 'center'
    }}
    uiBackground={{ color }}
    onMouseDown={onClick}
  >
    <Label value={text} fontSize={30} color={Color4.Black()} />
  </UiEntity>
)

const hud = () => (
  <UiEntity
    uiTransform={{
      positionType: 'absolute',
      position: { top: 28, left: 28 },
      width: 400,
      height: 245,
      flexDirection: 'column',
      padding: 18
    }}
    uiBackground={{ color: PANEL }}
  >
    <Label
      value={'ROUND ' + run.round + ' / ' + TOTAL_ROUNDS + '   ' + themeFor(run.round).name}
      fontSize={24}
      color={GOLD}
      textAlign="middle-left"
    />
    <Label value={formatTime(run.time)} fontSize={46} color={NEON} textAlign="middle-left" />
    <Label
      value={'CHECKPOINT  ' + run.checkpoint + ' / ' + run.totalCheckpoints + '      FALLS  ' + run.falls}
      fontSize={22}
      color={Color4.White()}
      textAlign="middle-left"
    />
    <Label
      value={'BEST  ' + (bestFor(run.round) ? formatTime(bestFor(run.round)!.time) : '--:--.--')}
      fontSize={22}
      color={DIM}
      textAlign="middle-left"
    />
    <Label
      value={'SECTION ' + run.section + ' / ' + run.totalSections + '   ' + run.sectionName.toUpperCase()}
      fontSize={21}
      color={GOLD}
      textAlign="middle-left"
    />
  </UiEntity>
)

/** Contextual line near a gate. Sits low so it never covers the course. */
const promptBanner = () => (
  <UiEntity
    uiTransform={{
      positionType: 'absolute',
      width: '100%',
      height: 90,
      position: { bottom: 170 },
      alignItems: 'center',
      justifyContent: 'center'
    }}
  >
    <UiEntity
      uiTransform={{
        height: 82,
        minWidth: 620,
        alignItems: 'center',
        justifyContent: 'center',
        padding: { left: 40, right: 40 }
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label value={run.prompt} fontSize={30} color={GOLD} />
    </UiEntity>
  </UiEntity>
)

const overlayFrame = (children: unknown) => (
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
        width: 860,
        height: 440,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28
      }}
      uiBackground={{ color: PANEL }}
    >
      {children}
    </UiEntity>
  </UiEntity>
)

/**
 * In the lobby the scene itself already explains things: the board shows the
 * times, the gate says START, the banner says what happens next. So the
 * briefing sits off to the right instead of covering all of it.
 */
const readyOverlay = () => (
  <UiEntity
    uiTransform={{
      positionType: 'absolute',
      position: { top: 150, right: 40 },
      width: 520,
      flexDirection: 'column',
      padding: 24
    }}
    uiBackground={{ color: PANEL }}
  >
    <Label value={'ROUND ' + run.round + ' / ' + TOTAL_ROUNDS} fontSize={40} color={NEON} textAlign="middle-left" />
    <Label value={themeFor(run.round).name + ' TOWER'} fontSize={24} color={GOLD} textAlign="middle-left" />
    <Label
      value={
        '\nW A S D  run     SPACE  jump     SHIFT  sprint\n' +
        'On touch: joystick to move, jump button to hop.\n\n' +
        'Cyan rings save your progress.\n' +
        'Red beams and bars knock you back.\n' +
        'Orange pads crumble under you.\n\n' +
        'Walk through the START gate to begin.'
      }
      fontSize={21}
      color={Color4.White()}
      textAlign="middle-left"
    />
  </UiEntity>
)

const roundDoneOverlay = () =>
  overlayFrame(
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <Label value={'ROUND ' + run.round + ' CLEARED'} fontSize={56} color={GOLD} />
      <Label value={formatTime(run.time)} fontSize={44} color={NEON} />
      <Label
        value={(run.lastWasBest ? 'New best for this round.   ' : '') + 'Falls: ' + run.falls}
        fontSize={24}
        color={Color4.White()}
      />
      <Label
        value={run.round < TOTAL_ROUNDS ? 'Up next: round ' + (run.round + 1) + ' - back to the lobby.' : ''}
        fontSize={22}
        color={NEON}
      />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {button('NEXT ROUND', handlers.next)}
        {button('RETRY', handlers.retry, GOLD)}
      </UiEntity>
    </UiEntity>
  )

const allDoneOverlay = () => {
  const total = totalTime()
  return overlayFrame(
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <Label value="ALL 10 ROUNDS CLEARED" fontSize={50} color={GOLD} />
      <Label value={'Final round: ' + formatTime(run.time)} fontSize={30} color={NEON} />
      <Label
        value={total !== null ? 'Total of every best: ' + formatTime(total) : 'Clear every round to see your total.'}
        fontSize={24}
        color={Color4.White()}
      />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {button('RUN IT AGAIN', handlers.restart)}
        {button('RETRY R10', handlers.retry, GOLD)}
      </UiEntity>
    </UiEntity>
  )
}
