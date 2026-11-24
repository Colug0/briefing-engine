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

const NO_WARNING = /\bwarnings?(\s+in\s+force)?\s*:?\s*nil\b|\bno (gale |storm )?warnings?\b|\bnil warnings?\b/i
/** A paragraph about a tropical system itself, not one that only mentions it. */
const TROPICAL = /^(severe )?(tropical (cyclone|depression|storm|low|disturbance)|hurricane|typhoon|TC\b|TD\d)/i
const WARNING = /\bwarning\b|\bavis de\b/i
const SEVERE = /hurricane|typhoon|storm[\s-]+force|storm warning|violent storm|tempête|ouragan/i
/** Tropical cyclone names such as XAVIER do not make a paragraph severe; force words do. */

/** Lines that belong to the message heading, not to its content. */
const HEADING_LINE = /^\s*([A-Z]{4}\d{2}\s+[A-Z]{4}\s+\d{6}|[A-Z]{4}\s*$|;|IDY\d+\s*$|SECURITE\s*$)/
/** A line that starts a new section or a new weather system. */
const SECTION_START =
  /^\s*(situation|synopsis|forecast|further outlook|outlook|part\s*\d|warnings?\b|for all|for [a-z]+ waters|trough|low|high|ridge|front|cold front|tropical|convergence zone|south of|north of|east of|west of|remainder)/i

/**
 * Paragraphs of a bulletin. Blank lines and indented lines start a new one.
 * Some bulletins come without a single blank line, so the heading, a line
 * ending in a colon, the end of the "issued" lines, and a sentence end
 * followed by a new section or system also start a new one.
 */
export function paragraphs(text: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  const flush = () => {
    if (cur.length) out.push(tidy(cur.join(' ')))
    cur = []
  }
  const lines = text.replace(/\r/g, '').split('\n')
  let inIssued = false
  lines.forEach((line, i) => {
    const next = lines[i + 1] ?? ''
    if (!line.trim()) return flush()
    if (/^\s/.test(line) && cur.length) flush()
    if (HEADING_LINE.test(line)) {
      flush()
      out.push(tidy(line))
      return
    }
    cur.push(line)
    // "ISSUED FROM ..." and its "AT 8:30AM ON ..." line end the heading;
    // "GALE WARNING 12 ISSUED AT ..." is a warning, and its body follows.
    if (/\b(issued|émis)\b/i.test(line) && !WARNING.test(line)) inIssued = true
    const issuedEnds = inIssued && !/^\s*(at|on|for|valid|le|à)\b/i.test(next) && !/\b(issued|émis)\b/i.test(next)
    if (issuedEnds) inIssued = false
    // A heading such as "SITUATION:" stands alone; "GALE WARNING:" keeps its body.
    const heading = /:\s*$/.test(line) && !WARNING.test(line)
    if (issuedEnds || heading || (/[.]\s*$/.test(line) && SECTION_START.test(next))) flush()
  })
  flush()
  return out.filter(Boolean)
}

/**
 * When a bulletin was issued, in the bulletin's own words. The GTS form
 * "NOV 240800 UTC" wins: some services repeat the heading around it.
 */
