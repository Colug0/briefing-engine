import Type, { type Static } from 'typebox'
import { firstOf, historyValues, lastOf, minOf } from '../engine/history.js'
import { localParts, parseClock } from '../engine/time.js'
import type { ContentType, Ctx } from '../engine/types.js'
import type { OvernightData } from './data.js'
import { label, shownAs } from './helpers.js'

const Schema = Type.Object({
  battery: Type.String({ title: 'Battery', description: 'Id below electrical.batteries, e.g. house', default: 'house' }),
  window: Type.Enum(['since', 'last'], {
    title: 'Period',
    description: 'since: from a ship time yesterday (or today, if already past) until now. last: the last hours.',
    default: 'since'
  }),
  since: Type.String({ title: 'Since (ship time, HH:MM)', default: '20:00', pattern: '^\\d{1,2}:\\d{2}$' }),
  hours: Type.Number({ title: 'Last hours', default: 10, minimum: 1, maximum: 48 })
})
type Config = Static<typeof Schema>

/** Buckets in the window: enough for a curve, few enough for a small query. */
const BUCKETS = 48

/** Start of the window: the last time the clock showed `since`, at least an hour ago. */
export function windowStart(config: Config, now: Date, offsetMin: number): Date {
  if (config.window === 'last') return new Date(now.getTime() - config.hours * 3_600_000)
  const at = parseClock(config.since) ?? 20 * 60
  const local = localParts(now, offsetMin)
  const todayAt = Date.UTC(local.year, local.month, local.day) + (at - offsetMin) * 60_000
  return todayAt <= now.getTime() - 3_600_000 ? new Date(todayAt) : new Date(todayAt - 86_400_000)
}

/** Amp hours from average currents per bucket: what went out and what came in. */
export function ampHours(current: Array<number | null>, bucketS: number): { used: number; charged: number } {
  let used = 0
  let charged = 0
  for (const a of current) {
    if (a === null) continue
    const ah = (a * bucketS) / 3600
    if (ah < 0) used -= ah
    else charged += ah
  }
  return { used, charged }
}

const AH = (ah: number) => `${Math.round(ah)} Ah`

export const overnightContent: ContentType<Config> = {
  id: 'overnight',
  title: 'Battery overnight',
  description: 'State of charge, amp hours used and lowest voltage of a battery over the night, from the History API.',
  schema: Schema,
  async fetch(ctx: Ctx, config) {
    const id = config.battery.trim().replace(/^(vessels\.self\.)?electrical\.batteries\./, '')
    const base = `electrical.batteries.${id}`
    const to = ctx.now()
    const from = windowStart(config, to, ctx.utcOffsetMinutes())
    const bucketS = Math.max(60, Math.round((to.getTime() - from.getTime()) / 1000 / BUCKETS))
    const s = await historyValues(
      ctx,
      [
        { path: `${base}.capacity.stateOfCharge`, aggregate: 'average' },
        { path: `${base}.current`, aggregate: 'average' },
        { path: `${base}.voltage`, aggregate: 'min' }
      ],
      from,
      to,
      bucketS
    )
    const [soc = [], current = [], voltage = []] = s.columns
    const named = ctx.getSelf(`${base}.name`)
    const name = typeof named === 'string' && named.trim() ? named.trim() : label(id)
    const start = firstOf(soc)
    const end = lastOf(soc)
    const anyCurrent = current.some((x) => x !== null)
    const { used, charged } = ampHours(current, bucketS)
    const minV = minOf(voltage)
    if (start === undefined && !anyCurrent && minV === undefined) throw new Error(`no history for ${base}`)
    const data: OvernightData = {
      name,
      fromText: ctx.time(from),
      toText: ctx.time(to),
      startSocText: shownAs(ctx, `${base}.capacity.stateOfCharge`, start),
      endSocText: shownAs(ctx, `${base}.capacity.stateOfCharge`, end),
      usedAhText: anyCurrent ? AH(used) : undefined,
      chargedAhText: anyCurrent && charged >= 0.5 ? AH(charged) : undefined,
      minVoltageText: shownAs(ctx, `${base}.voltage`, minV),
      soc
    }
    const parts = [
      data.startSocText && data.endSocText ? `${data.startSocText} → ${data.endSocText}` : undefined,
      data.usedAhText && `used ${data.usedAhText}`,
      data.chargedAhText && `charged ${data.chargedAhText}`,
      data.minVoltageText && `lowest ${data.minVoltageText}`
    ].filter(Boolean)
    return {
      title: 'Battery overnight',
      text: `${name} since ${data.fromText}: ${parts.join(', ')}.`,
      data
    }
  }
}
