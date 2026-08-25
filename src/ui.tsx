import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { formatTime } from './game/format'
import { lifetimeScore, Phase, run, runScore } from './game/state'

type Handlers = { next: () => void; retry: () => void; restart: () => void }

let handlers: Handlers = { next: () => {}, retry: () => {}, restart: () => {} }

/**
 * Phones get their own layout, not a shrunk desktop one: fewer lines, larger
 * type, and controls sized for a thumb. Resolved once - the platform cannot
 * change mid-session.
 */
let compact = false

/** Height of the client's own place-name card, top-left, in virtual units. */
const PLACE_CARD_CLEARANCE = 120

export function setupUi(next: Handlers) {
  handlers = next
  compact = isMobile()

  // The mobile client's own canvas is 1600x720; matching it keeps these pixel
  // values meaning the same thing on both platforms.
  //
  // screenInset 'interactable' asks the client for the area it has left free
  // of its OWN controls, and on a phone that means the whole left-hand column
  // - chat, profile, joystick, emotes - is excluded. The HUD used to sit at
  // top-left, which is exactly that column: on a handset it would have been
  // drawn underneath the client's furniture, competing for the same taps.
  //
  // Only on mobile. The docs are explicit that this is not a no-op on desktop
  // - the desktop client reserves roughly the left 25% - so applying it there
  // would move a layout that is already correct.
  ReactEcsRenderer.setUiRenderer(uiRoot, {
    virtualWidth: compact ? 1600 : 1920,
    virtualHeight: compact ? 720 : 1080,
    screenInset: compact ? 'interactable' : 'device'
  })
}

const PANEL = Color4.create(0.02, 0.03, 0.06, 0.82)
const NEON = Color4.create(0.3, 0.95, 1, 1)
const GOLD = Color4.create(1, 0.82, 0.25, 1)
const DIM = Color4.create(1, 1, 1, 0.5)
/** The unfilled part of the progress bar. Dark enough to read on bright sky. */
const TRACK = Color4.create(0, 0, 0, 0.45)
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
  buttonText: compact ? 34 : 30,
  barHeight: compact ? 14 : 11
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
    {/*
      The ranking earns its place only when there is somebody to be ranked
      against. Alone it read "HIGHEST NOW / 1. yourname 2m" - a scoreboard
      announcing that you lead a field of one - and on a phone that is three
      lines of nothing in the one part of the screen a player actually needs.
      Desktop keeps the floating corner panel; the phone gets it inside the
      HUD column, and only with company.
    */}
    {!compact && run.climbers > 1 && run.ranking.length > 0 && rankingPanel()}
    {/*
      Desktop only. On a phone the status block already says CONNECTING... on
      its own last line, and this banner was pinned at a hard-coded 200 units
      from the top - measured against a block that has since grown a line -
      so it landed inside the HUD and printed a second sentence on top of the
      first. Two messages saying the same thing, overlapping, on the smaller
      screen. The same magic-offset mistake as the ranking, in the same file.
    */}
    {!compact && !run.serverAlive && wakingBanner()}
    {run.announcement !== '' && announcementBanner()}
    {run.prompt !== '' && promptBanner()}
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
 * How far up the tower you are, as one glance.
 *
 * "SECTION 7/20" is a number you have to read and then convert into a feeling.
 * A bar is the feeling directly, which is what matters on a phone held in one
 * hand. Four segments rather than twenty: at twenty each slice is two pixels
 * wide on a small screen and the whole thing turns into a dashed line.
 *
 * The segments are the four bands, so the bar and the band name underneath it
 * are saying the same thing in two ways rather than competing.
 */
const SEGMENTS = 4

