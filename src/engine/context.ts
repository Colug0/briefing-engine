import type { ServerAPI } from '@signalk/server-api'
import type { Cache } from './cache.js'
import { INTERNET_PATH, internetState, mayUseInternet } from './internet.js'
import { formatDate, formatTime, offsetMinutes } from './time.js'
import type { Ctx, HistoryApiLike, SelfReader, StateStore, WeatherApiLike } from './types.js'
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
  resourcesApi?: { listResources(type: string, params: Record<string, unknown>): Promise<Record<string, unknown>> }
}

export interface ContextOptions {
  /** Prefer this source of the ship's timezone offset, e.g. the id of a timezone plugin. */
  timezoneSource?: string
  cache?: Cache
  /** How old remembered internet data may be when shown offline. */
  cacheMaxAgeMs?: number
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

/** The vessel's own values and the keys below a path, straight from the server. */
export function selfReader(app: Pick<ServerAPI, 'getSelfPath'>): SelfReader {
  const leafOf = (path: string): unknown => app.getSelfPath(path)
  return {
    getSelf(path) {
      const leaf = leafOf(path)
      if (leaf && typeof leaf === 'object' && 'value' in (leaf as object)) return (leaf as Leaf).value
      return undefined
    },
    childKeys(path) {
      const node = leafOf(path)
      if (!node || typeof node !== 'object') return []
      return Object.keys(node).filter((k) => !LEAF_KEYS.has(k))
    }
  }
}

export function createContext(app: ServerAPI, pluginId: string, state: StateStore, options: ContextOptions): Ctx {
  const newer = app as unknown as NewerServer
  const reader = selfReader(app)

  const ctx: Ctx = {
    getSelf: reader.getSelf,
    childKeys: reader.childKeys,
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
      return shipOffset(app.getSelfPath(TIMEZONE_PATH), options.timezoneSource)?.minutes ?? 0
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
    async listResources(type, params = {}) {
      if (typeof newer.resourcesApi?.listResources !== 'function') return undefined
      try {
        return await newer.resourcesApi.listResources(type, params)
      } catch {
        return undefined
      }
    },
    internet: () => internetState(ctx.getSelf(INTERNET_PATH)),
    http(url, init = {}) {
      const { timeoutMs = 15_000, ...rest } = init
      const timeout = AbortSignal.timeout(timeoutMs)
      return fetch(url, { ...rest, signal: rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout })
    },
    async cached(key, load) {
      const maxAge = options.cacheMaxAgeMs ?? 24 * 3_600_000
      const remembered = () => {
        const hit = options.cache?.get(key)
        return hit && ctx.now().getTime() - hit.at.getTime() <= maxAge ? hit : undefined
      }
      if (!mayUseInternet(ctx.internet())) {
        const hit = remembered()
        if (!hit) throw new Error('offline and no recent data')
        return { value: hit.value as never, at: hit.at, fromCache: true }
      }
      try {
        const value = await load()
        const at = ctx.now()
        options.cache?.set(key, value, at)
        return { value, at, fromCache: false }
      } catch (error) {
        const hit = remembered()
        if (!hit) throw error
        return { value: hit.value as never, at: hit.at, fromCache: true }
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
