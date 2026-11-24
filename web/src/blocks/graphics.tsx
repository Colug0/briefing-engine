import type { TankKind } from '../../../src/contents/data'
import { waxingOf } from './moon'

/** Horizontal battery, filled to the state of charge and coloured by the block's thresholds. */
export function BatteryGauge({ soc, low, high }: { soc?: number; low: number; high: number }) {
  const known = typeof soc === 'number'
  const level = known ? Math.min(Math.max(soc, 0), 1) : 1
  const tone = !known ? 'var(--muted-fill)' : level < low ? 'var(--bad)' : level >= high ? 'var(--good)' : 'var(--warn)'
  return (
    <svg width="44" height="22" viewBox="0 0 44 22" aria-hidden="true" className="gauge">
      <rect x="1" y="2" width="37" height="18" rx="3.5" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      <rect x="39" y="7.5" width="3.5" height="7" rx="1" fill="var(--line-strong)" />
      <rect x="3.5" y="4.5" width={Math.max(32 * level, known ? 1.5 : 32)} height="13" rx="2" fill={tone} opacity={known ? 1 : 0.35} />
    </svg>
  )
}

const TANK_COLOUR: Record<TankKind, string> = {
  fuel: 'var(--fuel)',
  water: 'var(--water)',
  waste: 'var(--waste)',
  other: 'var(--muted-fill)'
}

/** Waste tanks turn red when nearly full: for them full is the warning. */
const WASTE_FULL = 0.8

/** Upright tank, filled to its level, coloured by what it holds. */
export function TankGauge({ level, kind }: { level?: number; kind: TankKind }) {
  const l = typeof level === 'number' ? Math.min(Math.max(level, 0), 1) : 0
  const h = 26 * l
  const fill = kind === 'waste' && l >= WASTE_FULL ? 'var(--bad)' : TANK_COLOUR[kind]
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden="true" className="gauge">
      <rect x="1" y="1" width="22" height="30" rx="4.5" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      {h > 0 && <rect x="3" y={29 - h} width="18" height={h} rx="2.5" fill={fill} />}
    </svg>
  )
}

/**
 * The moon's disc as seen from the vessel. `phase` runs 0 (new) → 0.5 (full) → 1.
 * North of the equator the waxing moon is lit on the right, south of it on the left.
 */
export function MoonDisc({ phase, name, fraction, southern }: { phase?: number; name?: string; fraction?: number; southern: boolean }) {
  const r = 15
  const lit = typeof fraction === 'number' ? fraction : typeof phase === 'number' ? (1 - Math.cos(2 * Math.PI * phase)) / 2 : 0
  const waxing = waxingOf(phase, name)
  // Without knowing which side is lit, a drawing would be wrong half the time.
  if (waxing === undefined) return null
  // The terminator is an ellipse with half-width |1 - 2·lit|·r.
  const rx = Math.abs(1 - 2 * lit) * r
  const rightLit = waxing !== southern
  // SVG arcs: sweep 1 runs clockwise on screen, so top → bottom via the right
  // and bottom → top via the left. A crescent's terminator bulges towards the
  // lit side, a gibbous moon's away from it.
  const outer = rightLit ? 1 : 0
  const inner = lit > 0.5 ? (rightLit ? 1 : 0) : rightLit ? 0 : 1
  const d = `M17 2 A${r} ${r} 0 0 ${outer} 17 32 A${rx} ${r} 0 0 ${inner} 17 2 Z`
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="gauge">
      <circle cx="17" cy="17" r={r} fill="var(--moon-dark)" />
      {lit > 0.01 && <path d={d} fill="var(--moon-lit)" />}
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--line-strong)" />
    </svg>
  )
}

/** The sun's arc from sunrise to sunset, with where it stands now. */
export function SunArc({ sunrise, sunset, now }: { sunrise?: string; sunset?: string; now: string }) {
  const rise = sunrise ? Date.parse(sunrise) : Number.NaN
  const set = sunset ? Date.parse(sunset) : Number.NaN
  const t = Date.parse(now)
  const day = !Number.isNaN(rise) && !Number.isNaN(set) && set > rise
  const f = day ? (t - rise) / (set - rise) : Number.NaN
  const up = f >= 0 && f <= 1
  // Point on the quadratic curve M10 40 Q50 -6 90 40.
  const x = 10 + 80 * f
  const y = (1 - f) * (1 - f) * 40 + 2 * (1 - f) * f * -6 + f * f * 40
  return (
    <svg width="100" height="46" viewBox="0 0 100 46" aria-hidden="true" className="gauge">
      <line x1="4" y1="40" x2="96" y2="40" stroke="var(--line-strong)" />
      <path d="M10 40 Q50 -6 90 40" fill="none" stroke="var(--sun)" strokeDasharray="3 3" />
      {up && <circle cx={x} cy={y} r="5" fill="var(--sun)" />}
    </svg>
  )
}

/** A small curve of a ratio (0–1) over time; gaps where the value is unknown. */
export function Sparkline({ values }: { values: Array<number | null> }) {
  const W = 120
  const H = 34
  const n = values.length
  if (n < 2) return null
  let d = ''
  values.forEach((v, i) => {
    if (v === null) return
    const x = (i / (n - 1)) * (W - 4) + 2
    const y = H - 3 - Math.min(Math.max(v, 0), 1) * (H - 6)
    const prev = values[i - 1]
    d += `${i === 0 || prev === null || prev === undefined ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `
  })
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="gauge">
      <line x1="2" y1={H - 3} x2={W - 2} y2={H - 3} stroke="var(--line)" />
      <path d={d} fill="none" stroke="var(--good)" strokeWidth="2" />
    </svg>
  )
}
