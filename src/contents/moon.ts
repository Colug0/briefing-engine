import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import type { MoonData } from './data.js'
import { isNum, joinParts, timeAt } from './helpers.js'

export const moonContent: ContentType<Record<string, never>> = {
  id: 'moon',
  title: 'Moon',
  description: 'Moon phase, illumination, moonrise and moonset (from signalk-derived-data).',
  schema: Type.Object({}),
  async fetch(ctx) {
    const name = ctx.getSelf('environment.moon.phaseName')
    // Always a ratio of the disc, whatever unit preferences say.
    const fraction = ctx.getSelf('environment.moon.fraction')
    const lit = isNum(fraction) ? `${Math.round(fraction * 100)}%` : undefined
    if (typeof name !== 'string' && !lit) throw new Error('no moon data; is signalk-derived-data running?')
    const rise = timeAt(ctx, 'environment.moon.times.rise')
    const set = timeAt(ctx, 'environment.moon.times.set')
    const always = ctx.getSelf('environment.moon.times.alwaysUp') === true
      ? 'up'
      : ctx.getSelf('environment.moon.times.alwaysDown') === true
        ? 'down'
        : undefined
    const parts = joinParts([
      typeof name === 'string' ? name.toLowerCase() : undefined,
      lit && `${lit} lit`,
      always ? `${always} all day` : joinParts([rise && `rises ${rise}`, set && `sets ${set}`])
    ])
    const phase = ctx.getSelf('environment.moon.phase')
    const position = ctx.getSelf('navigation.position') as { latitude?: unknown } | undefined
    const data: MoonData = {
      phaseName: typeof name === 'string' ? name : undefined,
      phase: isNum(phase) ? phase : undefined,
      fraction: isNum(fraction) ? fraction : undefined,
      riseText: rise,
      setText: set,
      always,
      southern: isNum(position?.latitude) && position.latitude < 0
    }
    return { title: 'Moon', text: `Moon: ${parts}.`, data }
  }
}
