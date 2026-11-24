import Type, { type Static } from 'typebox'
import { distanceNm, findPositions, nearestPosition, rangeText } from '../engine/geo.js'
import type { Severity } from '../engine/severity.js'
import type { ContentType, Position } from '../engine/types.js'
import type { BulletinData, BulletinSystem } from './data.js'
import { isNum } from './helpers.js'

const TGFTP = 'https://tgftp.nws.noaa.gov/data/raw/fq/'

/** High-seas and coastal bulletins on NOAA's TGFTP mirror of the GTS, checked November 2026. */
export const BULLETINS: Record<string, { title: string; file: string }> = {
  'fiji-islands': { title: 'Fiji Met – Islands area (EQ–25S, 160E–120W)', file: 'fqps01.nffn' },
  'fiji-waters': { title: 'Fiji Met – Fiji waters', file: 'fqfj01.nffn' },
  'fiji-warnings': { title: 'Fiji Met – Fiji waters warnings', file: 'fqfj40.nffn' },
  'nz-subtropic': { title: 'MetService NZ – Subtropic (25S–40S)', file: 'fqps43.nzkl' },
  'nz-forties': { title: 'MetService NZ – Forties (40S–55S)', file: 'fqps44.nzkl' },
  'nz-pacific': { title: 'MetService NZ – Pacific (25S–55S, 170W–120W)', file: 'fqps45.nzkl' },
  'nz-southern': { title: 'MetService NZ – Southern (55S to ice)', file: 'fqps46.nzkl' },
  'au-north-east': { title: 'BoM Australia – North eastern METAREA 10', file: 'fqau20.ammc' },
  'au-north': { title: 'BoM Australia – Northern METAREA 8/10/11', file: 'fqau21.ammc' },
  'au-south-east': { title: 'BoM Australia – South eastern METAREA 10', file: 'fqau22.ammc' },
  'au-west': { title: 'BoM Australia – Western METAREA 10', file: 'fqau23.ammc' },
  'au-south': { title: 'BoM Australia – Southern METAREA 10', file: 'fqau24.ammc' },
  'french-polynesia': { title: 'Météo-France – French Polynesia (French)', file: 'fqpf24.ntaa' },
  'new-caledonia': { title: 'Météo-France – New Caledonia (French)', file: 'fqnc40.nwbb' }
}

const Schema = Type.Object({
  bulletin: Type.Enum([...Object.keys(BULLETINS), 'custom'], {
    title: 'Bulletin',
    description: 'Official marine weather bulletin for the waters you are in.',
    default: 'fiji-islands'
  }),
  url: Type.Optional(
    Type.String({ title: 'Address (for "custom")', description: `Any plain-text bulletin, e.g. ${TGFTP}fqus20.kwbc..txt` })
  ),
  radiusNm: Type.Integer({
    title: 'Systems within (nm)',
    description: 'Weather systems with a position further away are left out; tropical systems are always shown.',
    default: 600,
    minimum: 50,
    maximum: 5000
  })
})
type Config = Static<typeof Schema>

const MAX_PARAGRAPH = 400
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string) => (s.length > MAX_PARAGRAPH ? `${s.slice(0, MAX_PARAGRAPH - 1)}…` : s)

const NO_WARNING = /\b(warning|warnings)\s*:?\s*nil\b|\bno (gale |storm )?warnings?\b|\bnil warnings?\b/i
/** A paragraph about a tropical system itself, not one that only mentions it. */
const TROPICAL = /^(severe )?(tropical (cyclone|depression|storm|low|disturbance)|hurricane|typhoon|TC\b|TD\d)/i
const WARNING = /\bwarning\b|\bavis de\b/i
const SEVERE = /hurricane|typhoon|storm force|storm warning|violent storm|tempête|ouragan/i
/** Tropical cyclone names such as XAVIER do not make a paragraph severe; force words do. */

