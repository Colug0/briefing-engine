import Type from 'typebox'
import type { ContentType } from '../engine/types.js'
import { timeAt } from './helpers.js'

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
    const dawn = timeAt(ctx, `${SUN}.dawn`)
    const dusk = timeAt(ctx, `${SUN}.dusk`)
    if (config.twilight && (dawn || dusk)) text += ` (dawn ${dawn ?? 'unknown'}, dusk ${dusk ?? 'unknown'})`
    return { title: 'Sun', text: `${text}.`, data: { sunrise: rise, sunset: set, dawn, dusk } }
  }
}
