import { INTERNET_PATH, internetState, mayUseInternet } from '../src/engine/internet.js'
import type { Ctx, HistoryApiLike, WeatherApiLike } from '../src/engine/types.js'
import { fallbackDisplay } from '../src/engine/units.js'
import { formatDate, formatTime } from '../src/engine/time.js'

/** SI units of the paths the tests use, for the fallback display conversion. */
const UNITS: Record<string, string> = {
  stateOfCharge: 'ratio',
  currentLevel: 'ratio',
  fraction: 'ratio',
  voltage: 'V',
  current: 'A',
  timeRemaining: 's',
  currentVolume: 'm3',
  temperature: 'K',
  speedTrue: 'm/s',
  heightNow: 'm',
  heightHigh: 'm',
  heightLow: 'm',
  pressure: 'Pa'
}

export interface FakeCtx extends Ctx {
  values: Map<string, unknown>
  published: Array<{ path: string; value: unknown }>
  listeners: Map<string, Array<(v: unknown) => void>>
  stateData: Map<string, unknown>
  clock: { now: Date }
  emit(path: string, value: unknown): void
  errors: string[]
  cache: Map<string, { value: unknown; at: Date }>
  requests: Array<{ url: string; init?: RequestInit }>
}

export function fakeCtx(
  values: Record<string, unknown> = {},
  opts: {
    offsetMin?: number
    now?: string
    weather?: WeatherApiLike
    resources?: Record<string, Record<string, unknown>>
    http?: (url: string, init?: RequestInit) => Promise<Response>
    history?: HistoryApiLike
  } = {}
): FakeCtx {
  const map = new Map(Object.entries(values))
  const listeners = new Map<string, Array<(v: unknown) => void>>()
  const stateData = new Map<string, unknown>()
  const clock = { now: new Date(opts.now ?? '2026-11-23T00:00:00Z') }
  const offset = opts.offsetMin ?? 720
  const errors: string[] = []
  const cache = new Map<string, { value: unknown; at: Date }>()
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const ctx: FakeCtx = {
    cache,
    requests,
    values: map,
    published: [],
    listeners,
    stateData,
    clock,
    errors,
    getSelf: (p) => map.get(p),
    childKeys(path) {
      const keys = new Set<string>()
      for (const k of map.keys()) if (k.startsWith(`${path}.`)) keys.add(k.slice(path.length + 1).split('.')[0]!)
      return [...keys]
    },
    display: (path, v) => fallbackDisplay(UNITS[path.split('.').pop()!], v),
    time: (iso) => formatTime(new Date(iso), offset),
    date: (iso) => formatDate(new Date(iso), offset),
    utcOffsetMinutes: () => offset,
    now: () => clock.now,
    weather: () => opts.weather,
    history: async () => opts.history,
    listResources: async (type) => opts.resources?.[type],
    internet: () => internetState(map.get(INTERNET_PATH)),
    async http(url, init) {
      requests.push({ url, init })
      if (!opts.http) throw new Error('no network in tests')
      return opts.http(url, init)
    },
    async cached(key, load) {
      const recent = () => {
        const hit = cache.get(key)
        return hit && clock.now.getTime() - hit.at.getTime() <= 24 * 3_600_000 ? hit : undefined
      }
      if (!mayUseInternet(ctx.internet())) {
        const hit = recent()
        if (!hit) throw new Error('offline and no recent data')
        return { value: hit.value as never, at: hit.at, fromCache: true }
      }
      try {
        const value = await load()
        cache.set(key, { value, at: clock.now })
        return { value, at: clock.now, fromCache: false }
      } catch (error) {
        const hit = recent()
        if (!hit) throw error
        return { value: hit.value as never, at: hit.at, fromCache: true }
      }
    },
    publish(path, value) {
      ctx.published.push({ path, value })
    },
    onSelfValue(path, cb) {
      listeners.set(path, [...(listeners.get(path) ?? []), cb])
      return () => listeners.set(path, (listeners.get(path) ?? []).filter((x) => x !== cb))
    },
    emit(path, value) {
      map.set(path, value)
      for (const cb of listeners.get(path) ?? []) cb(value)
    },
    state: { get: (k) => stateData.get(k), set: (k, v) => void stateData.set(k, v) },
    log: { debug: () => {}, error: (m) => void errors.push(m) }
  }
  return ctx
}
