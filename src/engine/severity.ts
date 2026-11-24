/** How urgent a block's content is. Most blocks have none. */
export type Severity = 'warn' | 'alarm'

const RANK: Record<string, number> = { warn: 1, alarm: 2 }

/** The most urgent of several severities, or undefined when none is set. */
export function maxSeverity(list: Array<Severity | undefined>): Severity | undefined {
  return list.reduce<Severity | undefined>((top, s) => ((s && RANK[s]! > (top ? RANK[top]! : 0)) ? s : top), undefined)
}

/** Signal K notification states in rising urgency. */
export const NOTIFICATION_STATES = ['normal', 'alert', 'warn', 'alarm', 'emergency'] as const
export type NotificationState = (typeof NOTIFICATION_STATES)[number]

/** Raise a notification state to at least what a block's severity asks for. */
export function raiseState(state: NotificationState, severity: Severity | undefined): NotificationState {
  if (!severity) return state
  const want = NOTIFICATION_STATES.indexOf(severity)
  return NOTIFICATION_STATES.indexOf(state) >= want ? state : severity
}
