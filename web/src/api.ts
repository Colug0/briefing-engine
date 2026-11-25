export interface Part {
  type: string
  config: Record<string, unknown>
}

export interface Briefing {
  id: string
  name: string
  enabled: boolean
  triggers: Part[]
  contents: Part[]
  deliveries: Part[]
}

export interface TypeInfo {
  id: string
  title: string
  description: string
  schema: Record<string, unknown>
  /** Gets its data from the internet. */
  online?: boolean
  /** What the server has now to choose from, by field (batteries, tanks). */
  choices?: Record<string, Choice[]>
}

export interface Choice {
  value: string
  label: string
}

export interface Types {
  triggers: TypeInfo[]
  contents: TypeInfo[]
  deliveries: TypeInfo[]
}

export interface Block {
  type: string
  title: string
  text: string
  data?: unknown
  error?: string
  severity?: 'warn' | 'alarm'
  asOf?: string
}

export interface Run {
  id: string
  briefingId: string
  briefingName: string
  at: string
  reason: string
  severity?: 'warn' | 'alarm'
  blocks: Block[]
  deliveries: Array<{ type: string; ok: boolean; error?: string; note?: string }>
}

export interface Status {
  running: boolean
  briefings: number
  enabled: number
  timezone?: { offsetMinutes: number; source: string }
  internet: string | null
  weatherApi: boolean
  historyApi: boolean
}

const BASE = '/plugins/briefing-engine/api'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = []
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] }
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? 'Not allowed: log in to Signal K (changing briefings needs an administrator).'
        : (data.error ?? data.errors?.join('; ') ?? `HTTP ${res.status}`)
    throw new ApiError(msg, res.status, data.errors)
  }
  return data as T
}

export const api = {
  types: () => request<Types>('GET', '/types'),
  status: () => request<Status>('GET', '/status'),
  briefings: () => request<Briefing[]>('GET', '/briefings'),
  runs: (briefingId?: string, limit = 50) =>
    request<Run[]>('GET', `/runs?limit=${limit}${briefingId ? `&briefingId=${encodeURIComponent(briefingId)}` : ''}`),
  create: (b: Omit<Briefing, 'id'>) => request<Briefing>('POST', '/briefings', b),
  update: (b: Briefing) => request<Briefing>('PUT', `/briefings/${b.id}`, b),
  remove: (id: string) => request<unknown>('DELETE', `/briefings/${id}`),
  clone: (id: string) => request<Briefing>('POST', `/briefings/${id}/clone`),
  run: (id: string) => request<Run>('POST', `/briefings/${id}/run`)
}
