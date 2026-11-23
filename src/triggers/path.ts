import Type, { type Static } from 'typebox'
import type { TriggerType } from '../engine/types.js'

const Schema = Type.Object({
  path: Type.String({ title: 'Signal K path', description: 'Below vessels.self, e.g. electrical.switches.briefing.state', minLength: 1 }),
  when: Type.Enum(['true', 'equals', 'changes'], {
    title: 'Run when',
    description: 'true: the value becomes true (or 1, "on"). equals: the value becomes the one below. changes: on every change.',
    default: 'true'
  }),
  value: Type.Optional(Type.String({ title: 'Value (for "equals")' })),
  cooldownSeconds: Type.Number({ title: 'Minimum seconds between runs', default: 60, minimum: 0 })
})
type Config = Static<typeof Schema>

const TRUTHY = new Set(['true', '1', 'on', 'yes'])

export function matches(config: Config, value: unknown): boolean {
  if (value === null || value === undefined) return false
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value).toLowerCase()
  if (config.when === 'true') return TRUTHY.has(text)
  if (config.when === 'equals') return text === String(config.value ?? '').toLowerCase()
  return true
}

/**
 * Edge detector: fire when the condition turns from false to true (or, for
 * "changes", when the value differs from the last one), at most once per
 * cooldown. The first value seen only sets the baseline, so a switch that is
 * already on when the server starts does not fire.
 */
export function createEdge(config: Config, now: () => number) {
  let seen = false
  let last: string | undefined
  let lastMatch = false
  let lastFire = -Infinity
  return (value: unknown): boolean => {
    const text = JSON.stringify(value)
    const match = matches(config, value)
    const changed = !seen || text !== last
    const edge = seen && (config.when === 'changes' ? changed : match && !lastMatch)
    seen = true
    last = text
    lastMatch = match
    if (!edge || now() - lastFire < config.cooldownSeconds * 1000) return false
    lastFire = now()
    return true
  }
}

export const pathTrigger: TriggerType<Config> = {
  id: 'path',
  title: 'Signal K path',
  description: 'Runs when a Signal K value changes, e.g. a switch, a button or a voice command that sets a path.',
  schema: Schema,
  start(ctx, config, fire) {
    const edge = createEdge(config, () => ctx.now().getTime())
    // The stream only carries changes: take the current value as the baseline.
    edge(ctx.getSelf(config.path))
    return ctx.onSelfValue(config.path, (value) => {
      if (edge(value)) fire(`${config.path} = ${JSON.stringify(value)}`)
    })
  }
}
