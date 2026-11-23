import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import type { SunData } from './data.js'
import { epochAt, timeAt } from './helpers.js'

const SUN = 'environment.sunlight.times'

export const sunContent: ContentType<{ twilight: boolean }> = {
  id: 'sun',
  title: 'Sun',
  description: 'Sunrise and sunset at the vessel (from signalk-derived-data).',
  schema: Type.Object({ twilight: Type.Boolean({ title: 'Include dawn and dusk', default: true }) }),
  async fetch(ctx, config) {
    const rise = timeAt(ctx, `${SUN}.sunrise`)
    const set = timeAt(ctx, `${SUN}.sunset`)
    if (!rise && !set) throw new Error('no sun times; is signalk-derived-data running?')
    let text = `Sunrise ${rise ?? 'unknown'}, sunset ${set ?? 'unknown'}`
    const dawn = config.twilight ? timeAt(ctx, `${SUN}.dawn`) : undefined
    const dusk = config.twilight ? timeAt(ctx, `${SUN}.dusk`) : undefined
    if (dawn || dusk) text += ` (dawn ${dawn ?? 'unknown'}, dusk ${dusk ?? 'unknown'})`
    const iso = (name: string): string | undefined => {
      const ms = epochAt(ctx, `${SUN}.${name}`)
      return ms === undefined ? undefined : new Date(ms).toISOString()
    }
    const data: SunData = {
      now: ctx.now().toISOString(),
      sunrise: iso('sunrise'),
      sunset: iso('sunset'),
      dawn: dawn && iso('dawn'),
      dusk: dusk && iso('dusk'),
      sunriseText: rise,
      sunsetText: set,
      dawnText: dawn,
      duskText: dusk
    }
    return { title: 'Sun', text: `${text}.`, data }
  }
}
