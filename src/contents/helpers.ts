import type { Ctx } from '../engine/types.js'

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** "12.6 V", or undefined when the path has no numeric value. */
export function shown(ctx: Ctx, path: string): string | undefined {
  const v = ctx.getSelf(path)
  return isNum(v) ? ctx.display(path, v)?.text : undefined
}

/**
 * Readable name for a path key: "freshWater" → "Fresh water", "house" →
 * "House". Ids that are not plain words ("LiFePo4-L-F7", "2997309160") stay
 * as they are, since splitting them only garbles them.
 */
export function label(key: string): string {
  if (!/^[a-z]+(?:[A-Z][a-z]+)*$/.test(key)) return key
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Milliseconds of a timestamp held in a path. Over REST timestamps are
 * strings, but a plugin can put a Date into the tree directly
 * (signalk-derived-data does for sun and moon times).
 */
export function epochAt(ctx: Ctx, path: string): number | undefined {
  const v = ctx.getSelf(path)
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number.NaN
  return Number.isNaN(ms) ? undefined : ms
}

/** Ship time of a timestamp held in a path, or undefined. */
export function timeAt(ctx: Ctx, path: string): string | undefined {
  const ms = epochAt(ctx, path)
  return ms === undefined ? undefined : ctx.time(new Date(ms))
}

export function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(', ')
}

/** The value converted with another path's display unit, for data that is not in the tree (forecasts). */
export function shownAs(ctx: Ctx, unitPath: string, value: unknown): string | undefined {
  return isNum(value) ? ctx.display(unitPath, value)?.text : undefined
}
