import Type, { type Static } from 'typebox'
import { localParts } from '../engine/time.js'
import type { ContentType, Ctx, Position, WeatherData } from '../engine/types.js'
import { compass } from '../engine/units.js'
import type { WeatherBlockData, WeatherCondition, WeatherDay } from './data.js'
import { isNum, joinParts, shownAs } from './helpers.js'

const Schema = Type.Object({
  days: Type.Integer({ title: 'Days', description: 'Today and the following days', default: 2, minimum: 1, maximum: 7 }),
  waves: Type.Boolean({ title: 'Include waves', default: true }),
  warnings: Type.Boolean({ title: 'Include weather warnings', default: true }),
  description: Type.Boolean({
    title: "Include the provider's description",
    description: 'A weather text such as "Partly cloudy". Some providers put model details here instead.',
    default: true
  })
})
type Config = Static<typeof Schema>

// Forecasts are not in the data tree; these paths only lend their display units.
const UNIT = {
  temperature: 'environment.outside.temperature',
  wind: 'environment.wind.speedTrue'
}

/** Hourly points only add waves; a slow answer must not cost the daily forecast. */
const POINTS_WAIT_MS = 5_000

/** The day's symbol in push messages. */
export const CONDITION_EMOJI: Record<WeatherCondition, string> = {
  clear: '☀️',
  partly: '⛅',
  cloudy: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  showers: '🌦️',
  thunder: '⛈️',
  snow: '❄️'
}

/** Gusts from 30 kn get their own wind symbol. */
const WINDY_GUST = 15.4

export interface DaySummary {
  date: string
  description?: string
  minTemperature?: number
  maxTemperature?: number
  windSpeed?: number
  windDirection?: number
  gust?: number
  /** Metres of water. */
  precipitation?: number
  /** Chance of rain (0–1). */
  rainChance?: number
  cloudCover?: number
  waveHeight?: number
}

const max = (xs: Array<number | undefined>): number | undefined => {
  const ns = xs.filter(isNum)
  return ns.length ? Math.max(...ns) : undefined
}
const min = (xs: Array<number | undefined>): number | undefined => {
  const ns = xs.filter(isNum)
  return ns.length ? Math.min(...ns) : undefined
}
const sum = (xs: Array<number | undefined>): number | undefined => {
  const ns = xs.filter(isNum)
  return ns.length ? ns.reduce((a, b) => a + b, 0) : undefined
}
const avg = (xs: Array<number | undefined>): number | undefined => {
  const ns = xs.filter(isNum)
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : undefined
}
/** Providers give a chance of rain as a ratio or as percent. */
const ratio = (v: unknown): number | undefined => (isNum(v) ? (v > 1 ? v / 100 : v) : undefined)

/**
 * The ship's date a forecast entry belongs to. A daily entry stands for a
 * whole day and is stamped at that day's UTC midnight, which shifting by the
 * ship's offset would move to the day before west of Greenwich.
 */
function dayOf(item: WeatherData, kind: 'daily' | 'point', offsetMin: number): string | undefined {
  const t = Date.parse(item.date)
  if (Number.isNaN(t)) return undefined
  return kind === 'daily' ? item.date.slice(0, 10) : localParts(new Date(t), offsetMin).isoDate
}

function group(items: WeatherData[], kind: 'daily' | 'point', offsetMin: number, today: string): Map<string, WeatherData[]> {
  const byDay = new Map<string, WeatherData[]>()
  for (const item of items) {
    const day = dayOf(item, kind, offsetMin)
    if (!day || day < today) continue
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }
  return byDay
}

/**
 * One summary per ship-local day. Daily forecasts give the day's text, range
 * and wind; hourly points fill in what daily entries lack (waves, cloud), or
 * the whole day when a provider has no daily forecast.
 */