/** Paragraphs of a bulletin: blank lines or a line starting with a space start a new one. */
export function paragraphs(text: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim() || (/^\s/.test(line) && cur.length)) {
      if (cur.length) out.push(tidy(cur.join(' ')))
      cur = line.trim() ? [line] : []
    } else cur.push(line)
  }
  if (cur.length) out.push(tidy(cur.join(' ')))
  return out.filter(Boolean)
}

export interface ParsedBulletin {
  issued?: string
  warnings: string[]
  systems: BulletinSystem[]
  severity?: Severity
}

/**
 * Pull out what matters on board: warnings in full, and the weather systems
 * near the vessel. Bulletins differ by service, so this reads them by
 * patterns rather than by a fixed layout.
 */
export function parseBulletin(text: string, vessel: Position | undefined, radiusNm: number): ParsedBulletin {
  const paras = paragraphs(text)
  const issuedLine = paras.find((p) => /\bissued\b|\bémis\b|\bdu \d/i.test(p))
  const issued = issuedLine?.match(/(?:issued|émis)[^.]*?(\d{1,2}\s*\w{3}[^.]*?UTC|\w{3}\s*\d{6}\s*UTC|\d{4}\s*UTC[^.]*)/i)?.[1]
  const warnings: string[] = []
  const systems: BulletinSystem[] = []
  let severeNearby = false
  for (const p of paras) {
    if (/^(part|parts)\s*\d/i.test(p) && NO_WARNING.test(p)) continue
    const tropical = TROPICAL.test(p)
    const pos = vessel ? nearestPosition(p, vessel) : findPositions(p)[0]
    if (WARNING.test(p) && !NO_WARNING.test(p) && !/^(part|parts)\s*\d+\s*(and\s*\d+)?\s*:\s*(synopsis|forecast)/i.test(p)) {
      // Warnings stay whole: what matters may come at the end.
      warnings.push(p)
      continue
    }
    if (!pos && !tropical) continue
    const near = vessel && pos ? distanceNm(vessel, pos) <= radiusNm : !vessel
    if (!near && !tropical) continue
    if (near && SEVERE.test(p)) severeNearby = true
    systems.push({ text: clip(p), distanceText: vessel && pos ? rangeText(vessel, pos) : undefined, tropical })
  }
  const severity: Severity | undefined =
    severeNearby || warnings.some((w) => SEVERE.test(w)) ? 'alarm' : warnings.length ? 'warn' : undefined
  return { issued, warnings, systems, severity }
}

export const bulletinContent: ContentType<Config> = {
  id: 'bulletin',
  title: 'Marine weather bulletin',
  description: 'Warnings and nearby weather systems from an official marine bulletin (GMDSS), fetched from NOAA TGFTP.',
  schema: Schema,
  async fetch(ctx, config) {
    const preset = BULLETINS[config.bulletin]
    const url = preset ? `${TGFTP}${preset.file}..txt` : config.url?.trim()
    if (!url) throw new Error('no bulletin address set')
    const title = preset?.title ?? 'Marine bulletin'
    const got = await ctx.cached(`bulletin|${url}`, async () => {
      const res = await ctx.http(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    })
    const p = ctx.getSelf('navigation.position') as Partial<Position> | undefined
    const vessel = p && isNum(p.latitude) && isNum(p.longitude) ? { latitude: p.latitude, longitude: p.longitude } : undefined
    const parsed = parseBulletin(String(got.value), vessel, config.radiusNm)
    const lines = [
      `${title}${parsed.issued ? `, issued ${parsed.issued}` : ''}.`,
      parsed.warnings.length ? parsed.warnings.map((w) => `Warning: ${w}`).join(' ') : 'No warnings.',
      ...parsed.systems.map((s) => (s.distanceText ? `${s.text} (${s.distanceText} from you)` : s.text))
    ]
    const data: BulletinData = { title, issued: parsed.issued, url, warnings: parsed.warnings, systems: parsed.systems }
    return {
      title: 'Marine bulletin',
      text: lines.join(' '),
      data,
      severity: parsed.severity,
      asOf: got.fromCache ? got.at.toISOString() : undefined
    }
  }
}
