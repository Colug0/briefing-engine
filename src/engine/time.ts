/**
 * Vessel-local time from a fixed UTC offset. Signal K gives the ship's offset
 * in environment.time.timezoneOffset as (-)hhmm, e.g. 1200 or -330.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof DAYS)[number]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Minutes east of UTC for a (-)hhmm offset, or undefined when the value is not one. */
export function offsetMinutes(hhmm: unknown): number | undefined {
  if (typeof hhmm !== 'number' || !Number.isInteger(hhmm) || Math.abs(hhmm) > 1400) return undefined
  const abs = Math.abs(hhmm)
  const minutes = abs % 100
  if (minutes >= 60) return undefined
  return Math.sign(hhmm) * (Math.floor(abs / 100) * 60 + minutes)
}

/** The wall-clock fields of `date` at the given offset. */
export function localParts(date: Date, offsetMin: number) {
  const shifted = new Date(date.getTime() + offsetMin * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: DAYS[shifted.getUTCDay()] as Weekday,
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    /** Calendar date as YYYY-MM-DD, used to remember what already ran today. */
    isoDate: shifted.toISOString().slice(0, 10)
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatTime(date: Date, offsetMin: number): string {
  const p = localParts(date, offsetMin)
  return `${pad(p.hours)}:${pad(p.minutes)}`
}

export function formatDate(date: Date, offsetMin: number): string {
  const p = localParts(date, offsetMin)
  return `${DAY_NAMES[DAYS.indexOf(p.weekday)]} ${p.day} ${MONTHS[p.month]}`
}

/** Minutes since local midnight for "HH:MM", or undefined when malformed. */
export function parseClock(text: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return h * 60 + min
}

export const WEEKDAYS = DAYS