export function summarize(daily: WeatherData[], points: WeatherData[], offsetMin: number, days: number, now: Date): DaySummary[] {
  const today = localParts(now, offsetMin).isoDate
  const byDaily = group(daily, 'daily', offsetMin, today)
  const byPoint = group(points, 'point', offsetMin, today)
  return [...new Set([...byDaily.keys(), ...byPoint.keys()])]
    .sort()
    .slice(0, days)
    .map((date) => {
      const d = byDaily.get(date)?.[0]
      const ps = byPoint.get(date) ?? []
      const strongest = ps.reduce<WeatherData | undefined>(
        (best, x) => ((x.wind?.speedTrue ?? -1) > (best?.wind?.speedTrue ?? -1) ? x : best),
        undefined
      )
      const rain = (x: WeatherData) => ratio(x.outside?.precipitationProbability)
      return {
        date,
        description: d?.description ?? ps.find((x) => x.description)?.description,
        minTemperature: d?.outside?.minTemperature ?? min(ps.map((x) => x.outside?.minTemperature ?? x.outside?.temperature)),
        maxTemperature: d?.outside?.maxTemperature ?? max(ps.map((x) => x.outside?.maxTemperature ?? x.outside?.temperature)),
        windSpeed: d?.wind?.speedTrue ?? strongest?.wind?.speedTrue,
        windDirection: d?.wind?.directionTrue ?? strongest?.wind?.directionTrue,
        gust: d?.wind?.gust ?? max(ps.map((x) => x.wind?.gust)),
        precipitation: d?.outside?.precipitationVolume ?? sum(ps.map((x) => x.outside?.precipitationVolume)),
        rainChance: (d && rain(d)) ?? max(ps.map(rain)),
        cloudCover: d?.outside?.cloudCover ?? avg(ps.map((x) => x.outside?.cloudCover)),
        waveHeight: max(ps.map((x) => x.water?.waveSignificantHeight)) ?? d?.water?.waveSignificantHeight
      }
    })
}

/** A symbol for the day: from the provider's text (WMO weather codes) when there is one, else from the numbers. */
export function conditionOf(d: DaySummary): WeatherCondition {
  const text = d.description?.toLowerCase() ?? ''
  if (text.includes('thunder')) return 'thunder'
  if (text.includes('snow')) return 'snow'
  if (text.includes('shower')) return 'showers'
  if (text.includes('drizzle')) return 'drizzle'
  if (text.includes('rain')) return 'rain'
  if (text.includes('fog')) return 'fog'
  if (text.includes('overcast')) return 'cloudy'
  if (text.includes('partly') || text.includes('cloud')) return 'partly'
  if (text.includes('clear')) return 'clear'
  if ((d.precipitation ?? 0) >= 0.001 || (d.rainChance ?? 0) >= 0.5) return 'rain'
  if ((d.cloudCover ?? 0) >= 0.7) return 'cloudy'
  if ((d.cloudCover ?? 0) >= 0.3) return 'partly'
  return 'clear'
}

function dayName(date: string, today: string, ctx: Ctx): string {
  if (date === today) return 'Today'
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  if (date === next) return 'Tomorrow'
  // A ship's date shown with its own weekday, independent of the offset.
  return new Date(`${date}T12:00:00Z`).toUTCString().slice(0, 11).replace(',', '')
}

export function toDay(ctx: Ctx, d: DaySummary, name: string, waves: boolean, description: boolean): WeatherDay {
  const lo = shownAs(ctx, UNIT.temperature, d.minTemperature)
  const hi = shownAs(ctx, UNIT.temperature, d.maxTemperature)
  // Volumes come in metres of water; rain reads best in millimetres.
  const mm = isNum(d.precipitation) ? Math.round(d.precipitation * 1000) : 0
  const chance = isNum(d.rainChance) ? Math.round(d.rainChance * 100) : 0
  return {
    date: d.date,
    name,
    condition: conditionOf(d),
    description: description ? d.description : undefined,
    temperatureText: lo && hi && lo !== hi ? `${lo.replace(/ ?°.*$/, '')} to ${hi}` : (hi ?? lo),
    windText: shownAs(ctx, UNIT.wind, d.windSpeed),
    windDirection: d.windDirection,
    compass: isNum(d.windDirection) ? compass(d.windDirection) : undefined,
    gustText: shownAs(ctx, UNIT.wind, d.gust),
    windy: (d.gust ?? 0) >= WINDY_GUST,
    rainText: mm >= 1 ? `rain ${mm} mm` : chance >= 20 ? `rain ${chance}%` : undefined,
    waveText: waves && isNum(d.waveHeight) ? `waves ${d.waveHeight.toFixed(1)} m` : undefined
  }
}

