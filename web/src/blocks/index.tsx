import {
  IconAlertTriangle,
  IconArrowUp,
  IconBatteryCharging,
  IconCloud,
  IconCloudFog,
  IconCloudRain,
  IconCloudSnow,
  IconCloudStorm,
  IconDroplet,
  IconGauge,
  IconMapPin,
  IconMoon,
  IconRipple,
  IconSun,
  IconWind,
  type Icon
} from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type {
  BatteryData,
  MoonData,
  PathData,
  PositionData,
  SunData,
  TankData,
  TideData,
  WeatherBlockData,
  WeatherCondition
} from '../../../src/contents/data'
import type { Block } from '../api'
import { BatteryGauge, MoonDisc, SunArc, TankGauge } from './graphics'
import { TideCurve } from './TideCurve'

function Row({ icon: I, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <section className="block-row">
      <I className="block-icon" size={22} stroke={1.6} aria-hidden="true" />
      <div className="block-body">
        <p className="block-label">{label}</p>
        {children}
      </div>
    </section>
  )
}

function Tile({ graphic, title, detail }: { graphic?: ReactNode; title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="tile">
      {graphic}
      <div>
        <strong>{title}</strong>
        {detail && <span className="muted">{detail}</span>}
      </div>
    </div>
  )
}

const join = (xs: Array<string | undefined>) => xs.filter(Boolean).join(' · ')

function Battery({ d }: { d: BatteryData }) {
  return (
    <Row icon={IconBatteryCharging} label="Batteries">
      <div className="tiles">
        {d.items.map((b) => (
          <Tile
            key={b.id}
            graphic={<BatteryGauge soc={b.soc} low={d.low} high={d.high} />}
            title={join([b.name, b.socText])}
            detail={join([b.voltageText, b.currentText && (b.current !== undefined && b.current > 0 ? `+${b.currentText}` : b.currentText), b.remainingText])}
          />
        ))}
      </div>
    </Row>
  )
}

function Tanks({ d }: { d: TankData }) {
  return (
    <Row icon={IconDroplet} label="Tanks">
      <div className="tiles">
        {d.items.map((t) => (
          <Tile key={t.id} graphic={<TankGauge level={t.level} kind={t.kind} />} title={join([t.name, t.levelText])} detail={t.volumeText} />
        ))}
      </div>
    </Row>
  )
}

function SunAndMoon({ sun, moon }: { sun?: SunData; moon?: MoonData }) {
  return (
    <Row icon={sun ? IconSun : IconMoon} label={sun && moon ? 'Sun and moon' : sun ? 'Sun' : 'Moon'}>
      <div className="tiles">
        {sun && (
          <Tile
            graphic={<SunArc sunrise={sun.sunrise} sunset={sun.sunset} now={sun.now} />}
            title={`${sun.sunriseText ?? '–'} → ${sun.sunsetText ?? '–'}`}
            detail={join([sun.dawnText && `dawn ${sun.dawnText}`, sun.duskText && `dusk ${sun.duskText}`])}
          />
        )}
        {moon && (
          <Tile
            graphic={<MoonDisc phase={moon.phase} name={moon.phaseName} fraction={moon.fraction} southern={moon.southern} />}
            title={join([moon.phaseName, moon.fraction !== undefined ? `${Math.round(moon.fraction * 100)}%` : undefined])}
            detail={moon.always ? `${moon.always} all day` : join([moon.riseText && `rises ${moon.riseText}`, moon.setText && `sets ${moon.setText}`])}
          />
        )}
      </div>
    </Row>
  )
}

function Tide({ d }: { d: TideData }) {
  const label = join([d.station ? `Tide at ${d.station}` : 'Tide', d.state, d.nowText && `now ${d.nowText}`])
  const future = d.points.filter((p) => Date.parse(p.time) > Date.parse(d.now))
  return (
    <Row icon={IconRipple} label={label}>
      <TideCurve data={d} />
      <div className="tide-marks">
        {future.slice(0, 4).map((p) => (
          <span key={p.time}>
            {p.high ? 'high' : 'low'} {p.timeText} · {p.levelText}
          </span>
        ))}
      </div>
    </Row>
  )
}

const CONDITION: Record<WeatherCondition, { icon: Icon; tone: string }> = {
  clear: { icon: IconSun, tone: 'var(--sun)' },
  partly: { icon: IconCloud, tone: 'var(--sun)' },
  cloudy: { icon: IconCloud, tone: 'var(--muted)' },
  fog: { icon: IconCloudFog, tone: 'var(--muted)' },
  drizzle: { icon: IconCloudRain, tone: 'var(--water)' },
  rain: { icon: IconCloudRain, tone: 'var(--water)' },
  showers: { icon: IconCloudRain, tone: 'var(--water)' },
  thunder: { icon: IconCloudStorm, tone: 'var(--bad)' },
  snow: { icon: IconCloudSnow, tone: 'var(--water)' }
}

