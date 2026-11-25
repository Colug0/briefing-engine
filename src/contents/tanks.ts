import Type, { type Static } from 'typebox'
import { historyValues, totalUse } from '../engine/history.js'
import { localParts } from '../engine/time.js'
import type { ContentType, Ctx, SelfReader } from '../engine/types.js'
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

/** A rise of more than this share of the tank counts as filling it. */
const FILL_SHARE = 0.08

/** Yesterday's use is extra: the current readings must not wait for a slow history. */
const HISTORY_WAIT_MS = 8_000

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
    // A fill is a rise of more than 8 % of the tank. Senders step between fixed
    // readings several litres apart (one boat's: 105, 108, 110.8, 113.7 L), and a
    // smaller threshold takes those steps for fills.
    const capacity = ctx.getSelf(`tanks.${id}.capacity`)
    const volumes = s.columns[2 * i] ?? []
    const biggest = Math.max(0, ...volumes.filter((v): v is number => v !== null))
    const volume = totalUse(volumes, FILL_SHARE * (isNum(capacity) ? capacity : biggest))
    const level = totalUse(s.columns[2 * i + 1] ?? [], FILL_SHARE)
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

/** Every tank the server knows now, as type.id (fuel.0). */
const tankIds = (self: SelfReader): string[] =>
  self.childKeys('tanks').flatMap((type) => self.childKeys(`tanks.${type}`).map((id) => `${type}.${id}`))

function tankName(self: SelfReader, id: string): string {
  const [type = id, sub = ''] = id.split('.')
  const named = self.getSelf(`tanks.${id}.name`)
  return typeof named === 'string' && named.trim() ? named.trim() : `${label(type)}${sub && !/^0$/.test(sub) ? ` ${sub}` : ''}`
}

export const tankContent: ContentType<Static<typeof TankSchema>> = {
  id: 'tanks',
  emoji: '⛽',
  title: 'Tanks',
  description: 'Level and volume of your tanks, optionally with what was used yesterday.',
  schema: TankSchema,
  choices: (self) => ({ tanks: tankIds(self).map((id) => ({ value: id, label: tankName(self, id) })) }),
  async fetch(ctx, config) {
    // Accept ids written with their full path too (tanks.fuel.main).
    const ids = config.tanks.length
      ? config.tanks.map((id) => id.trim().replace(/^(vessels\.self\.)?tanks\./, ''))
      : tankIds(ctx)
    const items: TankItem[] = ids.map((id) => {
      const t = `tanks.${id}`
      const [type = id] = id.split('.')
      const name = tankName(ctx, id)
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
    let note: string | undefined
    if (config.yesterday) {
      let timer: NodeJS.Timeout | undefined
      try {
        const used = await Promise.race([
          usedYesterday(ctx, items.map((i) => i.id)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('the history did not answer in time')), HISTORY_WAIT_MS)
          })
        ])
        for (const i of items) i.usedYesterdayText = used[i.id]
      } catch (error) {
        note = `Yesterday's use not available (${error instanceof Error ? error.message : String(error)}).`
      } finally {
        clearTimeout(timer)
      }
    }
    const lines = items.map((i) => {
      const now = i.levelText ? (i.volumeText ? `${i.levelText} (${i.volumeText})` : i.levelText) : (i.volumeText ?? 'no data')
      return `${i.name}: ${now}${i.usedYesterdayText ? `, used yesterday ${i.usedYesterdayText}` : ''}`
    })
    const data: TankData = { items, note }
    const summaryItems = items.map((i) =>
      [i.name, i.levelText ? (i.volumeText ? `${i.levelText} (${i.volumeText})` : i.levelText) : i.volumeText, i.usedYesterdayText && `used yesterday ${i.usedYesterdayText}`]
        .filter(Boolean)
        .join(' · ')
    )
    if (note) summaryItems.push(note)
    return { title: 'Tanks', text: `Tanks. ${lines.join('. ')}.${note ? ` ${note}` : ''}`, summary: 'Tanks', items: summaryItems, data }
  }
}