const progressBar = () => {
  const s = style()
  const total = Math.max(1, run.totalSections)
  const done = Math.min(1, Math.max(0, (run.section - 1) / total))
  const perSegment = 1 / SEGMENTS

  return (
    <UiEntity uiTransform={{ width: '100%', height: s.barHeight, flexDirection: 'row' }}>
      {[0, 1, 2, 3].map((index) => {
        const start = index * perSegment
        // How much of THIS segment is behind the climber, 0..1.
        const filled = Math.min(1, Math.max(0, (done - start) / perSegment))
        // PositionUnit is `${number}%`, so the percentage has to be typed as a
        // template literal rather than assembled with string concatenation.
        const width: `${number}%` = `${Math.round(filled * 100)}%`
        return (
          <UiEntity
            key={index}
            uiTransform={{
              flexGrow: 1,
              height: '100%',
              margin: { right: index === SEGMENTS - 1 ? 0 : 4 }
            }}
            uiBackground={{ color: TRACK }}
          >
            <UiEntity
              uiTransform={{ width, height: '100%' }}
              uiBackground={{ color: filled >= 1 ? GOLD : NEON }}
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

/**
 * Four lines, and never a fifth. On a phone the screen is the game, and every
 * line of chrome is a line of tower nobody can see. Personal best rides along
 * with the round number rather than earning a row of its own.
 */
const hud = () => {
  const s = style()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        // Top-centre on a phone. "Top-center - non-actionable messages, status
        // and notifications" is the documented home for exactly this, and it
        // keeps the clock away from both the left-hand controls and the
        // top-right corner that reads as the client's own HUD.
        // On desktop the client parks its own place-name card in the top-left
        // corner, and our first line rendered straight under it. The client
        // overlay is not part of our canvas and screenInset does not reserve
        // it, so the only thing that separates the two is this offset.
        position: compact
          ? { top: s.edge, left: '50%' }
          : { top: PLACE_CARD_CLEARANCE, left: s.edge },
        margin: compact ? { left: -(s.hudWidth / 2) } : {},
        width: s.hudWidth,
        flexDirection: 'column',
        padding: compact ? 14 : 18
      }}
    >
      <Label
        value={
          run.personalBest > 0 ? 'YOUR BEST ' + formatTime(run.personalBest) : 'FIRST CLIMB'
        }
        fontSize={s.line}
        color={GOLD}
        textAlign="middle-left"
      />
      <Label value={formatTime(run.time)} fontSize={s.clock} color={NEON} textAlign="middle-left" />
      {progressBar()}
      {/*
        Two labels, not one.
        
        This was a single line - band, falls and coins joined by separators -
        and it fitted until the coin count went from 8 to 12. Then it wrapped
        inside the panel and broke after a separator, leaving a dangling
        middle dot on the first line and the word COINS orphaned on the
        second. A HUD that reflows differently depending on how many coins
        exist is a HUD that will do it again on the next tuning pass.
      */}
      <Label
        value={run.band + '   ·   FALLS ' + run.falls}
        fontSize={s.line}
        color={Color4.White()}
        textAlign="middle-left"
      />
      {run.pickupsTotal > 0 && (
        <Label
          value={'COINS ' + run.pickupsFound + '/' + run.pickupsTotal}
          fontSize={s.line}
          /* Gold, because the coins are gold. Hue carries identity here. */
          color={GOLD}
          textAlign="middle-left"
        />
      )}
      {/*
        The score for THIS climb.
        
        A clock rewards exactly one kind of player - the one who already knows
        the route. This is the number that moves for everybody else: banking a
        checkpoint pays, taking a coin pays more, and reaching the crown pays
        most. Somebody who never finishes still leaves with a number that went
        up.
      */}
      <Label
        value={'SCORE ' + runScore()}
        fontSize={s.line}
        color={NEON}
        textAlign="middle-left"
      />
      {/*
        The fourth and last line. It used to count down a shared round clock;
        with one permanent tower there is no such clock, and the most useful
        thing this line can say is whether anybody else is here.
      */}
      <Label
        value={
          run.climbers > 1
            ? run.climbers + ' CLIMBING NOW'
            : run.serverAlive
              // The fourth line is the only place the game can say, to
              // somebody standing alone in it, that being alone is not the
              // whole of it. "You have the tower to yourself" is a fact; on
              // its own it reads as an empty room rather than an invitation.
              // Shorter on a phone. At 430 units wide the full sentence wraps
              // to two lines, and every line this block grows is a line the
              // things below it have to dodge - which is how the ranking and
              // the waking banner ended up printed on top of it.
              ? compact
                ? 'SOME OF THIS NEEDS TWO'
                : 'ALONE HERE  -  SOME OF THIS NEEDS TWO'
              : 'CONNECTING...'
        }
        fontSize={s.line}
        color={run.climbers > 1 ? GOLD : NEON}
        textAlign="middle-left"
      />
      {/*
        On a phone the ranking is part of THIS column, not a floating panel.
        
        It used to be absolutely positioned at a hard-coded 250 units from the
        top, measured against a status block that had four lines in it. Adding
        a fifth - the score - pushed the block down to roughly 320 and the two
        overlapped, which is only visible on a handset and was found on the
        first one that ever ran this. A number that describes where something
        else ends is a number that goes stale the moment that thing changes;
        inside the column the layout cannot lie.
      */}
      {compact && run.climbers > 1 && run.ranking.length > 0 && rankingRows()}
    </UiEntity>
  )
}

/**
 * Who is highest in the tower right now. This is the point of playing here
 * rather than alone: the people above you are real and you can catch them.
 */
const rankingRows = () => {
  const s = style()
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { top: 10 } }}>
      <Label
        value={'HIGHEST NOW   ' + run.climbers + ' CLIMBING'}
        fontSize={s.line}
        color={NEON}
        textAlign="middle-left"
      />
      {run.ranking.map((climber, index) => (
        <Label
          key={index}
          value={index + 1 + '. ' + climber.name + '   ' + climber.height + 'm'}
          fontSize={s.line}
          color={index === 0 ? GOLD : Color4.White()}
          textAlign="middle-left"
        />
      ))}
    </UiEntity>
  )
}