export function describeDay(day: WeatherDay): string {
  const parts = joinParts([
    day.description,
    day.temperatureText,
    day.windText && `wind ${day.windText}${day.compass ? ` from ${day.compass}` : ''}`,
    day.gustText && `gusts ${day.gustText}`,
    day.rainText,
    day.waveText
  ])
  return `${day.name}: ${parts || 'no details'}`
}

export const weatherContent: ContentType<Config> = {
  id: 'weather',
  emoji: '⛅',
  title: 'Weather forecast',
  description: "Forecast for the vessel's position from the Signal K weather API (needs a weather provider plugin).",
  schema: Schema,
  async fetch(ctx, config) {
    const api = ctx.weather()
    if (!api) throw new Error('no weather provider')
    const p = ctx.getSelf('navigation.position') as Partial<Position> | undefined
    if (!p || !isNum(p.latitude) || !isNum(p.longitude)) throw new Error('no position')
    const position = { latitude: p.latitude, longitude: p.longitude }
    const offset = ctx.utcOffsetMinutes()
    const now = ctx.now()
    // Hourly points only add waves: once a usable daily forecast is there,
    // wait for points that are still pending only a little longer.
    let settled: WeatherData[] | undefined
    const pointsRequest = api
      .getForecasts(position, 'point', { maxCount: (config.days + 1) * 24 })
      .catch(() => [] as WeatherData[])
      .then((p) => (settled = p ?? []))
    const daily = (await api.getForecasts(position, 'daily', { maxCount: config.days + 1 }).catch(() => [] as WeatherData[])) ?? []
    let points: WeatherData[]
    if (settled) points = settled
    else if (!summarize(daily, [], offset, config.days, now).length) points = await pointsRequest
    else {
      let timer: NodeJS.Timeout | undefined
      points = await Promise.race([
        pointsRequest,
        new Promise<WeatherData[]>((resolve) => {
          timer = setTimeout(() => resolve([]), POINTS_WAIT_MS)
        })
      ]).finally(() => clearTimeout(timer))
    }
    const summaries = summarize(daily, points, offset, config.days, now)
    if (!summaries.length) throw new Error('the provider returned no forecast')
    const today = localParts(now, offset).isoDate
    const days = summaries.map((d) => toDay(ctx, d, dayName(d.date, today, ctx), config.waves, config.description))
    const lines = days.map(describeDay)

    const warnings: string[] = []
    if (config.warnings && api.getWarnings) {
      try {
        for (const w of (await api.getWarnings(position)) ?? []) if (w.details) warnings.push(w.details)
      } catch (error) {
        ctx.log.debug(`weather warnings: ${String(error)}`)
      }
    }
    const data: WeatherBlockData = { days, warnings }
    const text = [...lines, ...warnings.map((w) => `Warning: ${w}`)].join('. ')
    const items = [
      ...days.map((d) => `${CONDITION_EMOJI[d.condition]} ${d.name}: ${describeDay(d).slice(d.name.length + 2).replace(/, /g, ' · ')}`),
      ...warnings.map((w) => `⚠️ ${w}`)
    ]
    return { title: 'Weather', text: `Weather. ${text}.`, summary: 'Weather', items, emoji: CONDITION_EMOJI[days[0]!.condition], data }
  }
}
