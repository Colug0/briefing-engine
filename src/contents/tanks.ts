import Type, { type Static } from 'typebox'
import type { ContentType } from '../engine/types.js'
import { label, shown } from './helpers.js'

const TankSchema = Type.Object({
  tanks: Type.Array(Type.String(), {
    title: 'Tanks',
    description: 'Type and id below tanks, e.g. freshWater.0 or fuel.main. Empty = all.',
    default: []
  })
})

export const tankContent: ContentType<Static<typeof TankSchema>> = {
  id: 'tanks',
  title: 'Tanks',
  description: 'Level and volume of your tanks.',
  schema: TankSchema,
  async fetch(ctx, config) {
    const ids = config.tanks.length
      ? config.tanks
      : ctx.childKeys('tanks').flatMap((type) => ctx.childKeys(`tanks.${type}`).map((id) => `${type}.${id}`))
    const lines: string[] = []
    const data: Record<string, unknown> = {}
    for (const id of ids) {
      const t = `tanks.${id}`
      const [type = id, sub = ''] = id.split('.')
      const named = ctx.getSelf(`${t}.name`)
      const name = typeof named === 'string' && named.trim() ? named.trim() : `${label(type)}${sub && !/^0$/.test(sub) ? ` ${sub}` : ''}`
      const level = shown(ctx, `${t}.currentLevel`)
      const volume = shown(ctx, `${t}.currentVolume`)
      data[id] = { currentLevel: ctx.getSelf(`${t}.currentLevel`), currentVolume: ctx.getSelf(`${t}.currentVolume`) }
      lines.push(`${name}: ${level ? (volume ? `${level} (${volume})` : level) : volume ?? 'no data'}`)
    }
    if (!lines.length) throw new Error('no tanks in Signal K')
    return { title: 'Tanks', text: `Tanks. ${lines.join('. ')}.`, data }
  }
}
