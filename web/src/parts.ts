import {
  IconAlertTriangle,
  IconBattery3,
  IconBell,
  IconBox,
  IconClock,
  IconCloudRain,
  IconGasStation,
  IconLayoutDashboard,
  IconMapPin,
  IconMoon,
  IconMoonStars,
  IconRipple,
  IconRoute,
  IconSpeakerphone,
  IconSun,
  IconTornado,
  type Icon
} from '@tabler/icons-react'
import type { RJSFSchema, UiSchema } from '@rjsf/utils'
import type { Choice } from './api.js'

export type Kind = 'triggers' | 'contents' | 'deliveries'

const ICONS: Record<Kind, Record<string, Icon>> = {
  triggers: { schedule: IconClock, path: IconRoute },
  contents: {
    position: IconMapPin,
    battery: IconBattery3,
    overnight: IconMoonStars,
    tanks: IconGasStation,
    sun: IconSun,
    moon: IconMoon,
    tides: IconRipple,
    weather: IconCloudRain,
    bulletin: IconSpeakerphone,
    storms: IconTornado,
    path: IconRoute
  },
  deliveries: { webapp: IconLayoutDashboard, notification: IconAlertTriangle, ntfy: IconBell }
}

export const iconFor = (kind: Kind, type: string): Icon => ICONS[kind][type] ?? IconBox

/** Secrets never show in a summary line. */
const SECRET = /token|password|secret|key/i

type Props = Record<string, RJSFSchema>

function show(prop: RJSFSchema, value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '' || SECRET.test(name)) return undefined
  const title = String(prop.title ?? name).toLowerCase()
  if (typeof value === 'boolean') return value ? title : undefined
  if (typeof value === 'number') {
    // "Low below (%)" reads as "low below 30%", "Radius (nm)" as "radius 600 nm".
    const m = title.match(/^(.*?)\s*\((.+)\)$/)
    if (!m) return `${title} ${value}`
    return `${m[1]} ${value}${m[2] === '%' ? '%' : ` ${m[2]}`}`
  }
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    if (!value.length) return undefined
    const items = prop.items as RJSFSchema | undefined
    if (items && Array.isArray(items.enum) && value.length === items.enum.length) return `${title}: all`
    if (value.every((v) => typeof v !== 'object')) return value.join(', ')
    return `${value.length} ${title}`
  }
  if (typeof value === 'object') {
    // A group of settings (an ntfy server): what it is, if it is on.
    const v = value as Record<string, unknown>
    if (v.enabled === false) return undefined
    const sub = (prop.properties ?? {}) as Props
    return Object.entries(sub)
      .filter(([k, p]) => k !== 'enabled' && typeof v[k] === 'string' && !SECRET.test(k) && p.type === 'string')
      .map(([k]) => v[k] as string)
      .filter(Boolean)
      .join(' ')
  }
  return undefined
}

/** One line of what a part is set to, from its schema and settings, so a closed part still says what it does. */
export function summarize(schema: RJSFSchema | undefined, config: Record<string, unknown>): string {
  const props = (schema?.properties ?? {}) as Props
  return Object.entries(props)
    .map(([name, prop]) => show(prop, config[name] ?? prop.default, name))
    .filter((s): s is string => Boolean(s))
    .join(' · ')
}

/**
 * Fields with choices from the server become checkboxes (several) or a
 * select (one). Saved ids the server does not report now stay in the list,
 * so saving does not drop them.
 */
export function withChoices(
  schema: RJSFSchema,
  ui: UiSchema,
  choices: Record<string, Choice[]> | undefined,
  config: Record<string, unknown>
): { schema: RJSFSchema; ui: UiSchema } {
  if (!choices) return { schema, ui }
  const props = { ...((schema.properties ?? {}) as Props) }
  const nextUi: UiSchema = { ...ui }
  for (const [name, list] of Object.entries(choices)) {
    const prop = props[name]
    if (!prop) continue
    const current = config[name] ?? prop.default
    const saved = (Array.isArray(current) ? current : [current]).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    const options = [...list, ...saved.filter((v) => !list.some((c) => c.value === v)).map((v) => ({ value: v, label: `${v} (no data now)` }))]
    if (!options.length) continue
    const values = options.map((o) => o.value)
    const names = options.map((o) => (o.label === o.value || o.label.endsWith('(no data now)') ? o.label : `${o.label} (${o.value})`))
    if (prop.type === 'array') {
      props[name] = { ...prop, uniqueItems: true, items: { ...(prop.items as RJSFSchema), enum: values } }
      nextUi[name] = { 'ui:widget': 'checkboxes', items: { 'ui:enumNames': names } }
    } else {
      props[name] = { ...prop, enum: values }
      nextUi[name] = { 'ui:enumNames': names }
    }
  }
  return { schema: { ...schema, properties: props }, ui: nextUi }
}
