import type { Ctx } from './types.js'

export type Aggregate = 'average' | 'min' | 'max' | 'first' | 'last'

export interface Series {
  /** Bucket start times. */
  times: Date[]
  /** One column per requested path, null for empty buckets. */
  columns: Array<Array<number | null>>
}

/**
 * The History API (v2) takes Temporal instants. Providers turn a range with
 * both ends into text with `toString()` (signalk-questdb does exactly that),
 * so a plain object that prints as ISO time is enough and spares the plugin a
 * Temporal polyfill.
 */
function instant(date: Date) {
  const iso = date.toISOString()
  return { toString: () => iso, toJSON: () => iso, epochMilliseconds: date.getTime() }
}

/** Values of several paths between two times, in buckets of `resolutionS` seconds. */
export async function historyValues(
  ctx: Ctx,
  paths: Array<{ path: string; aggregate: Aggregate }>,
  from: Date,
  to: Date,
  resolutionS: number
): Promise<Series> {
  const api = await ctx.history()
  if (!api) throw new Error('no history provider (e.g. signalk-questdb)')
  const res = await api.getValues({
    context: 'vessels.self',
    from: instant(from),
    to: instant(to),
    resolution: resolutionS,
    pathSpecs: paths.map((p) => ({ path: p.path, aggregate: p.aggregate, parameter: [] }))
  })
  const rows = Array.isArray(res?.data) ? res.data : []
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    times: rows.map((r) => new Date(String(r[0]))),
    columns: paths.map((_, i) => rows.map((r) => num(r[i + 1])))
  }
}

export const firstOf = (xs: Array<number | null>): number | undefined => xs.find((x): x is number => x !== null) ?? undefined
export const lastOf = (xs: Array<number | null>): number | undefined => [...xs].reverse().find((x): x is number => x !== null) ?? undefined
export const minOf = (xs: Array<number | null>): number | undefined => {
  const ns = xs.filter((x): x is number => x !== null)
  return ns.length ? Math.min(...ns) : undefined
}

/**
 * Running median over five readings. Tank senders throw single readings far
 * off (one boat's fuel sender read 150 L for one quarter hour in a day at
 * 114 L); the median drops those and keeps real changes that last.
 */
export function medianSmooth(ns: number[], width = 5): number[] {
  if (ns.length < width) return ns
  const half = Math.floor(width / 2)
  return ns.map((_, i) => {
    // The window shrinks symmetrically towards the ends, so the first and last
    // readings stay what they were: they are the balance of the period.
    const r = Math.min(half, i, ns.length - 1 - i)
    const win = ns.slice(i - r, i + r + 1).sort((a, b) => a - b)
    return win[r]!
  })
}

/**
 * What a tank used: start minus end plus what was filled in. A rise of more
 * than `refill` starts a fill, which then runs on to the peak of that rise; smaller ups and downs are the sender
 * wobbling, and summing every drop would count that wobble as use.
 */
export function totalUse(xs: Array<number | null>, refill: number): number | undefined {
  const ns = medianSmooth(xs.filter((x): x is number => x !== null))
  if (ns.length < 2) return undefined
  let filled = 0
  // Compare against the lowest value since the last fill, so a fill spread over buckets counts once.
  let low = ns[0]!
  // Once a rise is a fill, follow it to its peak while the readings keep rising;
  // the first reading that does not rise ends it, so later wobble is no fill.
  let filling = false
  for (let i = 1; i < ns.length; i++) {
    const v = ns[i]!
    const prev = ns[i - 1]!
    if (filling && v > prev) {
      filled += v - prev
      low = v
      continue
    }
    filling = false
    if (v - low > refill) {
      filled += v - low
      low = v
      filling = true
    } else low = Math.min(low, v)
  }
  return Math.max(0, ns[0]! - ns[ns.length - 1]! + filled)
}
