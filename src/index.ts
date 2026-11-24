import { join } from 'node:path'
import type { Plugin, ServerAPI } from '@signalk/server-api'
import Type, { type Static } from 'typebox'
import { registerApi, type RouterLike } from './api.js'
import { createContext, shipOffset, TIMEZONE_PATH } from './engine/context.js'
import { Cache } from './engine/cache.js'
import { Engine } from './engine/engine.js'
import { Store } from './engine/store.js'
import { createRegistry } from './types.js'

export const PLUGIN_ID = 'briefing-engine'

const ConfigSchema = Type.Object({
  timezoneSource: Type.Optional(
    Type.String({
      title: 'Timezone source',
      description:
        "Ship time comes from environment.time.timezoneOffset. When several plugins publish it, name the one to use (its $source). Empty: the server's current value."
    })
  ),
  contentTimeoutSeconds: Type.Number({
    title: 'Content timeout (s)',
    description: 'A content block that takes longer is reported as not available.',
    default: 20,
    minimum: 1,
    maximum: 300
  }),
  historySize: Type.Integer({ title: 'Briefings kept in the history', default: 100, minimum: 1, maximum: 1000 }),
  cacheMaxAgeHours: Type.Number({
    title: 'Offline data shown for (h)',
    description: 'Without internet, blocks show their last internet data with its age until it is this old.',
    default: 24,
    minimum: 1,
    maximum: 168
  })
})
type Config = Static<typeof ConfigSchema>

export default function (app: ServerAPI): Plugin {
  const registry = createRegistry()
  let running: { store: Store; engine: Engine } | undefined
  let config: Config | undefined
  let generation = 0

  const status = () => {
    const tz = shipOffset(app.getSelfPath(TIMEZONE_PATH), config?.timezoneSource)
    const briefings = running?.store.listBriefings() ?? []
    return {
      running: Boolean(running),
      briefings: briefings.length,
      enabled: briefings.filter((b) => b.enabled).length,
      timezone: tz ? { offsetMinutes: tz.minutes, source: tz.source } : undefined,
      internet: (app.getSelfPath('network.internet.state') as { value?: unknown } | undefined)?.value ?? null,
      weatherApi: typeof (app as unknown as { weatherApi?: { getForecasts?: unknown } }).weatherApi?.getForecasts === 'function',
      historyApi: typeof (app as unknown as { getHistoryApi?: unknown }).getHistoryApi === 'function'
    }
  }

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: 'Briefing Engine',
    description: 'Build briefings from Signal K data and deliver them on a schedule or on demand.',
    schema: () => ConfigSchema,

    start(raw) {
      config = { contentTimeoutSeconds: 20, historySize: 100, cacheMaxAgeHours: 24, ...(raw as Partial<Config>) }
      const mine = ++generation
      const store = new Store(join(app.getDataDirPath(), 'briefings'), config.historySize, (m) => app.error(m))
      const cache = new Cache(join(app.getDataDirPath(), 'cache'), (m) => app.error(m))
      const ctx = createContext(app, PLUGIN_ID, store, {
        timezoneSource: config.timezoneSource?.trim() || undefined,
        cache,
        cacheMaxAgeMs: config.cacheMaxAgeHours * 3_600_000
      })
      const engine = new Engine(ctx, registry, store, { contentTimeoutMs: config.contentTimeoutSeconds * 1000 })
      // Without its cache the plugin still works; it only cannot show internet data offline.
      const cacheReady = cache.load().catch((error: unknown) => app.error(`Could not prepare the cache: ${String(error)}`))
      Promise.all([store.load(), cacheReady])
        .then(() => {
          // A restart while loading leaves this start behind.
          if (mine !== generation) return
          running = { store, engine }
          engine.startServices()
          engine.sync()
          const s = status()
          const enabled = `${s.enabled} of ${s.briefings} briefings enabled`
          app.setPluginStatus(s.timezone ? enabled : `${enabled}; no ship timezone, using UTC`)
        })
        .catch((error: unknown) => app.setPluginError(`Could not load briefings: ${String(error)}`))
    },

    async stop() {
      generation++
      const r = running
      running = undefined
      r?.engine.stop()
      await r?.store.flush()
    },

    registerWithRouter(router) {
      registerApi(router as unknown as RouterLike, { running: () => running, registry, status })
    }
  }
  return plugin
}