export function issuedAt(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ')
  // \p{L} lookarounds instead of \b, so "Émis" counts as a word too.
  const marker = String.raw`(?<!\p{L})(?:issued|émis)(?!\p{L})`
  const gts = flat.match(new RegExp(String.raw`${marker}[^.]*?\b([A-Z]{3}\s+\d{6}\s*UTC)\b`, 'iu'))?.[1]
  if (gts) return gts
  // Only the time stamp itself: a date, an optional "at"/"à", and a UTC time, in either order.
  const stamp = String.raw`\d{1,2}\s+\p{L}{3,9}\s+\d{4}(?:\s+(?:at|à)?\s*\d{2}:?\d{2}\s*UTC)?|\d{2}:?\d{2}\s*UTC(?:\s+\d{1,2}\s+\p{L}{3,9}\s+\d{4})?`
  return flat.match(new RegExp(String.raw`${marker}[^.]*?(${stamp})`, 'iu'))?.[1]?.trim()
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
const PART_ONE = /^parts?\s*1\b\s*[-:.]?\s*/i
/** "Part 1 Warnings", "PART 1 : WARNING NIL.", "PART 1 : STORM WARNING 042 …" */
const isWarningsPart = (p: string) => PART_ONE.test(p) && /warning/i.test(p.split('.')[0] ?? '')
const BOILERPLATE = /^refer to (the )?latest warnings?\b/i
/** Words that only refer to a warning, as in "gales as in warning 337" or "outside of warning area". */
const MENTION = /\b(as in|outside( of)?|inside( of)?|refer to|see)\b[^.;,]*?\bwarnings?\b[^.;,]*(?:(?:,|\band\b)\s*(?:warnings?\s*)?\d+[^.;,]*)*/gi

/** The text with references to other warnings and "no warning" notices taken out, to judge how severe it is. */
const ownWords = (p: string) => p.replace(MENTION, '').replace(new RegExp(NO_WARNING.source, 'gi'), '')

/**
 * Warnings, kept whole. Services that number their parts list warnings in
 * "Part 1 Warnings"; then that part is read and nothing else. Without it (Fiji
 * waters), a paragraph counts when its first sentence is a warning.
 */
export function findWarnings(paras: string[]): { warnings: string[]; section: Set<number> } {
  const start = paras.findIndex(isWarningsPart)
  const section = new Set<number>()
  const warnings: string[] = []
  const keep = (p: string) => {
    const t = tidy(p)
    if (t && !BOILERPLATE.test(t) && !NO_WARNING.test(t) && !/^nil\.?$/i.test(t)) warnings.push(t)
  }
  if (start >= 0) {
    section.add(start)
    keep(paras[start]!.replace(PART_ONE, '').replace(/^warnings?\b\s*[-:.]?\s*/i, ''))
    for (let i = start + 1; i < paras.length && !/^parts?\s*\d/i.test(paras[i]!); i++) {
      section.add(i)
      keep(paras[i]!)
    }
    return { warnings, section }
  }
  for (const p of paras) {
    const first = p.split(/(?<=[.:])\s/)[0] ?? p
    // A warning counts when it is still there with the references taken out.
    if (WARNING.test(first.replace(MENTION, '')) && !NO_WARNING.test(p)) warnings.push(p)
  }
  return { warnings, section }
}

/** Names follow these words in bulletins: "TROPICAL CYCLONE XAVIER". */
const NAMED_AFTER = /^(cyclone|storm|hurricane|typhoon|depression)$/i
/** …unless the next word is the bulletin's own: "STORM WARNING", "DEPRESSION MOVING". */
const NOT_A_NAME = /^(warnings?|force|forces|centre|center|moving|was|is|near|with|area|winds?|and|or|of|at|in)$/i

/**
 * A weather system for a push message: its first sentence, and in sentence
 * case when the bulletin shouts. Codes with digits (TD02F, 241800) and UTC
 * stay as they are, storm names keep a capital.
 */
export function shortSystem(text: string): string {
  const first = (text.split(/(?<=\.)\s+/)[0] ?? text).replace(/\[/g, '(').replace(/\]/g, ')')
  const letters = first.replace(/[^\p{L}]/gu, '')
  if (!letters || letters.replace(/\p{Lu}/gu, '').length > letters.length / 5) return first
  const words = first.split(/(\s+)/)
  return words
    .map((w, i) => {
      if (/\d/.test(w)) return w.replace(/(\d)HPA\b/gi, '$1 hPa')
      if (/^\(?UTC\)?[.,]?$/.test(w)) return w
      const lower = w.toLowerCase()
      const before = words[i - 2]?.replace(/[^\p{L}]/gu, '') ?? ''
      const capital = i === 0 || (NAMED_AFTER.test(before) && !NOT_A_NAME.test(lower.replace(/[^\p{L}]/gu, '')))
      return capital ? lower.replace(/\p{L}/u, (c) => c.toUpperCase()) : lower
    })
    .join('')
}

/**
 * One weather system as a push line. A paragraph can describe more than one
 * system, so the line shows the sentence nearest to the vessel, with that
 * sentence's own distance; without a position, the first sentence.
 */
export function systemLine(text: string, vessel: Position | undefined): string {
  const sentences = text.split(/(?<=\.)\s+/)
  let pick = sentences[0] ?? text
  let best: { pos: Position; nm: number } | undefined
  if (vessel) {
    for (const s of sentences) {
      const pos = nearestPosition(s, vessel)
      if (!pos) continue
      const nm = distanceNm(vessel, pos)
      if (!best || nm < best.nm) {
        best = { pos, nm }
        pick = s
      }
    }
  }
  const short = shortSystem(pick)
  return vessel && best ? `${rangeText(vessel, best.pos)} · ${short}` : short
}

export function parseBulletin(text: string, vessel: Position | undefined, radiusNm: number): ParsedBulletin {
  const paras = paragraphs(text)
  const issued = issuedAt(text)
  const { warnings, section } = findWarnings(paras)
  const systems: BulletinSystem[] = []
  let severeNearby = false
  for (const [i, p] of paras.entries()) {
    const tropical = TROPICAL.test(p)
    // A notice that there is no warning is no weather system, unless it describes one.
    if (section.has(i) || warnings.includes(p) || (NO_WARNING.test(p) && !tropical)) continue
    const pos = vessel ? nearestPosition(p, vessel) : findPositions(p)[0]
    if (!pos && !tropical) continue
    const near = vessel && pos ? distanceNm(vessel, pos) <= radiusNm : !vessel
    if (!near && !tropical) continue
    // Only a measured distance makes a system near enough to alarm.
    if (vessel && pos && near && SEVERE.test(ownWords(p))) severeNearby = true
    systems.push({ text: clip(p), distanceText: vessel && pos ? rangeText(vessel, pos) : undefined, tropical })
  }
  const severity: Severity | undefined =
    severeNearby || warnings.some((w) => SEVERE.test(ownWords(w))) ? 'alarm' : warnings.length ? 'warn' : undefined
  return { issued, warnings, systems, severity }
}

export const bulletinContent: ContentType<Config> = {
  id: 'bulletin',
  emoji: '📢',
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
      summary: `${title}${parsed.issued ? ` · issued ${parsed.issued}` : ''}`,
      items: [
        ...(parsed.warnings.length ? parsed.warnings.map((w) => `⚠️ ${w}`) : ['No warnings']),
        ...parsed.systems.map((s) => systemLine(s.text, vessel))
      ],
      data,
      severity: parsed.severity,
      asOf: got.fromCache ? got.at.toISOString() : undefined
    }
  }
}
