import Type, { type Static } from 'typebox'
import { NOTIFICATION_STATES, raiseState } from '../engine/severity.js'
import type { DeliveryType } from '../engine/types.js'

const Schema = Type.Object({
  state: Type.Enum([...NOTIFICATION_STATES], {
    title: 'Notification state',
    description: 'normal shows it quietly; alert and above make alarm plugins (e.g. sound, voice) react.',
    default: 'normal'
  }),
  method: Type.Array(Type.Enum(['visual', 'sound']), {
    title: 'Method',
    uniqueItems: true,
    default: ['visual']
  }),
  escalate: Type.Boolean({
    title: 'Raise the state for warnings',
    description: 'A warning in the briefing raises the state to at least warn, an alarm to alarm.',
    default: true
  })
})

export const NOTIFICATION_PREFIX = 'notifications.briefing'

/** Path segment for a briefing: letters and digits only, so the path stays valid. */
export function notificationPath(briefingId: string): string {
  return `${NOTIFICATION_PREFIX}.${briefingId.replace(/[^A-Za-z0-9]/g, '')}`
}

export const notificationDelivery: DeliveryType<Static<typeof Schema>> = {
  id: 'notification',
  title: 'Signal K notification',
  description: 'Raise a Signal K notification "Briefing … ready", which other apps and alarm plugins can show.',
  schema: Schema,
  async deliver(ctx, config, run) {
    ctx.publish(notificationPath(run.briefingId), {
      state: config.escalate ? raiseState(config.state, run.severity) : config.state,
      method: config.method,
      message: `Briefing "${run.briefingName}" ready`,
      id: run.id
    })
  }
}
