import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import { joinParts, timeAt } from './helpers.js'

export const moonContent: ContentType<Record<string, never>> = {
  id: 'moon',
  title: 'Moon',
  description: 'Moon phase, illumination, moonrise and moonset (from signalk-derived-data).',
  schema: Type.Object({}),
  async fetch(ctx) {
    const phase = ctx.getSelf('environment.moon.phaseName')
    // Always a ratio of the disc, whatever unit preferences say.
    const fraction = ctx.getSelf('environment.moon.fraction')
    const lit = typeof fraction === 'number' && Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : undefined
    if (typeof phase !== 'string' && !lit) throw new Error('no moon data; is signalk-derived-data running?')
    const rise = timeAt(ctx, 'environment.moon.times.rise')
    const set = timeAt(ctx, 'environment.moon.times.set')
    const always = ctx.getSelf('environment.moon.times.alwaysUp') === true
      ? 'up all day'
      : ctx.getSelf('environment.moon.times.alwaysDown') === true
        ? 'down all day'
        : undefined
    const parts = joinParts([
      typeof phase === 'string' ? phase.toLowerCase() : undefined,
      lit && `${lit} lit`,
      always ?? joinParts([rise && `rises ${rise}`, set && `sets ${set}`])
    ])
    return { title: 'Moon', text: `Moon: ${parts}.`, data: { phase, rise, set } }
  }
}