function Weather({ d }: { d: WeatherBlockData }) {
  return (
    <Row icon={IconCloud} label="Weather">
      <div className="tiles">
        {d.days.map((day) => {
          const c = CONDITION[day.condition] ?? CONDITION.cloudy
          return (
            <div className="tile weather" key={day.date}>
              <span className="weather-icon" title={day.description}>
                {day.condition === 'partly' && <IconSun className="behind" size={22} stroke={1.6} color="var(--sun)" aria-hidden="true" />}
                <c.icon size={30} stroke={1.5} color={c.tone} aria-hidden="true" />
                {day.windy && <IconWind className="windy" size={18} stroke={1.8} aria-label="strong wind" />}
              </span>
              <div>
                <strong>{join([day.name, day.temperatureText])}</strong>
                {day.description && <span className="muted">{day.description}</span>}
                <span className="muted">
                  {day.windDirection !== undefined && (
                    // The arrow points where the wind blows to.
                    <IconArrowUp size={13} stroke={2} className="wind-arrow" style={{ transform: `rotate(${(day.windDirection * 180) / Math.PI + 180}deg)` }} aria-hidden="true" />
                  )}
                  {join([day.windText && `${day.compass ?? ''} ${day.windText}`.trim(), day.gustText && `gusts ${day.gustText}`])}
                </span>
                {(day.rainText || day.waveText) && <span className="muted">{join([day.rainText, day.waveText])}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {d.warnings.map((w, i) => (
        <p className="warn" key={i}>
          <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" /> {w}
        </p>
      ))}
    </Row>
  )
}

const has = (d: unknown, key: string, array = false): boolean =>
  typeof d === 'object' && d !== null && (array ? Array.isArray((d as Record<string, unknown>)[key]) : key in d)

/** Runs from older versions carry other data shapes; those fall back to text. */
const VIEWABLE: Record<string, (d: unknown) => boolean> = {
  position: (d) => has(d, 'text'),
  path: (d) => has(d, 'text') && has(d, 'label'),
  battery: (d) => has(d, 'items', true),
  tanks: (d) => has(d, 'items', true),
  sun: (d) => has(d, 'now'),
  moon: (d) => has(d, 'southern'),
  tides: (d) => has(d, 'points', true),
  weather: (d) => has(d, 'days', true)
}

/**
 * Draw a run's blocks. Sun and moon share a row. A block without a view of its
 * own, or one that failed, shows its text, so a new content type works before
 * it has a view.
 */
export function Blocks({ blocks }: { blocks: Block[] }) {
  const out: ReactNode[] = []
  const viewable = (b: Block) => !b.error && VIEWABLE[b.type]?.(b.data) === true
  const sun = blocks.find((b) => b.type === 'sun' && viewable(b))
  const moon = blocks.find((b) => b.type === 'moon' && viewable(b))
  let sunMoonDone = false
  blocks.forEach((b, i) => {
    const key = `${b.type}-${i}`
    if (!viewable(b)) {
      out.push(
        <p key={key} className={b.error ? 'block unavailable' : 'block'}>
          {b.text}
        </p>
      )
      return
    }
    switch (b.type) {
      case 'position': {
        const d = b.data as PositionData
        out.push(
          <Row key={key} icon={IconMapPin} label="Position">
            <span className="value">{d.text}</span>
          </Row>
        )
        return
      }
      case 'path': {
        const d = b.data as PathData
        out.push(
          <Row key={key} icon={IconGauge} label={d.label}>
            <span className="value">{d.text}</span>
          </Row>
        )
        return
      }
      case 'battery':
        out.push(<Battery key={key} d={b.data as BatteryData} />)
        return
      case 'tanks':
        out.push(<Tanks key={key} d={b.data as TankData} />)
        return
      case 'sun':
      case 'moon':
        if (!sunMoonDone) {
          sunMoonDone = true
          out.push(<SunAndMoon key={key} sun={sun?.data as SunData | undefined} moon={moon?.data as MoonData | undefined} />)
        }
        return
      case 'tides':
        out.push(<Tide key={key} d={b.data as TideData} />)
        return
      case 'weather':
        out.push(<Weather key={key} d={b.data as WeatherBlockData} />)
        return
      default:
        out.push(
          <p key={key} className="block">
            {b.text}
          </p>
        )
    }
  })
  return <>{out}</>
}
