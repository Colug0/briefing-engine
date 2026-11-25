import Type, { type Static } from 'typebox'
import type { Choice, ContentType, Ctx, SelfReader } from '../engine/types.js'
import type { BatteryData, BatteryItem } from './data.js'
import { isNum, joinParts, label, shown } from './helpers.js'

const BatterySchema = Type.Object({
  batteries: Type.Array(Type.String(), {
    title: 'Batteries',
    description: 'Ids below electrical.batteries, e.g. house. Empty = all.',
    default: []
  }),
  lowPercent: Type.Integer({ title: 'Low below (%)', description: 'Shown in red below this state of charge.', default: 30, minimum: 0, maximum: 100 }),
  highPercent: Type.Integer({ title: 'Good from (%)', description: 'Shown in green from this state of charge.', default: 70, minimum: 0, maximum: 100 })
})

function nameOf(ctx: SelfReader, base: string, id: string): string {
  const name = ctx.getSelf(`${base}.${id}.name`)
  return typeof name === 'string' && name.trim() ? name.trim() : label(id)
}

/** The batteries the server knows now, by name, for the editor. */
export function batteryChoices(self: SelfReader): Choice[] {
  return self.childKeys('electrical.batteries').map((id) => ({ value: id, label: nameOf(self, 'electrical.batteries', id) }))
}

const num = (v: unknown): number | undefined => (isNum(v) ? v : undefined)

export const batteryContent: ContentType<Static<typeof BatterySchema>> = {
  id: 'battery',
  emoji: '🔋',
  title: 'Batteries',
  description: 'State of charge, voltage, current and time remaining.',
  schema: BatterySchema,
  choices: (self) => ({ batteries: batteryChoices(self) }),
  async fetch(ctx, config) {
    // Accept ids written with their full path too (electrical.batteries.house).
    const ids = config.batteries.length
      ? config.batteries.map((id) => id.trim().replace(/^(vessels\.self\.)?electrical\.batteries\./, ''))
      : ctx.childKeys('electrical.batteries')
    const items: BatteryItem[] = ids.map((id) => {
      const b = `electrical.batteries.${id}`
      const left = shown(ctx, `${b}.capacity.timeRemaining`)
      return {
        id,
        name: nameOf(ctx, 'electrical.batteries', id),
        soc: num(ctx.getSelf(`${b}.capacity.stateOfCharge`)),
        socText: shown(ctx, `${b}.capacity.stateOfCharge`),
        voltageText: shown(ctx, `${b}.voltage`),
        current: num(ctx.getSelf(`${b}.current`)),
        currentText: shown(ctx, `${b}.current`),
        remainingText: left && `${left} left`
      }
    })
    if (!items.length) throw new Error('no batteries in Signal K')
    const lines = items.map(
      (i) => `${i.name}: ${joinParts([i.socText, i.voltageText, i.currentText, i.remainingText]) || 'no data'}`
    )
    const data: BatteryData = { items, low: config.lowPercent / 100, high: config.highPercent / 100 }
    const summaryItems = items.map((i) => {
      const parts = [i.socText, i.voltageText, i.currentText, i.remainingText].filter(Boolean)
      return [i.name, ...(parts.length ? parts : ['no data'])].join(' · ')
    })
    return { title: 'Batteries', text: `Batteries. ${lines.join('. ')}.`, summary: 'Batteries', items: summaryItems, data }
  }
}
