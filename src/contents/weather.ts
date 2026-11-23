import Type, { type Static } from 'typebox'
import { localParts } from '../engine/time.js'
import type { ContentType, Ctx, Position, WeatherData } from '../engine/types.js'
import { compass } from '../engine/units.js'
import { isNum, joinParts, shownAs } from './helpers.js'

const Schema = Type.Object({
  days: Type.Integer({ title: 'Days', description: 'Today and the following days', default: 2, minimum: 1, maximum: 7 }),
  waves: Type.Boolean({ title: 'Include waves', default: true }),
  warnings: Type.Boolean({ title: 'Include weather warnings', default: true }),
  description: Type.Boolean({
    title: "Include the provider's description",
    description: 'Some providers put a weather text here, others model and run details.',
    default: false
  })
})
type Config = Static<typeof Schema>

// Forecasts are not in the data tree; these paths only lend their display units.
const UNIT = {
  temperature: 'environment.outside.temperature',
  wind: 'environment.wind.speedTrue',
  pressure: 'environment.outside.pressure'
}

export interface DaySummary {
  date: string
  description?: string
  minTemperature?: number
  maxTemperature?: number
  windSpeed?: number
  windDirection?: number
  gust?: number
  precipitation?: number
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

/** One summary per ship-local day, from daily forecasts or, when a provider only has those, hourly points. */
export function summarize(items: WeatherData[], offsetMin: number, days: number, now: Date): DaySummary[] {
  const today = localParts(now, offsetMin).isoDate
  const byDay = new Map<string, WeatherData[]>()
  for (const item of items) {
    const t = Date.parse(item.date)
    if (Number.isNaN(t)) continue
    const day = localParts(new Date(t), offsetMin).isoDate
    if (day < today) continue
    byDay.set(day, [...(byDay.get(day) ?? []), item])
  }
  return [...byDay.keys()]
    .sort()
    .slice(0, days)
    .map((date) => {
      const xs = byDay.get(date)!
      const strongest = xs.reduce<WeatherData | undefined>(
        (best, x) => ((x.wind?.speedTrue ?? -1) > (best?.wind?.speedTrue ?? -1) ? x : best),
        undefined
      )
      return {
        date,
        description: xs.find((x) => x.description)?.description,
        minTemperature: min(xs.map((x) => x.outside?.minTemperature ?? x.outside?.temperature)),
        maxTemperature: max(xs.map((x) => x.outside?.maxTemperature ?? x.outside?.temperature)),
        windSpeed: strongest?.wind?.speedTrue,
        windDirection: strongest?.wind?.directionTrue,
        gust: max(xs.map((x) => x.wind?.gust)),
        precipitation: sum(xs.map((x) => x.outside?.precipitationVolume)),
        waveHeight: max(xs.map((x) => x.water?.waveSignificantHeight))
      }
    })
}

function dayName(date: string, today: string, offsetMin: number, ctx: Ctx): string {
  if (date === today) return 'Today'
  const next = localParts(new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000), 0).isoDate
  if (date === next) return 'Tomorrow'
  return ctx.date(new Date(Date.parse(`${date}T12:00:00Z`) - offsetMin * 60_000))
}

export function describeDay(ctx: Ctx, d: DaySummary, name: string, waves: boolean, description = false): string {
  const lo = shownAs(ctx, UNIT.temperature, d.minTemperature)
  const hi = shownAs(ctx, UNIT.temperature, d.maxTemperature)
  const temp = lo && hi && lo !== hi ? `${lo.replace(/ ?°.*$/, '')} to ${hi}` : (hi ?? lo)
  const wind = shownAs(ctx, UNIT.wind, d.windSpeed)
  const from = isNum(d.windDirection) ? ` from ${compass(d.windDirection)}` : ''
  const gust = shownAs(ctx, UNIT.wind, d.gust)
  // Volumes come in metres of water; rain reads best in millimetres.
  const rain = isNum(d.precipitation) && d.precipitation * 1000 >= 0.5 ? `rain ${Math.round(d.precipitation * 1000)} mm` : undefined
  const wave = waves && isNum(d.waveHeight) ? `waves ${d.waveHeight.toFixed(1)} m` : undefined
  const parts = joinParts([
    description ? d.description : undefined,
    temp,
    wind && `wind ${wind}${from}`,
    gust && `gusts ${gust}`,
    rain,
    wave
  ])
  return `${name}: ${parts || 'no details'}`
}

export const weatherContent: ContentType<Config> = {
  id: 'weather',
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
    let items = await api.getForecasts(position, 'daily', { maxCount: config.days + 1 })
    if (!items?.length) items = await api.getForecasts(position, 'point', { maxCount: config.days * 24 })
    const summaries = summarize(items ?? [], offset, config.days, now)
    if (!summaries.length) throw new Error('the provider returned no forecast')
    const today = localParts(now, offset).isoDate
    const lines = summaries.map((d) => describeDay(ctx, d, dayName(d.date, today, offset, ctx), config.waves, config.description))

    if (config.warnings && api.getWarnings) {
      try {
        const warnings = (await api.getWarnings(position)) ?? []
        for (const w of warnings) if (w.details) lines.push(`Warning: ${w.details}`)
      } catch (error) {
        ctx.log.debug(`weather warnings: ${String(error)}`)
      }
    }
    return { title: 'Weather', text: `Weather. ${lines.join('. ')}.`, data: summaries }
  }
}
