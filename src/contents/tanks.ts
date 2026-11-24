import Type, { type Static } from 'typebox'
import type { ContentType } from '../engine/types.js'
import type { TankData, TankItem, TankKind } from './data.js'
import { isNum, label, shown } from './helpers.js'

const TankSchema = Type.Object({
  tanks: Type.Array(Type.String(), {
    title: 'Tanks',
    description: 'Type and id below tanks, e.g. freshWater.0 or fuel.main. Empty = all.',
    default: []
  })
})

/** What a tank holds, by its Signal K type, so screens can tell fuel from water at a glance. */
export function tankKind(type: string): TankKind {
  if (/fuel|diesel|petrol|gasoline|gas|lng|lpg/i.test(type)) return 'fuel'
  if (/^(waste|black|grey|gray)/i.test(type)) return 'waste'
  if (/water/i.test(type)) return 'water'
  return 'other'
}

export const tankContent: ContentType<Static<typeof TankSchema>> = {
  id: 'tanks',
  title: 'Tanks',
  description: 'Level and volume of your tanks.',
  schema: TankSchema,
  async fetch(ctx, config) {
    const ids = config.tanks.length
      ? config.tanks
      : ctx.childKeys('tanks').flatMap((type) => ctx.childKeys(`tanks.${type}`).map((id) => `${type}.${id}`))
    const items: TankItem[] = ids.map((id) => {
      const t = `tanks.${id}`
      const [type = id, sub = ''] = id.split('.')
      const named = ctx.getSelf(`${t}.name`)
      const name = typeof named === 'string' && named.trim() ? named.trim() : `${label(type)}${sub && !/^0$/.test(sub) ? ` ${sub}` : ''}`
      const level = ctx.getSelf(`${t}.currentLevel`)
      return {
        id,
        name,
        kind: tankKind(type),
        level: isNum(level) ? level : undefined,
        levelText: shown(ctx, `${t}.currentLevel`),
        volumeText: shown(ctx, `${t}.currentVolume`)
      }
    })
    if (!items.length) throw new Error('no tanks in Signal K')
    const lines = items.map(
      (i) => `${i.name}: ${i.levelText ? (i.volumeText ? `${i.levelText} (${i.volumeText})` : i.levelText) : (i.volumeText ?? 'no data')}`
    )
    const data: TankData = { items }
    return { title: 'Tanks', text: `Tanks. ${lines.join('. ')}.`, data }
  }
}
