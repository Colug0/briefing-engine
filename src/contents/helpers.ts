import type { Ctx } from '../engine/types.js'

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** "12.6 V", or undefined when the path has no numeric value. */
export function shown(ctx: Ctx, path: string): string | undefined {
  const v = ctx.getSelf(path)
  return isNum(v) ? ctx.display(path, v)?.text : undefined
}

/** Readable name for a path key: "freshWater" → "Fresh water", "house" → "House". */
export function label(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Ship time of an ISO timestamp held in a path, or undefined. */
export function timeAt(ctx: Ctx, path: string): string | undefined {
  const v = ctx.getSelf(path)
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return undefined
  return ctx.time(v)
}

export function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(', ')
}

/** The value converted with another path's display unit, for data that is not in the tree (forecasts). */
export function shownAs(ctx: Ctx, unitPath: string, value: unknown): string | undefined {
  return isNum(value) ? ctx.display(unitPath, value)?.text : undefined
}
