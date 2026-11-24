import Type from 'typebox'
import type { ContentType, Ctx } from '../engine/types.js'
import type { TideData, TidePoint } from './data.js'
import { epochAt, isNum, joinParts, shown, shownAs } from './helpers.js'

const TIDE = 'environment.tide'
const HOUR = 3_600_000

interface Extreme {
  at: number
  level: number
  high: boolean
}

/**
 * Extremes from the `tides` resource signalk-tides serves (7 days ahead), or
 * none. In the server the times are Date objects; only REST makes them strings.
 */
export function resourceExtremes(resource: unknown): Extreme[] {
  const list = (resource as { extremes?: unknown } | undefined)?.extremes
  if (!Array.isArray(list)) return []
  return list.flatMap((e: unknown) => {
    const x = e as { time?: unknown; level?: unknown; high?: unknown }
    const at = x.time instanceof Date ? x.time.getTime() : typeof x.time === 'string' ? Date.parse(x.time) : Number.NaN
    return Number.isNaN(at) || !isNum(x.level) ? [] : [{ at, level: x.level, high: x.high === true }]
  })
}

/** The next high and low water from the paths, when the resource is not there. */
function pathExtremes(ctx: Ctx): Extreme[] {
  const out: Extreme[] = []
  for (const [kind, high] of [['High', true], ['Low', false]] as const) {
    const at = epochAt(ctx, `${TIDE}.time${kind}`)
    const level = ctx.getSelf(`${TIDE}.height${kind}`)
    if (at !== undefined && isNum(level)) out.push({ at, level, high })
  }
  return out.sort((a, b) => a.at - b.at)
}

export const tideContent: ContentType<Record<string, never>> = {
  id: 'tides',
  emoji: '🌊',
  title: 'Tides',
  description: 'Tide now and the next high and low water, with a curve for the day (from signalk-tides).',
  schema: Type.Object({}),
  async fetch(ctx) {
    const now = ctx.now().getTime()
    let extremes = resourceExtremes(await ctx.listResources('tides'))
    if (!extremes.length) extremes = pathExtremes(ctx)
    if (!extremes.length) throw new Error('no tide data; is signalk-tides running?')

    const station = ctx.getSelf(`${TIDE}.stationName`)
    const state = ctx.getSelf(`${TIDE}.state`)
    const nowText = shown(ctx, `${TIDE}.heightNow`)
    const toPoint = (e: Extreme): TidePoint => ({
      time: new Date(e.at).toISOString(),
      level: e.level,
      high: e.high,
      timeText: ctx.time(new Date(e.at)),
      levelText: shownAs(ctx, `${TIDE}.height${e.high ? 'High' : 'Low'}`, e.level) ?? `${e.level.toFixed(1)} m`
    })
    // One extreme before now so the curve starts on a turning point, then the next day.
    const before = extremes.filter((e) => e.at <= now).slice(-1)
    const after = extremes.filter((e) => e.at > now && e.at <= now + 30 * HOUR)
    const points = [...before, ...after].map(toPoint)

    const next = points.filter((p) => Date.parse(p.time) > now).slice(0, 2)
    const at = typeof station === 'string' && station ? ` at ${station}` : ''
    const head = joinParts([typeof state === 'string' ? state : undefined, nowText && `now ${nowText}`])
    const list = next.map((p, i) => {
      const kind = p.high ? 'high' : 'low'
      return `${i === 0 ? kind.charAt(0).toUpperCase() + kind.slice(1) : kind} water ${p.timeText} (${p.levelText})`
    })
    const nowLevel = ctx.getSelf(`${TIDE}.heightNow`)
    const data: TideData = {
      now: new Date(now).toISOString(),
      nowLevel: isNum(nowLevel) ? nowLevel : undefined,
      station: typeof station === 'string' ? station : undefined,
      state: typeof state === 'string' ? state : undefined,
      nowText,
      points
    }
    return {
      title: 'Tides',
      text: `Tide${at}${head ? `: ${head}` : ''}. ${list.join(', ')}.`,
      summary: `Tide${at}${head ? `: ${head.replace(/, /g, ' · ')}` : ''}`,
      items: next.map((p) => `${p.high ? 'High' : 'Low'} ${p.timeText} · ${p.levelText}`),
      data
    }
  }
}
