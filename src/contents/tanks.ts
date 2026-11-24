import Type, { type Static } from 'typebox'
import { historyValues, totalUse } from '../engine/history.js'
import { localParts } from '../engine/time.js'
import type { ContentType, Ctx } from '../engine/types.js'
import type { TankData, TankItem, TankKind } from './data.js'
import { isNum, label, shown, shownAs } from './helpers.js'

const TankSchema = Type.Object({
  tanks: Type.Array(Type.String(), {
    title: 'Tanks',
    description: 'Type and id below tanks, e.g. freshWater.0 or fuel.main. Empty = all.',
    default: []
  }),
  yesterday: Type.Boolean({
    title: 'Show what was used yesterday',
    description: 'From the History API: what each tank used over the whole previous day (ship time); fills are recognised and not counted as use.',
    default: false
  })
})

/** The previous ship-local day, midnight to midnight. */
export function yesterday(now: Date, offsetMin: number): { from: Date; to: Date } {
  const l = localParts(now, offsetMin)
  const midnight = Date.UTC(l.year, l.month, l.day) - offsetMin * 60_000
  return { from: new Date(midnight - 86_400_000), to: new Date(midnight) }
}

/** What each tank went down by yesterday, as text in display units; ids without history are missing. */
async function usedYesterday(ctx: Ctx, ids: string[]): Promise<Record<string, string>> {
  const { from, to } = yesterday(ctx.now(), ctx.utcOffsetMinutes())
  const paths = ids.flatMap((id) => [
    { path: `tanks.${id}.currentVolume`, aggregate: 'last' as const },
    { path: `tanks.${id}.currentLevel`, aggregate: 'last' as const }
  ])
  // Quarter-hour buckets: fine enough to tell use from a refill.
  const s = await historyValues(ctx, paths, from, to, 900)
  const out: Record<string, string> = {}
  ids.forEach((id, i) => {
    // A fill is a rise of more than 3 % of the tank.
    const capacity = ctx.getSelf(`tanks.${id}.capacity`)
    const volumes = s.columns[2 * i] ?? []
    const biggest = Math.max(0, ...volumes.filter((v): v is number => v !== null))
    const volume = totalUse(volumes, 0.03 * (isNum(capacity) ? capacity : biggest))
    const level = totalUse(s.columns[2 * i + 1] ?? [], 0.03)
    const text = volume !== undefined ? shownAs(ctx, `tanks.${id}.currentVolume`, volume) : shownAs(ctx, `tanks.${id}.currentLevel`, level)
    if (text) out[id] = text
  })
  return out
}

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
  description: 'Level and volume of your tanks, optionally with what was used yesterday.',
  schema: TankSchema,
  async fetch(ctx, config) {
    // Accept ids written with their full path too (tanks.fuel.main).
    const ids = config.tanks.length
      ? config.tanks.map((id) => id.trim().replace(/^(vessels\.self\.)?tanks\./, ''))
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
    let note = ''
    if (config.yesterday) {
      try {
        const used = await usedYesterday(ctx, items.map((i) => i.id))
        for (const i of items) i.usedYesterdayText = used[i.id]
      } catch (error) {
        note = ` Yesterday's use not available (${error instanceof Error ? error.message : String(error)}).`
      }
    }
    const lines = items.map((i) => {
      const now = i.levelText ? (i.volumeText ? `${i.levelText} (${i.volumeText})` : i.levelText) : (i.volumeText ?? 'no data')
      return `${i.name}: ${now}${i.usedYesterdayText ? `, used yesterday ${i.usedYesterdayText}` : ''}`
    })
    const data: TankData = { items }
    return { title: 'Tanks', text: `Tanks. ${lines.join('. ')}.${note}`, data }
  }
}
