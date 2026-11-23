import type { Engine } from './engine/engine.js'
import type { Registry } from './engine/registry.js'
import type { Store } from './engine/store.js'

interface Req {
  body?: unknown
  params: Record<string, string>
  query: Record<string, unknown>
}
interface Res {
  status(code: number): Res
  json(value: unknown): void
}
type Handler = (req: Req, res: Res) => void

interface Registrar {
  get(path: string, handler: Handler): unknown
  post(path: string, handler: Handler): unknown
  put(path: string, handler: Handler): unknown
  delete(path: string, handler: Handler): unknown
}

/** Minimal view of the server's plugin router; `access` exists from Signal K 2.35 on. */
export interface RouterLike extends Registrar {
  access?: (level: 'readwrite' | 'readonly') => Registrar
}

export interface ApiDeps {
  /** Undefined while the plugin is stopped. */
  running(): { store: Store; engine: Engine } | undefined
  registry: Registry
  status(): Record<string, unknown>
}

/**
 * REST API for the webapp, mounted at /plugins/briefing-engine. Reading and
 * running briefings needs read/write access where the server supports route
 * access levels; changing briefings stays with administrators.
 */
export function registerApi(router: RouterLike, deps: ApiDeps): void {
  const ro: Registrar = typeof router.access === 'function' ? router.access('readonly') : router
  const rw: Registrar = typeof router.access === 'function' ? router.access('readwrite') : router

  const guard =
    (fn: (req: Req, res: Res, r: { store: Store; engine: Engine }) => Promise<void> | void): Handler =>
    (req, res) => {
      const r = deps.running()
      if (!r) {
        res.status(503).json({ error: 'the plugin is not running' })
        return
      }
      Promise.resolve(fn(req, res, r)).catch((error: unknown) => res.status(500).json({ error: String(error) }))
    }

  const save = (req: Req, res: Res, r: { store: Store; engine: Engine }, id?: string): void => {
    const body = req.body && typeof req.body === 'object' ? { ...(req.body as object), ...(id ? { id } : {}) } : req.body
    const checked = deps.registry.validate(body)
    if ('errors' in checked) {
      res.status(400).json({ errors: checked.errors })
      return
    }
    const saved = r.store.saveBriefing(checked.briefing)
    r.engine.sync()
    res.status(id ? 200 : 201).json(saved)
  }

  ro.get('/api/types', (_req, res) => res.json(deps.registry.describe()))
  ro.get('/api/status', guard((_req, res) => res.json(deps.status())))
  ro.get('/api/briefings', guard((_req, res, r) => res.json(r.store.listBriefings())))
  ro.get(
    '/api/briefings/:id',
    guard((req, res, r) => {
      const b = r.store.getBriefing(req.params.id!)
      if (b) res.json(b)
      else res.status(404).json({ error: 'not found' })
    })
  )
  ro.get(
    '/api/runs',
    guard((req, res, r) => {
      const id = typeof req.query.briefingId === 'string' ? req.query.briefingId : undefined
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
      res.json(r.store.listRuns(id).slice(0, limit))
    })
  )
  rw.post(
    '/api/briefings/:id/run',
    guard(async (req, res, r) => {
      if (!r.store.getBriefing(req.params.id!)) {
        res.status(404).json({ error: 'not found' })
        return
      }
      const run = await r.engine.run(req.params.id!, 'run manually')
      if (run) res.json(run)
      else res.status(409).json({ error: 'this briefing is already running' })
    })
  )

  router.post('/api/briefings', guard((req, res, r) => save(req, res, r)))
  router.put(
    '/api/briefings/:id',
    guard((req, res, r) => {
      if (!r.store.getBriefing(req.params.id!)) res.status(404).json({ error: 'not found' })
      else save(req, res, r, req.params.id)
    })
  )
  router.delete(
    '/api/briefings/:id',
    guard((req, res, r) => {
      if (!r.store.deleteBriefing(req.params.id!)) {
        res.status(404).json({ error: 'not found' })
        return
      }
      r.engine.sync()
      res.json({ deleted: req.params.id })
    })
  )
  router.post(
    '/api/briefings/:id/clone',
    guard((req, res, r) => {
      const copy = r.store.cloneBriefing(req.params.id!)
      if (copy) res.status(201).json(copy)
      else res.status(404).json({ error: 'not found' })
    })
  )
}
