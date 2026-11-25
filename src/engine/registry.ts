import { Value } from 'typebox/value'
import type { Briefing, Choice, ContentType, DeliveryType, Part, SelfReader, TriggerType } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = any

export class Registry {
  readonly triggers = new Map<string, TriggerType<AnyConfig>>()
  readonly contents = new Map<string, ContentType<AnyConfig>>()
  readonly deliveries = new Map<string, DeliveryType<AnyConfig>>()

  constructor(types: {
    triggers: Array<TriggerType<AnyConfig>>
    contents: Array<ContentType<AnyConfig>>
    deliveries: Array<DeliveryType<AnyConfig>>
  }) {
    for (const t of types.triggers) add(this.triggers, t)
    for (const t of types.contents) add(this.contents, t)
    for (const t of types.deliveries) add(this.deliveries, t)
  }

  /**
   * Every type with its config schema, for the webapp's editor. With the
   * server's data, content types also list what is there to choose from.
   */
  describe(self?: SelfReader) {
    const list = (m: Map<string, { id: string; title: string; description: string; schema: unknown; online?: boolean }>) =>
      [...m.values()].map(({ id, title, description, schema, online }) => ({ id, title, description, schema, ...(online ? { online } : {}) }))
    const contents = [...this.contents.values()].map((t, i) => {
      let choices: Record<string, Choice[]> | undefined
      try {
        choices = self && t.choices ? t.choices(self) : undefined
      } catch {
        // Choices only help the editor; without them it takes typed ids.
      }
      return { ...list(this.contents)[i]!, ...(choices ? { choices } : {}) }
    })
    return { triggers: list(this.triggers), contents, deliveries: list(this.deliveries) }
  }

  /**
   * Check a briefing from outside (the webapp) and fill in config defaults.
   * Returns the cleaned briefing or a list of problems.
   */
  validate(input: unknown): { briefing: Omit<Briefing, 'id'> & { id?: string } } | { errors: string[] } {
    const errors: string[] = []
    if (!input || typeof input !== 'object') return { errors: ['briefing must be an object'] }
    const b = input as Record<string, unknown>
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) errors.push('name is required')
    const parts = (key: 'triggers' | 'contents' | 'deliveries', types: Map<string, { schema: unknown }>): Part[] => {
      const raw = b[key] ?? []
      if (!Array.isArray(raw)) {
        errors.push(`${key} must be a list`)
        return []
      }
      return raw.map((p: unknown, i: number) => {
        const part = (p ?? {}) as Record<string, unknown>
        const type = typeof part.type === 'string' ? types.get(part.type) : undefined
        if (!type) {
          errors.push(`${key}[${i}]: unknown type ${String(part.type)}`)
          return { type: String(part.type), config: {} }
        }
        const config = Value.Default(type.schema as never, structuredClone(part.config ?? {})) as Record<string, unknown>
        for (const e of Value.Errors(type.schema as never, config)) {
          const where = (e as { instancePath?: string }).instancePath || ''
          errors.push(`${key}[${i}] ${part.type}${where}: ${(e as { message?: string }).message ?? 'invalid'}`)
        }
        return { type: part.type as string, config }
      })
    }
    const briefing = {
      ...(typeof b.id === 'string' && b.id ? { id: b.id } : {}),
      name,
      enabled: b.enabled !== false,
      triggers: parts('triggers', this.triggers),
      contents: parts('contents', this.contents),
      deliveries: parts('deliveries', this.deliveries)
    }
    return errors.length ? { errors } : { briefing }
  }
}

function add<T extends { id: string }>(map: Map<string, T>, type: T): void {
  if (map.has(type.id)) throw new Error(`duplicate type id ${type.id}`)
  map.set(type.id, type)
}
