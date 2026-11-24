import Type, { type Static } from 'typebox'
import { localParts, parseClock, WEEKDAYS, type Weekday } from '../engine/time.js'
import { INTERNET_PATH, internetState, type InternetState } from '../engine/internet.js'
import type { TriggerType } from '../engine/types.js'

export { INTERNET_PATH }

const Schema = Type.Object({
  time: Type.String({ title: 'Time (ship time, HH:MM)', default: '07:00', pattern: '^\\d{1,2}:\\d{2}$' }),
  days: Type.Array(Type.Enum([...WEEKDAYS]), {
    title: 'Days (none selected = every day)',
    uniqueItems: true,
    default: []
  }),
  internet: Type.Enum(['any', 'online', 'onlineOrMetered'], {
    title: 'Internet connection',
    description:
      'any: run at the set time. online: wait for an unlimited connection. onlineOrMetered: wait for any connection. Uses network.internet.state from signalk-internet; without it the briefing does not wait.',
    default: 'any'
  })
})
type Config = Static<typeof Schema>

/** Whether the connection allows running now. An unknown state never blocks. */
export function connectionOk(wanted: Config['internet'], state: InternetState): boolean {
  if (wanted === 'any' || state === 'unknown') return true
  if (wanted === 'online') return state === 'online'
  return state === 'online' || state === 'metered'
}

/**
 * Decide whether a scheduled briefing is due: on a selected day, at or after
 * the set time, not yet run on this ship's date, and the connection allows
 * it. Returns the ship's date to remember, or undefined.
 */
export function due(config: Config, now: Date, offsetMin: number, lastDate: unknown, state: InternetState): string | undefined {
  const at = parseClock(config.time)
  if (at === undefined) return undefined
  const local = localParts(now, offsetMin)
  if (config.days.length > 0 && !config.days.includes(local.weekday as Weekday)) return undefined
  if (local.hours * 60 + local.minutes < at) return undefined
  if (lastDate === local.isoDate) return undefined
  if (!connectionOk(config.internet, state)) return undefined
  return local.isoDate
}

const CHECK_MS = 30_000

export const scheduleTrigger: TriggerType<Config> = {
  id: 'schedule',
  title: 'Schedule',
  description: 'Daily or on chosen weekdays at a ship time, optionally once an internet connection is there.',
  schema: Schema,
  start(ctx, config, fire, key) {
    // A new schedule whose time has already passed today starts tomorrow
    // instead of firing the moment it is saved. A known schedule still
    // catches up after a restart if today's run was missed.
    if (ctx.state.get(key) === undefined) {
      const missed = due({ ...config, internet: 'any' }, ctx.now(), ctx.utcOffsetMinutes(), undefined, 'unknown')
      if (missed) ctx.state.set(key, missed)
      else ctx.state.set(key, null)
    }
    const check = (): void => {
      const state = internetState(ctx.getSelf(INTERNET_PATH))
      const date = due(config, ctx.now(), ctx.utcOffsetMinutes(), ctx.state.get(key), state)
      if (!date) return
      ctx.state.set(key, date)
      fire(config.internet === 'any' ? `schedule ${config.time}` : `schedule ${config.time}, internet ${state}`)
    }
    // Waiting for the connection reacts as soon as signalk-internet reports it.
    const unsubscribe = config.internet === 'any' ? () => {} : ctx.onSelfValue(INTERNET_PATH, check)
    const timer = setInterval(check, CHECK_MS)
    // The first check runs after the current call returns, so a briefing never runs inside start().
    const first = setTimeout(check, 0)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
      unsubscribe()
    }
  }
}