const rankingPanel = () => {
  const s = style()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        // Top-right is the one corner the mobile docs single out: the profile
        // and camera controls sit just outside the interactable area, so scene
        // UI hugging it "reads as part of the client's HUD". On a phone this
        // panel drops below the status block instead, which keeps it in
        // top-centre - the place the same docs name for non-actionable
        // information. Desktop keeps the corner, where nothing competes.
        // Desktop only now - see the note where this is called.
        position: { top: s.edge, right: s.edge },
        width: 340,
        flexDirection: 'column',
        padding: compact ? 14 : 16
      }}
    >
      <Label
        value={run.climbers > 1 ? 'HIGHEST NOW   ' + run.climbers + ' CLIMBING' : 'HIGHEST NOW'}
        fontSize={s.line}
        color={NEON}
        textAlign="middle-left"
      />
      {run.ranking.map((climber, index) => (
        <Label
          key={index}
          value={index + 1 + '. ' + climber.name + '   ' + climber.height + 'm'}
          fontSize={s.line}
          color={index === 0 ? GOLD : Color4.White()}
          textAlign="middle-left"
        />
      ))}
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
      >
        <Label value="Waking the server up..." fontSize={s.banner} color={GOLD} />
      </UiEntity>
    </UiEntity>
  )
}

/** Someone else just did something. Sits high, out of the climbing sightline. */
const announcementBanner = () => {
  const s = style()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        width: '100%',
        height: 80,
        position: { top: compact ? 130 : 170 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          height: 72,
          minWidth: compact ? 480 : 560,
          alignItems: 'center',
          justifyContent: 'center',
          padding: { left: 30, right: 30 }
        }}
        uiBackground={{ color: GOLD }}
      >
        <Label value={run.announcement} fontSize={s.line} color={Color4.Black()} />
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
        // Low enough to clear the gate's own signage. A HUD line and a 3D
        // label are drawn by different systems and neither knows about the
        // other, so the only thing keeping them apart is where they are put.
        position: { bottom: compact ? 150 : 96 },
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
        <Label value="THE CROWN" fontSize={s.title * 0.75} color={GOLD} />
        <Label value={formatTime(run.time)} fontSize={s.clock} color={NEON} />
        <Label
          value={(run.lastWasBest ? 'Your best yet.   ' : '') + 'Falls: ' + run.falls}
          fontSize={s.body}
          color={Color4.White()}
        />
        {/*
          The server has counted every summit this wallet has ever reached and
          was already sending the number - it just had nowhere to appear. This
          is the one moment a player cares about it.
        */}
        {run.climbs > 0 && (
          <Label
            value={run.climbs === 1 ? 'Your first summit.' : 'Summit number ' + run.climbs + '.'}
            fontSize={s.body}
            color={GOLD}
          />
        )}
        {/*
          What the climb was worth, and what the wallet is worth.
          
          Two numbers rather than one because they answer different questions:
          the first is "was this a good run", the second is "what do I have to
          show for coming back". The lifetime figure is derived from the coins
          found and the summits counted, so it cannot disagree with either.
        */}
        <Label
          value={'This climb: ' + runScore() + ' points'}
          fontSize={s.body}
          color={NEON}
        />
        <Label
          value={'Total: ' + lifetimeScore() + ' points'}
          fontSize={s.body}
          color={GOLD}
        />
        <Label
          value={'Climb it again for a faster time.'}
          fontSize={s.body}
          color={DIM}
        />
        {/*
          The deltas, and the reason this panel exists at all. A time on its
          own is a number; the same time next to "played it safe twice, +7.4s"
          is an argument for climbing again.
        */}
        {run.choices.map((choice, index) => (
          <Label
            key={index}
            value={
              'Zone ' + choice.zone + '  -  ' +
              (choice.bold ? 'took the bold arm  ' : 'played it safe  ') +
              (choice.delta < 0 ? '' : '+') + choice.delta.toFixed(1) + 's'
            }
            fontSize={s.body * 0.92}
            color={choice.bold ? GOLD : DIM}
          />
        ))}
        {run.climbers > 1 && (
          <Label
            value={'Still climbing: ' + (run.climbers - 1)}
            fontSize={s.body}
            color={DIM}
          />
        )}
        {button('CLIMB AGAIN', handlers.retry, GOLD)}
      </UiEntity>
    </UiEntity>
  )
}
