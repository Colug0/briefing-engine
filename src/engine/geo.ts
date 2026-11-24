import { compass } from './units.js'
import type { Position } from './types.js'

const R_NM = 3440.065
const rad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in nautical miles. */
export function distanceNm(a: Position, b: Position): number {
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial true bearing from a to b in radians. */
export function bearing(a: Position, b: Position): number {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude))
  const x =
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude))
  return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI)
}

/** "240 nm ENE" from a to b. */
export function rangeText(from: Position, to: Position): string {
  return `${Math.round(distanceNm(from, to))} nm ${compass(bearing(from, to))}`
}

/** "13.0°S 167.0°W" */
export function latLonText(p: Position): string {
  const lat = `${Math.abs(p.latitude).toFixed(1)}°${p.latitude < 0 ? 'S' : 'N'}`
  const lon = `${Math.abs(p.longitude).toFixed(1)}°${p.longitude < 0 ? 'W' : 'E'}`
  return `${lat} ${lon}`
}

const POSITION =
  /(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*(S|N|SOUTH|NORTH)(?![A-Z])[\s,]*(\d{1,3}(?:\.\d+)?)\s*(E|W|EAST|WEST)(?![A-Z])/gi

/** All positions in a text such as "NEAR 16.0 SOUTH 161.0 EAST" or "18S 162E 16S 168E". */
export function findPositions(text: string): Position[] {
  const out: Position[] = []
  for (const m of text.matchAll(POSITION)) {
    const lat = Number(m[1]) * (/^s/i.test(m[2]!) ? -1 : 1)
    const lon = Number(m[3]) * (/^w/i.test(m[4]!) ? -1 : 1)
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ latitude: lat, longitude: lon })
  }
  return out
}

/** The position in a text nearest to `from`, e.g. the closest point of a trough line. */
export function nearestPosition(text: string, from: Position): Position | undefined {
  let best: Position | undefined
  for (const p of findPositions(text)) if (!best || distanceNm(from, p) < distanceNm(from, best)) best = p
  return best
}
