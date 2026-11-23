import type { ServerAPI } from '@signalk/server-api'
import { formatDate, formatTime, offsetMinutes } from './time.js'
import type { Ctx, HistoryApiLike, StateStore, WeatherApiLike } from './types.js'
import { fallbackDisplay, toDisplayValue } from './units.js'

export const TIMEZONE_PATH = 'environment.time.timezoneOffset'

const LEAF_KEYS = new Set(['value', 'values', 'meta', '$source', 'timestamp', 'pgn', 'sentence'])

interface Leaf {
  value?: unknown
  values?: Record<string, { value?: unknown }>
}

/** Optional server API members that only newer servers have. */
interface NewerServer {
  convertToDisplayUnits?: (path: string, value: number) => { value: number; symbol: string; displayFormat?: string } | undefined
  weatherApi?: WeatherApiLike
  getHistoryApi?: () => Promise<HistoryApiLike>
}

export interface ContextOptions {
  /** Prefer this source of the ship's timezone offset, e.g. the id of a timezone plugin. */
  timezoneSource?: string
}

/**
 * The ship's UTC offset in minutes. Several plugins may publish the offset;
 * a configured source wins over whichever one the server shows as current.
 */
export function shipOffset(leaf: unknown, preferredSource?: string): { minutes: number; source: string } | undefined {
  if (!leaf || typeof leaf !== 'object') return undefined
  const l = leaf as Leaf & { $source?: string }
  if (preferredSource && l.values) {
    for (const [ref, v] of Object.entries(l.values)) {
      if (ref === preferredSource || ref.startsWith(`${preferredSource}.`)) {
        const minutes = offsetMinutes(v?.value)
        if (minutes !== undefined) return { minutes, source: ref }
      }
    }
  }
  const minutes = offsetMinutes(l.value)
  return minutes === undefined ? undefined : { minutes, source: l.$source ?? 'unknown' }
}

export function createContext(app: ServerAPI, pluginId: string, state: StateStore, options: ContextOptions): Ctx {
  const newer = app as unknown as NewerServer
  const leafOf = (path: string): unknown => app.getSelfPath(path)

  const ctx: Ctx = {
    getSelf(path) {
      const leaf = leafOf(path)
      if (leaf && typeof leaf === 'object' && 'value' in (leaf as object)) return (leaf as Leaf).value
      return undefined
    },
    childKeys(path) {
      const node = leafOf(path)
      if (!node || typeof node !== 'object') return []
      return Object.keys(node).filter((k) => !LEAF_KEYS.has(k))
    },
    display(path, value) {
      if (!Number.isFinite(value)) return undefined
      try {
        const converted = newer.convertToDisplayUnits?.(path, value)
        if (converted) return toDisplayValue(converted.value, converted.symbol, converted.displayFormat)
      } catch {
        // fall through to the plugin's own conversion
      }
      return fallbackDisplay(app.getMetadata(path)?.units, value)
    },
    utcOffsetMinutes() {
      return shipOffset(leafOf(TIMEZONE_PATH), options.timezoneSource)?.minutes ?? 0
    },
    time: (iso) => formatTime(new Date(iso), ctx.utcOffsetMinutes()),
    date: (iso) => formatDate(new Date(iso), ctx.utcOffsetMinutes()),
    now: () => new Date(),
    weather: () => (typeof newer.weatherApi?.getForecasts === 'function' ? newer.weatherApi : undefined),
    async history() {
      if (typeof newer.getHistoryApi !== 'function') return undefined
      try {
        return await newer.getHistoryApi()
      } catch {
        return undefined
      }
    },
    publish(path, value) {
      app.handleMessage(pluginId, { updates: [{ values: [{ path: path as never, value: value as never }] }] })
    },
    onSelfValue(path, cb) {
      return app.streambundle.getSelfStream(path as never).onValue(cb)
    },
    state,
    log: { debug: (m) => app.debug(m), error: (m) => app.error(m) }
  }
  return ctx
}
