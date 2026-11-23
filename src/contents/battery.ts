import Type, { type Static } from 'typebox'
import type { ContentType, Ctx } from '../engine/types.js'
import { joinParts, label, shown } from './helpers.js'

const BatterySchema = Type.Object({
  batteries: Type.Array(Type.String(), {
    title: 'Batteries',
    description: 'Ids below electrical.batteries, e.g. house. Empty = all.',
    default: []
  })
})

function nameOf(ctx: Ctx, base: string, id: string): string {
  const name = ctx.getSelf(`${base}.${id}.name`)
  return typeof name === 'string' && name.trim() ? name.trim() : label(id)
}

export const batteryContent: ContentType<Static<typeof BatterySchema>> = {
  id: 'battery',
  title: 'Batteries',
  description: 'State of charge, voltage, current and time remaining.',
  schema: BatterySchema,
  async fetch(ctx, config) {
    const ids = config.batteries.length ? config.batteries : ctx.childKeys('electrical.batteries')
    const lines: string[] = []
    const data: Record<string, unknown> = {}
    for (const id of ids) {
      const b = `electrical.batteries.${id}`
      const soc = shown(ctx, `${b}.capacity.stateOfCharge`)
      const left = shown(ctx, `${b}.capacity.timeRemaining`)
      const parts = joinParts([soc, shown(ctx, `${b}.voltage`), shown(ctx, `${b}.current`), left && `${left} left`])
      data[id] = {
        stateOfCharge: ctx.getSelf(`${b}.capacity.stateOfCharge`),
        voltage: ctx.getSelf(`${b}.voltage`),
        current: ctx.getSelf(`${b}.current`),
        timeRemaining: ctx.getSelf(`${b}.capacity.timeRemaining`)
      }
      lines.push(`${nameOf(ctx, 'electrical.batteries', id)}: ${parts || 'no data'}`)
    }
    if (!lines.length) throw new Error('no batteries in Signal K')
    return { title: 'Batteries', text: `Batteries. ${lines.join('. ')}.`, data }
  }
}
