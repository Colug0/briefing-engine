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
 * What a tank used: start minus end plus what was filled in. Only a rise of
 * more than `refill` counts as filling; smaller ups and downs are the sender
 * wobbling, and summing every drop would count that wobble as use.
 */
export function totalUse(xs: Array<number | null>, refill: number): number | undefined {
  const ns = xs.filter((x): x is number => x !== null)
  if (ns.length < 2) return undefined
  let filled = 0
  // Compare against the lowest value since the last fill, so a fill spread over buckets counts once.
  let low = ns[0]!
  for (let i = 1; i < ns.length; i++) {
    const v = ns[i]!
    if (v - low > refill) {
      filled += v - low
      low = v
    } else low = Math.min(low, v)
  }
  return Math.max(0, ns[0]! - ns[ns.length - 1]! + filled)
}
