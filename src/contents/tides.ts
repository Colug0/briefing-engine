import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import { joinParts, shown, timeAt } from './helpers.js'

const TIDE = 'environment.tide'

export const tideContent: ContentType<Record<string, never>> = {
  id: 'tides',
  title: 'Tides',
  description: 'Tide now and the next high and low water (from signalk-tides).',
  schema: Type.Object({}),
  async fetch(ctx) {
    const high = timeAt(ctx, `${TIDE}.timeHigh`)
    const low = timeAt(ctx, `${TIDE}.timeLow`)
    if (!high && !low) throw new Error('no tide data; is signalk-tides running?')
    const station = ctx.getSelf(`${TIDE}.stationName`)
    const state = ctx.getSelf(`${TIDE}.state`)
    const now = shown(ctx, `${TIDE}.heightNow`)
    const at = typeof station === 'string' && station ? ` at ${station}` : ''
    const head = joinParts([typeof state === 'string' ? state : undefined, now && `now ${now}`])
    const extremes = [
      { kind: 'High', time: high, iso: ctx.getSelf(`${TIDE}.timeHigh`), height: shown(ctx, `${TIDE}.heightHigh`) },
      { kind: 'low', time: low, iso: ctx.getSelf(`${TIDE}.timeLow`), height: shown(ctx, `${TIDE}.heightLow`) }
    ]
      .filter((e) => e.time)
      .sort((a, b) => Date.parse(String(a.iso)) - Date.parse(String(b.iso)))
      .map((e, i) => `${i === 0 ? e.kind.charAt(0).toUpperCase() + e.kind.slice(1).toLowerCase() : e.kind.toLowerCase()} water ${e.time}${e.height ? ` (${e.height})` : ''}`)
    return {
      title: 'Tides',
      text: `Tide${at}${head ? `: ${head}` : ''}. ${extremes.join(', ')}.`,
      data: { station, state, high, low }
    }
  }
}
