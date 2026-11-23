import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerAPI } from '@signalk/server-api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import createPlugin from '../src/index.js'

type Handler = (req: { body?: unknown; params: Record<string, string>; query: Record<string, unknown> }, res: unknown) => void

/** Records routes per method and access level, and calls them like Express would. */
function fakeRouter() {
  const routes: Array<{ method: string; path: string; level: string; handler: Handler }> = []
  const registrar = (level: string) => ({
    get: (path: string, handler: Handler) => routes.push({ method: 'GET', path, level, handler }),
    post: (path: string, handler: Handler) => routes.push({ method: 'POST', path, level, handler }),
    put: (path: string, handler: Handler) => routes.push({ method: 'PUT', path, level, handler }),
    delete: (path: string, handler: Handler) => routes.push({ method: 'DELETE', path, level, handler })
  })
  const router = { ...registrar('admin'), access: (level: string) => registrar(level) }
  const call = (method: string, url: string, body?: unknown) =>
    new Promise<{ status: number; body: any }>((resolve) => {
      const [path, qs = ''] = url.split('?')
      for (const r of routes) {
        if (r.method !== method) continue
        const names: string[] = []
        const re = new RegExp(`^${r.path.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`)
        const m = re.exec(path!)
        if (!m) continue
        const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]!]))
        let status = 200
        const res = {
          status(code: number) {
            status = code
            return res
          },
          json(value: unknown) {
            resolve({ status, body: value })
          }
        }
        r.handler({ body, params, query: Object.fromEntries(new URLSearchParams(qs)) }, res)
        return
      }
      resolve({ status: 404, body: undefined })
    })
  return { router, routes, call }
}

function fakeApp(dir: string, tree: Record<string, unknown>) {
  const deltas: any[] = []
  const statuses: string[] = []
  const app = {
    getDataDirPath: () => dir,
    getSelfPath: (p: string) => (p in tree ? { value: tree[p] } : undefined),
    getMetadata: () => undefined,
    handleMessage: (_id: string, d: unknown) => deltas.push(d),
    setPluginStatus: (m: string) => statuses.push(m),
    setPluginError: (m: string) => statuses.push(`error: ${m}`),
    debug: () => {},
    error: (m: string) => statuses.push(`error: ${m}`),
    streambundle: { getSelfStream: () => ({ onValue: () => () => {} }) }
  }
  return { app: app as unknown as ServerAPI, deltas, statuses }
}

describe('plugin', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'briefing-plugin-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('manages briefings over its API and runs one on demand', async () => {
    const { app, deltas, statuses } = fakeApp(dir, {
      'environment.time.timezoneOffset': 1200,
      'environment.moon.phaseName': 'Full Moon'
    })
    const plugin = createPlugin(app)
    const { router, routes, call } = fakeRouter()
    plugin.registerWithRouter!(router as never)
    expect(routes.filter((r) => r.level !== 'admin').map((r) => `${r.level} ${r.method} ${r.path}`)).toEqual([
      'readonly GET /api/types',
      'readonly GET /api/status',
      'readonly GET /api/briefings',
      'readonly GET /api/briefings/:id',
      'readonly GET /api/runs',
      'readwrite POST /api/briefings/:id/run'
    ])

    expect((await call('GET', '/api/briefings')).status).toBe(503)
    plugin.start({}, () => {})
    await new Promise((r) => setTimeout(r, 20))
    expect(statuses.at(-1)).toBe('0 of 0 briefings enabled')

    const bad = await call('POST', '/api/briefings', { name: '' })
    expect(bad.status).toBe(400)

    const created = await call('POST', '/api/briefings', {
      name: 'Evening',
      triggers: [],
      contents: [{ type: 'moon' }, { type: 'sun' }],
      deliveries: [{ type: 'webapp' }, { type: 'notification' }]
    })
    expect(created.status).toBe(201)
    const id = created.body.id as string

    const run = await call('POST', `/api/briefings/${id}/run`)
    expect(run.status).toBe(200)
    expect(run.body.blocks.map((b: { text: string }) => b.text)).toEqual([
      'Moon: full moon.',
      'Sun: not available (no sun times; is signalk-derived-data running?).'
    ])
    expect(run.body.deliveries).toEqual([
      { type: 'webapp', ok: true },
      { type: 'notification', ok: true }
    ])
    expect(deltas.at(-1).updates[0].values[0]).toMatchObject({
      path: `notifications.briefing.${id.replace(/-/g, '')}`,
      value: { state: 'normal', message: 'Briefing "Evening" ready' }
    })

    const clone = await call('POST', `/api/briefings/${id}/clone`)
    expect(clone.body).toMatchObject({ name: 'Evening (copy)', enabled: false })
    expect((await call('GET', '/api/runs')).body).toHaveLength(1)
    expect((await call('GET', '/api/status')).body).toMatchObject({ briefings: 2, enabled: 1, timezone: { offsetMinutes: 720 } })
    expect((await call('DELETE', `/api/briefings/${id}`)).status).toBe(200)
    expect((await call('GET', `/api/briefings/${id}`)).status).toBe(404)

    await plugin.stop()
  })
})
