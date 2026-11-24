import Type, { type Static } from 'typebox'
import { bearing, distanceNm, latLonText } from '../engine/geo.js'
import { maxSeverity, type Severity } from '../engine/severity.js'
import type { ContentType, Position } from '../engine/types.js'
import { compass } from '../engine/units.js'
import type { StormData, StormItem } from './data.js'
import { isNum } from './helpers.js'

/** GDACS (UN / European Commission JRC) tropical cyclone events, worldwide. */
// Without alertlevel the API leaves out green events and returns old red ones first.
export const GDACS_TC = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red'

const Schema = Type.Object({
  radiusNm: Type.Integer({ title: 'Within (nm)', default: 1000, minimum: 100, maximum: 5000 }),
  hours: Type.Integer({ title: 'Updated within (h)', description: 'Leave out storms GDACS has not updated for longer.', default: 48, minimum: 6, maximum: 240 })
})
type Config = Static<typeof Schema>

/** Closer than this, any storm is an alarm. */
const ALARM_NM = 300

interface Feature {
  geometry?: { type?: string; coordinates?: unknown }
  properties?: {
    name?: string
    eventname?: string
    alertlevel?: string
    todate?: string
    datemodified?: string
    severitydata?: { severitytext?: string }
    url?: { report?: string }
  }
}

export function stormSeverity(s: Pick<StormItem, 'alertLevel' | 'distanceNm'> & { exactNm?: number }): Severity | undefined {
  // The unrounded distance decides: 299.6 nm is inside 300.
  if (s.alertLevel === 'red' || (s.exactNm ?? s.distanceNm) < ALARM_NM) return 'alarm'
  if (s.alertLevel === 'orange') return 'warn'
  return undefined
}

/** Storms from a GDACS answer that are recent and within reach of the vessel, nearest first. */
export function stormsNear(json: unknown, vessel: Position, radiusNm: number, now: Date, hours: number): Array<StormItem & { exactNm: number }> {
  const features = (json as { features?: Feature[] } | undefined)?.features ?? []
  const out: Array<StormItem & { exactNm: number }> = []
  for (const f of features) {
    const c = f.geometry?.type === 'Point' ? (f.geometry.coordinates as unknown[]) : undefined
    if (!c || !isNum(c[0]) || !isNum(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) continue
    const p = f.properties ?? {}
    // When GDACS last changed the event; `todate` is the end of the event window. Times are UTC without a zone.
    const stamp = p.datemodified ?? p.todate
    const updated = stamp ? Date.parse(/[zZ+]/.test(stamp.slice(10)) ? stamp : `${stamp}Z`) : Number.NaN
    if (Number.isNaN(updated) || now.getTime() - updated > hours * 3_600_000) continue
    const at = { latitude: c[1], longitude: c[0] }
    const d = distanceNm(vessel, at)
    if (d > radiusNm) continue
    const level = (p.alertlevel ?? '').toLowerCase()
    const b = bearing(vessel, at)
    out.push({
      exactNm: d,
      name: p.eventname || p.name || 'Tropical cyclone',
      alertLevel: level === 'green' || level === 'orange' || level === 'red' ? level : 'unknown',
      description: p.severitydata?.severitytext,
      positionText: latLonText(at),
      distanceNm: Math.round(d),
      bearing: b,
      compass: compass(b),
      updatedText: new Date(updated).toISOString(),
      url: p.url?.report
    })
  }
  return out.sort((a, b) => a.distanceNm - b.distanceNm)
}

export const stormContent: ContentType<Config> = {
  id: 'storms',
  emoji: '🌀',
  title: 'Tropical cyclones (GDACS)',
  description: 'Tropical cyclones near the vessel from GDACS, with distance and direction.',
  schema: Schema,
  async fetch(ctx, config) {
    const p = ctx.getSelf('navigation.position') as Partial<Position> | undefined
    if (!p || !isNum(p.latitude) || !isNum(p.longitude)) throw new Error('no position')
    const vessel = { latitude: p.latitude, longitude: p.longitude }
    const got = await ctx.cached('gdacs|tc', async () => {
      const res = await ctx.http(GDACS_TC, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`GDACS: HTTP ${res.status}`)
      return (await res.json()) as unknown
    })
    const found = stormsNear(got.value, vessel, config.radiusNm, ctx.now(), config.hours)
    const severity = maxSeverity(found.map(stormSeverity))
    const storms: StormItem[] = found.map(({ exactNm: _exact, ...s }) => ({
      ...s,
      updatedText: s.updatedText ? `${ctx.date(s.updatedText)} ${ctx.time(s.updatedText)}` : undefined
    }))
    const text = storms.length
      ? storms
          .map(
            (s) =>
              `${s.name}: ${s.positionText}, ${s.distanceNm} nm ${s.compass}, ${s.alertLevel} alert${s.description ? `, ${s.description}` : ''}${s.updatedText ? `, updated ${s.updatedText}` : ''}.`
          )
          .join(' ')
      : `No tropical cyclones within ${config.radiusNm} nm.`
    const data: StormData = { radiusNm: config.radiusNm, storms }
    return {
      title: 'Tropical cyclones',
      text: `Tropical cyclones. ${text}`,
      summary: storms.length ? 'Tropical cyclones' : `No tropical cyclones within ${config.radiusNm} nm`,
      items: storms.map(
        (s) =>
          `${s.name} · ${s.distanceNm} nm ${s.compass} · ${s.alertLevel} alert${s.description ? ` · ${s.description}` : ''}${s.updatedText ? ` · updated ${s.updatedText}` : ''}`
      ),
      data,
      severity,
      asOf: got.fromCache ? got.at.toISOString() : undefined
    }
  }
}
